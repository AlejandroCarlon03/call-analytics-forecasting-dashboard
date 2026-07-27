#!/usr/bin/env python3
"""
call_forecast.evaluation
========================
Accuracy metrics, rolling-origin cross-validation, and automatic model choice.

Why rolling-origin
------------------
A random train/test split leaks the future into the past and will report
excellent accuracy for a model that is useless in production. This module
evaluates every model the way it will actually be used: train on everything up
to a cut-off date, forecast the next ``horizon`` days, score against what
really happened, advance the cut-off, repeat. Averaging over several such
origins is what makes the leaderboard trustworthy.

Metric notes
------------
``MAE`` / ``RMSE``
    In the target's own units. RMSE punishes large misses harder, so a model
    that is usually good but occasionally wild ranks worse on RMSE than MAE.
``MAPE``
    Requested, and reported — but it is **undefined on zero-call days** and
    explodes on days with one or two calls. It is computed over non-zero
    actuals only, and the count used is reported alongside it as ``mape_n`` so
    a percentage based on four days is never mistaken for one based on forty.
``sMAPE``
    Symmetric variant, defined everywhere including zeros. Reported because it
    is the percentage figure that survives this dataset's zero days.
``MASE``
    Mean absolute error divided by the error of a seasonal-naive forecast on
    the training data. ``MASE < 1`` means the model beats "repeat last week";
    ``MASE >= 1`` means it does not. This is the **default selection metric**
    precisely because it stays meaningful on intermittent series.
``R2``
    Reported as requested. On short horizons it is routinely negative, which
    simply means the model tracks the series worse than a flat line at the
    period's mean — worth seeing, not worth selecting on.
``bias``
    Mean signed error. Positive means the model under-forecasts on average,
    which for a staffing decision is a different kind of wrong than
    over-forecasting.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig
from .models import Forecaster, NotEnoughDataError, build_models

log = logging.getLogger(__name__)

__all__ = [
    "METRICS",
    "compute_metrics",
    "mae", "rmse", "mape", "smape", "mase", "r2",
    "FoldPrediction",
    "ModelEvaluation",
    "EvaluationResult",
    "rolling_origin_splits",
    "evaluate_models",
]

#: Metrics where a smaller value is better.
LOWER_IS_BETTER = {"mae", "rmse", "mape", "smape", "mase"}
#: Every metric reported, in leaderboard column order.
METRICS = ("mae", "rmse", "r2", "mape", "smape", "mase", "bias")


# --------------------------------------------------------------------------- #
#  Metric primitives                                                           #
# --------------------------------------------------------------------------- #
def _clean(y_true, y_pred) -> tuple[np.ndarray, np.ndarray]:
    """Align two arrays and drop positions where either side is not finite."""
    a = np.asarray(y_true, dtype=float).ravel()
    b = np.asarray(y_pred, dtype=float).ravel()
    if a.shape != b.shape:
        raise ValueError(f"Shape mismatch: y_true {a.shape} vs y_pred {b.shape}")
    ok = np.isfinite(a) & np.isfinite(b)
    return a[ok], b[ok]


def mae(y_true, y_pred) -> float:
    """Mean absolute error.

    >>> round(mae([1, 2, 3], [1, 2, 5]), 4)
    0.6667
    """
    a, b = _clean(y_true, y_pred)
    return float(np.mean(np.abs(a - b))) if a.size else math.nan


def rmse(y_true, y_pred) -> float:
    """Root mean squared error.

    >>> round(rmse([1, 2, 3], [1, 2, 5]), 4)
    1.1547
    """
    a, b = _clean(y_true, y_pred)
    return float(np.sqrt(np.mean((a - b) ** 2))) if a.size else math.nan


def mape(y_true, y_pred) -> tuple[float, int]:
    """
    Mean absolute percentage error over non-zero actuals.

    Returns ``(value, n_used)``. The count matters: on this data a large share
    of days have zero calls and are necessarily excluded, so a MAPE computed
    from a handful of days should not be read as a headline accuracy figure.

    >>> value, n = mape([0, 100, 200], [10, 110, 180])
    >>> round(value, 2), n
    (10.0, 2)
    """
    a, b = _clean(y_true, y_pred)
    nz = a != 0
    if not nz.any():
        return math.nan, 0
    return float(np.mean(np.abs((a[nz] - b[nz]) / a[nz])) * 100.0), int(nz.sum())


def smape(y_true, y_pred) -> float:
    """
    Symmetric MAPE, defined even where the actual is zero.

    Uses the ``200 * |e| / (|a| + |f|)`` convention, so the result is bounded
    at 200%. Positions where both actual and forecast are zero are treated as
    a perfect prediction (0% error) rather than as undefined.
    """
    a, b = _clean(y_true, y_pred)
    if not a.size:
        return math.nan
    denom = np.abs(a) + np.abs(b)
    ratio = np.zeros_like(denom, dtype=float)
    nz = denom != 0
    ratio[nz] = 200.0 * np.abs(a[nz] - b[nz]) / denom[nz]
    return float(np.mean(ratio))


def r2(y_true, y_pred) -> float:
    """
    Coefficient of determination.

    Returns NaN when the actuals are constant over the evaluation window, since
    the total sum of squares is then zero and the ratio is undefined.
    """
    a, b = _clean(y_true, y_pred)
    if a.size < 2:
        return math.nan
    ss_tot = float(np.sum((a - a.mean()) ** 2))
    if ss_tot <= 0:
        return math.nan
    ss_res = float(np.sum((a - b) ** 2))
    return 1.0 - ss_res / ss_tot


def mase(y_true, y_pred, insample: Sequence[float], season: int = 7) -> float:
    """
    Mean absolute scaled error against a seasonal-naive in-sample benchmark.

    The scale is the mean absolute ``season``-step difference of the training
    series. If that is zero (a constant training series) the metric is
    undefined and NaN is returned rather than an infinity that would poison the
    leaderboard sort.
    """
    a, b = _clean(y_true, y_pred)
    hist = np.asarray(insample, dtype=float).ravel()
    hist = hist[np.isfinite(hist)]
    if a.size == 0 or hist.size <= season:
        return math.nan
    scale = float(np.mean(np.abs(hist[season:] - hist[:-season])))
    if not np.isfinite(scale) or scale <= 0:
        return math.nan
    return float(np.mean(np.abs(a - b)) / scale)


def bias(y_true, y_pred) -> float:
    """Mean signed error (actual - forecast); positive means under-forecasting."""
    a, b = _clean(y_true, y_pred)
    return float(np.mean(a - b)) if a.size else math.nan


def compute_metrics(
    y_true, y_pred, insample: Sequence[float] | None = None, season: int = 7
) -> dict[str, float]:
    """Compute the full metric set in one pass. Keys match :data:`METRICS`."""
    mape_value, mape_n = mape(y_true, y_pred)
    a, _ = _clean(y_true, y_pred)
    return {
        "mae": mae(y_true, y_pred),
        "rmse": rmse(y_true, y_pred),
        "r2": r2(y_true, y_pred),
        "mape": mape_value,
        "mape_n": float(mape_n),
        "smape": smape(y_true, y_pred),
        "mase": mase(y_true, y_pred, insample, season) if insample is not None else math.nan,
        "bias": bias(y_true, y_pred),
        "n": float(a.size),
    }


# --------------------------------------------------------------------------- #
#  CV containers                                                               #
# --------------------------------------------------------------------------- #
@dataclass
class FoldPrediction:
    """One model's forecast for one CV fold, aligned against the actuals."""

    fold: int
    origin: pd.Timestamp
    dates: pd.DatetimeIndex
    y_true: np.ndarray
    y_pred: np.ndarray

    @property
    def steps(self) -> np.ndarray:
        """1-based horizon step for each prediction in the fold."""
        return np.arange(1, len(self.dates) + 1)

    def to_frame(self) -> pd.DataFrame:
        """Long-format rows, for writing CV diagnostics to CSV."""
        return pd.DataFrame(
            {
                "fold": self.fold,
                "origin": self.origin,
                "date": self.dates,
                "step": self.steps,
                "actual": self.y_true,
                "predicted": self.y_pred,
                "error": self.y_true - self.y_pred,
            }
        )


@dataclass
class ModelEvaluation:
    """Cross-validated performance of a single model on a single target."""

    name: str
    label: str
    target: str
    folds: list[FoldPrediction] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)
    residuals_by_step: dict[int, np.ndarray] = field(default_factory=dict)
    failures: list[str] = field(default_factory=list)
    fit_seconds: float = 0.0
    skipped: bool = False
    skip_reason: str = ""

    @property
    def n_folds(self) -> int:
        """How many folds this model successfully produced a forecast for."""
        return len(self.folds)

    def predictions_frame(self) -> pd.DataFrame:
        """All folds concatenated into one long frame."""
        if not self.folds:
            return pd.DataFrame(
                columns=["fold", "origin", "date", "step", "actual", "predicted", "error"]
            )
        out = pd.concat([f.to_frame() for f in self.folds], ignore_index=True)
        out.insert(0, "model", self.name)
        return out


@dataclass
class EvaluationResult:
    """The full comparison for one target, plus the selected winner."""

    target: str
    evaluations: dict[str, ModelEvaluation]
    leaderboard: pd.DataFrame
    best_model: str | None
    selection_metric: str
    n_folds: int
    horizon: int
    notes: list[str] = field(default_factory=list)

    @property
    def best(self) -> ModelEvaluation | None:
        """The winning model's evaluation, or ``None`` if nothing could fit."""
        return self.evaluations.get(self.best_model) if self.best_model else None

    def cv_predictions(self) -> pd.DataFrame:
        """Every model's fold-level predictions, stacked."""
        frames = [e.predictions_frame() for e in self.evaluations.values() if e.folds]
        if not frames:
            return pd.DataFrame()
        out = pd.concat(frames, ignore_index=True)
        out.insert(0, "target", self.target)
        return out


# --------------------------------------------------------------------------- #
#  Splitting                                                                   #
# --------------------------------------------------------------------------- #
def rolling_origin_splits(
    index: pd.DatetimeIndex, cfg: AppConfig | None = None
) -> list[tuple[int, int]]:
    """
    Build expanding-window train/test boundaries.

    Returns a list of ``(train_end, test_end)`` positional slices, where the
    training set is ``index[:train_end]`` and the test set is
    ``index[train_end:test_end]``.

    When the configured settings do not yield ``cv.min_folds`` folds, the
    initial training window is shrunk (never below two weeks) so that a short
    dataset still produces *some* honest out-of-sample estimate. The number of
    folds actually used is reported, so a two-fold result is never mistaken for
    a twenty-fold one.

    >>> import pandas as pd
    >>> from call_forecast.config import AppConfig, CVConfig
    >>> import dataclasses
    >>> cfg = dataclasses.replace(AppConfig.default(),
    ...     cv=CVConfig(initial_train_days=10, horizon=5, step=5, min_folds=1))
    >>> idx = pd.date_range("2026-01-01", periods=25, freq="D")
    >>> rolling_origin_splits(idx, cfg)
    [(10, 15), (15, 20), (20, 25)]
    """
    cfg = cfg or AppConfig.default()
    n = len(index)
    horizon = max(int(cfg.cv.horizon), 1)
    step = max(int(cfg.cv.step), 1)
    initial = int(cfg.cv.initial_train_days)

    def build(start: int) -> list[tuple[int, int]]:
        out: list[tuple[int, int]] = []
        train_end = start
        while train_end + horizon <= n:
            out.append((train_end, train_end + horizon))
            train_end += step
        return out

    splits = build(initial)
    min_initial = 14
    while len(splits) < cfg.cv.min_folds and initial > min_initial:
        initial = max(min_initial, initial - step)
        splits = build(initial)

    if not splits:
        log.warning(
            "Not enough history for rolling-origin CV: %d days available, "
            "need at least %d (train) + %d (horizon).",
            n, min_initial, horizon,
        )
    return splits


# --------------------------------------------------------------------------- #
#  Evaluation                                                                  #
# --------------------------------------------------------------------------- #
def _evaluate_one(
    name: str,
    target: str,
    daily: pd.DataFrame,
    splits: Sequence[tuple[int, int]],
    cfg: AppConfig,
) -> ModelEvaluation:
    """Run every CV fold for one model, tolerating per-fold failures."""
    from .models import get_model_class

    klass = get_model_class(name)
    evaluation = ModelEvaluation(name=name, label=klass.label, target=target)
    started = time.perf_counter()

    for fold_id, (train_end, test_end) in enumerate(splits, start=1):
        train = daily.iloc[:train_end]
        test = daily.iloc[train_end:test_end]
        horizon = len(test)

        y_true = test[target].to_numpy(dtype=float)
        if not np.isfinite(y_true).any():
            # Nothing to score against in this window (all-NaN duration, say).
            continue

        try:
            model = klass(target, cfg)
            model.fit(train)
            forecast = model.predict(horizon)
        except NotEnoughDataError as exc:
            evaluation.failures.append(f"fold {fold_id}: {exc}")
            continue
        except Exception as exc:  # noqa: BLE001 - one bad fold must not kill the run
            evaluation.failures.append(f"fold {fold_id}: {type(exc).__name__}: {exc}")
            log.debug("Model %s failed on fold %d", name, fold_id, exc_info=True)
            continue

        y_pred = forecast["yhat"].to_numpy(dtype=float)
        evaluation.folds.append(
            FoldPrediction(
                fold=fold_id,
                origin=daily.index[train_end - 1],
                dates=test.index,
                y_true=y_true,
                y_pred=y_pred,
            )
        )

    evaluation.fit_seconds = time.perf_counter() - started

    if not evaluation.folds:
        evaluation.skipped = True
        evaluation.skip_reason = (
            evaluation.failures[0] if evaluation.failures else "no usable CV folds"
        )
        return evaluation

    # -- pooled metrics ------------------------------------------------------ #
    y_true = np.concatenate([f.y_true for f in evaluation.folds])
    y_pred = np.concatenate([f.y_pred for f in evaluation.folds])
    insample = daily[target].dropna().to_numpy(dtype=float)
    evaluation.metrics = compute_metrics(y_true, y_pred, insample=insample, season=7)
    evaluation.metrics["n_folds"] = float(len(evaluation.folds))

    # -- residuals grouped by horizon step ----------------------------------- #
    # Keyed by step so intervals can widen with horizon instead of assuming a
    # day-90 forecast is as reliable as a day-1 forecast.
    by_step: dict[int, list[float]] = {}
    for fold in evaluation.folds:
        for step, actual, predicted in zip(fold.steps, fold.y_true, fold.y_pred):
            if np.isfinite(actual) and np.isfinite(predicted):
                by_step.setdefault(int(step), []).append(float(actual - predicted))
    evaluation.residuals_by_step = {k: np.asarray(v) for k, v in by_step.items()}

    return evaluation


def _build_leaderboard(
    evaluations: dict[str, ModelEvaluation], cfg: AppConfig
) -> pd.DataFrame:
    """Assemble the sorted comparison table shown in the report."""
    rows = []
    for name, ev in evaluations.items():
        row = {
            "model": name,
            "label": ev.label,
            "status": "skipped" if ev.skipped else "ok",
            "n_folds": ev.n_folds,
            "fit_seconds": round(ev.fit_seconds, 2),
        }
        for metric in METRICS:
            row[metric] = ev.metrics.get(metric, math.nan)
        row["mape_n"] = ev.metrics.get("mape_n", math.nan)
        row["note"] = ev.skip_reason if ev.skipped else ""
        rows.append(row)

    board = pd.DataFrame(rows)
    if board.empty:
        return board

    metric = cfg.cv.selection_metric
    tiebreak = cfg.cv.selection_tiebreaker
    ascending = metric in LOWER_IS_BETTER

    # Skipped models sort last regardless of their (absent) metrics.
    board["_sort_ok"] = (board["status"] == "ok").astype(int)
    board = board.sort_values(
        by=["_sort_ok", metric, tiebreak],
        ascending=[False, ascending, tiebreak in LOWER_IS_BETTER],
        na_position="last",
    ).drop(columns="_sort_ok")

    baseline = board.loc[board["model"] == "seasonal_naive"]
    if not baseline.empty and np.isfinite(baseline.iloc[0].get("mae", math.nan)):
        # Nullable boolean: the baseline row itself is neither True nor False,
        # and a plain numpy bool column cannot hold that third state.
        beats = (board["mae"] < float(baseline.iloc[0]["mae"])).astype("boolean")
        beats[board["model"] == "seasonal_naive"] = pd.NA
        board["beats_baseline"] = beats

    return board.reset_index(drop=True)


def evaluate_models(
    daily: pd.DataFrame,
    target: str,
    cfg: AppConfig | None = None,
    model_names: Iterable[str] | None = None,
) -> EvaluationResult:
    """
    Cross-validate every enabled model on one target and pick a winner.

    Selection is by ``cfg.cv.selection_metric`` (MASE by default), with
    ``cfg.cv.selection_tiebreaker`` breaking ties. If the metric is unavailable
    for every model — which happens when the training series is constant, so
    MASE has no scale — selection falls back to MAE, and the fallback is
    recorded in ``result.notes`` rather than applied silently.

    Parameters
    ----------
    daily:
        Base daily frame from :func:`call_forecast.features.build_daily`.
    target:
        Column to forecast.
    cfg:
        Configuration; defaults used when omitted.
    model_names:
        Explicit model list, overriding ``cfg.models.enabled``.

    Returns
    -------
    EvaluationResult
        Per-model evaluations, the sorted leaderboard, and ``best_model``.
    """
    cfg = cfg or AppConfig.default()
    notes: list[str] = []

    splits = rolling_origin_splits(daily.index, cfg)
    if not splits:
        notes.append(
            f"No cross-validation folds were possible for {target}: "
            f"{len(daily)} days of history is below the minimum for a "
            f"{cfg.cv.horizon}-day validation horizon."
        )
        return EvaluationResult(
            target=target, evaluations={}, leaderboard=pd.DataFrame(),
            best_model=None, selection_metric=cfg.cv.selection_metric,
            n_folds=0, horizon=cfg.cv.horizon, notes=notes,
        )

    names = list(model_names) if model_names is not None else list(build_models(target, cfg))
    log.info(
        "Cross-validating %d model(s) on %r: %d fold(s), %d-day horizon.",
        len(names), target, len(splits), cfg.cv.horizon,
    )

    evaluations: dict[str, ModelEvaluation] = {}
    for name in names:
        ev = _evaluate_one(name, target, daily, splits, cfg)
        evaluations[name] = ev
        if ev.skipped:
            log.info("  %-18s skipped (%s)", name, ev.skip_reason)
        else:
            log.info(
                "  %-18s MAE=%7.3f  RMSE=%7.3f  MASE=%6.3f  (%d folds, %.1fs)",
                name, ev.metrics.get("mae", math.nan), ev.metrics.get("rmse", math.nan),
                ev.metrics.get("mase", math.nan), ev.n_folds, ev.fit_seconds,
            )
        if ev.failures:
            log.debug("  %s failures: %s", name, ev.failures[:3])

    leaderboard = _build_leaderboard(evaluations, cfg)

    # -- choose the winner --------------------------------------------------- #
    best_model: str | None = None
    metric = cfg.cv.selection_metric
    usable = leaderboard.loc[leaderboard["status"] == "ok"] if not leaderboard.empty else leaderboard

    if usable.empty:
        notes.append(f"No model could be fitted for {target}.")
    else:
        scored = usable.loc[usable[metric].notna()]
        if scored.empty:
            metric = "mae"
            scored = usable.loc[usable["mae"].notna()]
            notes.append(
                f"{cfg.cv.selection_metric.upper()} was undefined for every model "
                f"on {target} (usually a constant training series); selected on MAE instead."
            )
        if not scored.empty:
            best_model = str(scored.iloc[0]["model"])

    if best_model == "seasonal_naive":
        notes.append(
            "The seasonal-naive baseline won: on this history, no learned model "
            "forecasts better than repeating recent same-weekday values. Treat "
            "the learned models as unproven until more data accumulates."
        )

    n_ok = int((leaderboard["status"] == "ok").sum()) if not leaderboard.empty else 0
    if n_ok and len(splits) < 3:
        notes.append(
            f"Only {len(splits)} validation fold(s) were possible, so the ranking "
            "between close models is not statistically meaningful."
        )

    return EvaluationResult(
        target=target,
        evaluations=evaluations,
        leaderboard=leaderboard,
        best_model=best_model,
        selection_metric=metric,
        n_folds=len(splits),
        horizon=cfg.cv.horizon,
        notes=notes,
    )
