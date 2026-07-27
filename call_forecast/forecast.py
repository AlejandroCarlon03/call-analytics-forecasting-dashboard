#!/usr/bin/env python3
"""
call_forecast.forecast
======================
Fit the winning model on all available history and produce the deliverables:
30/60/90-day daily forecasts with intervals, and monthly cost projections.

Two details here are what separate a forecast you can act on from a plausible
looking line on a chart:

**Intervals come from out-of-sample error.** The model selected by
:mod:`call_forecast.evaluation` is refitted on the full history, then
:meth:`~call_forecast.models.base.Forecaster.calibrate` is handed the residuals
that model actually made during rolling-origin CV, grouped by horizon step. A
day-90 interval is therefore wider than a day-1 interval because the model was
genuinely worse at 90 days, not because of an assumed formula.

**Monthly totals are simulated, not summed.** Adding up 30 daily upper bounds
would describe a month in which every single day independently lands at its
worst case — an outcome with a probability far below the stated level. Instead
:meth:`~call_forecast.models.base.Forecaster.sample_paths` draws whole
trajectories with a block bootstrap that preserves day-to-day error
correlation, each path is summed, and the monthly interval is read off the
distribution of those sums.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig
from .evaluation import EvaluationResult
from .models import Forecaster, NotEnoughDataError, get_model_class

log = logging.getLogger(__name__)

__all__ = [
    "ForecastResult",
    "generate_forecast",
    "forecast_all_targets",
    "monthly_summary",
]


# --------------------------------------------------------------------------- #
#  Result container                                                            #
# --------------------------------------------------------------------------- #
@dataclass
class ForecastResult:
    """Everything produced for one target by one selected model."""

    target: str
    model_name: str
    model_label: str
    #: Daily forecast, indexed by date, with yhat / yhat_lower / yhat_upper /
    #: horizon_bucket ("30d", "60d", "90d") / step.
    daily: pd.DataFrame
    #: Calendar-month aggregation with simulated intervals.
    monthly: pd.DataFrame
    #: Fitted model, retained for SHAP and scenario analysis.
    model: Forecaster | None = None
    #: (n_paths, horizon) simulated trajectories.
    paths: np.ndarray | None = None
    interval_level: float = 0.80
    calibrated: bool = False
    notes: list[str] = field(default_factory=list)

    def horizon(self, days: int) -> pd.DataFrame:
        """Slice the first ``days`` rows of the daily forecast."""
        return self.daily.iloc[:days].copy()

    def total(self, days: int) -> dict[str, float]:
        """
        Simulated total over the first ``days`` (sum for counts/cost).

        Falls back to summing point forecasts when no simulated paths exist.
        """
        window = self.daily.iloc[:days]
        point = float(window["yhat"].sum())
        if self.paths is None:
            return {"total": point, "lower": float(window["yhat_lower"].sum()),
                    "upper": float(window["yhat_upper"].sum())}
        alpha = (1.0 - self.interval_level) / 2.0
        sums = self.paths[:, :days].sum(axis=1)
        lo, hi = np.quantile(sums, [alpha, 1.0 - alpha])
        return {"total": point, "lower": float(lo), "upper": float(hi)}

    def mean(self, days: int) -> dict[str, float]:
        """Simulated daily average over the first ``days``."""
        window = self.daily.iloc[:days]
        point = float(window["yhat"].mean())
        if self.paths is None:
            return {"mean": point, "lower": float(window["yhat_lower"].mean()),
                    "upper": float(window["yhat_upper"].mean())}
        alpha = (1.0 - self.interval_level) / 2.0
        means = self.paths[:, :days].mean(axis=1)
        lo, hi = np.quantile(means, [alpha, 1.0 - alpha])
        return {"mean": point, "lower": float(lo), "upper": float(hi)}


# --------------------------------------------------------------------------- #
#  Monthly aggregation                                                         #
# --------------------------------------------------------------------------- #
def monthly_summary(
    daily: pd.DataFrame,
    paths: np.ndarray | None,
    target: str,
    level: float,
    aggregate: str = "sum",
) -> pd.DataFrame:
    """
    Aggregate a daily forecast into calendar months.

    Parameters
    ----------
    daily:
        Daily forecast frame with a ``yhat`` column, indexed by date.
    paths:
        ``(n_paths, horizon)`` simulated trajectories, or ``None``.
    target:
        Target name, recorded on each row.
    level:
        Central interval level for the monthly bounds.
    aggregate:
        ``"sum"`` for additive targets (volume, cost) or ``"mean"`` for
        average-type targets (duration), where a monthly *sum* of daily
        averages would be meaningless.

    Returns
    -------
    pandas.DataFrame
        One row per calendar month, with a ``partial_month`` flag so a month
        the forecast only half-covers is never read as a full-month total.
    """
    if aggregate not in {"sum", "mean"}:
        raise ValueError("aggregate must be 'sum' or 'mean'")

    index = daily.index
    months = index.to_period("M")
    alpha = (1.0 - level) / 2.0

    rows = []
    for period in months.unique():
        mask = np.asarray(months == period)
        window = daily.loc[mask]
        point = float(getattr(window["yhat"], aggregate)())

        if paths is not None and paths.shape[1] == len(index):
            agg = paths[:, mask].sum(axis=1) if aggregate == "sum" else paths[:, mask].mean(axis=1)
            lower, upper = (float(v) for v in np.quantile(agg, [alpha, 1.0 - alpha]))
        else:
            lower = float(getattr(window["yhat_lower"], aggregate)())
            upper = float(getattr(window["yhat_upper"], aggregate)())

        days_in_month = period.days_in_month
        rows.append(
            {
                "target": target,
                "month": str(period),
                "month_start": period.start_time.normalize(),
                "days_forecast": int(mask.sum()),
                "days_in_month": int(days_in_month),
                "partial_month": bool(mask.sum() < days_in_month),
                "yhat": point,
                "yhat_lower": lower,
                "yhat_upper": upper,
                "aggregate": aggregate,
            }
        )
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
#  Forecast generation                                                         #
# --------------------------------------------------------------------------- #
def _residuals_for(evaluation: EvaluationResult, model_name: str) -> dict[int, np.ndarray]:
    """Pull a model's per-step CV residuals out of an evaluation result."""
    ev = evaluation.evaluations.get(model_name)
    return dict(ev.residuals_by_step) if ev else {}


def generate_forecast(
    daily: pd.DataFrame,
    target: str,
    evaluation: EvaluationResult,
    cfg: AppConfig | None = None,
    model_name: str | None = None,
) -> ForecastResult:
    """
    Refit the selected model on all history and forecast the longest horizon.

    The 30-, 60- and 90-day views are slices of a single 90-day recursive
    forecast rather than three separate runs, so they are guaranteed mutually
    consistent — the first 30 days of the 90-day forecast *are* the 30-day
    forecast.

    Parameters
    ----------
    daily:
        Full base daily frame.
    target:
        Column to forecast.
    evaluation:
        Result from :func:`call_forecast.evaluation.evaluate_models`, used for
        model selection and residual calibration.
    cfg:
        Configuration; defaults used when omitted.
    model_name:
        Override the automatically selected model.

    Raises
    ------
    NotEnoughDataError
        If no model could be selected or the chosen model cannot fit the full
        history.
    """
    cfg = cfg or AppConfig.default()
    notes: list[str] = []

    chosen = model_name or evaluation.best_model
    if chosen is None:
        raise NotEnoughDataError(
            f"No model could be selected for {target!r}; there is not enough "
            "history to validate any candidate."
        )

    horizon = max(cfg.forecast.horizons)
    klass = get_model_class(chosen)
    model = klass(target, cfg)
    model.fit(daily)

    residuals = _residuals_for(evaluation, chosen)
    if residuals:
        model.calibrate(residuals)
        calibrated = True
    else:
        calibrated = False
        notes.append(
            f"No cross-validation residuals were available for {chosen}; "
            "prediction intervals fall back to in-sample error and will be "
            "narrower than true forecast uncertainty."
        )

    forecast = model.predict(horizon, level=cfg.forecast.interval_level)
    forecast["step"] = np.arange(1, len(forecast) + 1)
    forecast["horizon_bucket"] = pd.cut(
        forecast["step"],
        bins=[0, *cfg.forecast.horizons],
        labels=[f"{h}d" for h in cfg.forecast.horizons],
        include_lowest=True,
    )
    forecast["model"] = chosen
    forecast["target"] = target

    paths = model.sample_paths(horizon, cfg.forecast.n_simulations)

    aggregate = "mean" if target == "avg_duration_sec" else "sum"
    monthly = monthly_summary(
        forecast, paths, target, cfg.forecast.interval_level, aggregate
    )

    # The CV horizon bounds how far the residual calibration is evidence-based;
    # beyond it the widening is extrapolated, which the report should say.
    if calibrated and horizon > evaluation.horizon:
        max_step = max(residuals) if residuals else 0
        notes.append(
            f"Intervals are calibrated on out-of-sample error up to day "
            f"{max_step}; beyond that they are extrapolated and should be read "
            "as indicative."
        )

    # A systematic validation bias is reported, not silently corrected: with
    # this few folds the bias estimate is itself mostly noise, but the user
    # should know which direction the model has been missing in.
    bias = model.residual_bias
    mean_level = float(forecast["yhat"].mean())
    if mean_level > 0 and abs(bias) > 0.10 * mean_level:
        direction = "under" if bias > 0 else "over"
        notes.append(
            f"In backtesting this model {direction}-forecast {target} by "
            f"{abs(bias):.3g} per day on average ({abs(bias) / mean_level:.0%} of "
            "the forecast level). The forecast is not adjusted for this — the "
            "bias is estimated from few folds — but expect actuals to land "
            f"{'above' if bias > 0 else 'below'} the line more often than not."
        )

    log.info(
        "Forecast %s with %s: %d days, mean %.3f (%.3f .. %.3f at %.0f%%).",
        target, chosen, horizon, forecast["yhat"].mean(),
        forecast["yhat_lower"].mean(), forecast["yhat_upper"].mean(),
        cfg.forecast.interval_level * 100,
    )

    return ForecastResult(
        target=target,
        model_name=chosen,
        model_label=klass.label,
        daily=forecast,
        monthly=monthly,
        model=model,
        paths=paths,
        interval_level=cfg.forecast.interval_level,
        calibrated=calibrated,
        notes=notes,
    )


def forecast_all_targets(
    daily: pd.DataFrame,
    evaluations: dict[str, EvaluationResult],
    cfg: AppConfig | None = None,
) -> dict[str, ForecastResult]:
    """
    Produce a forecast for every configured target.

    A target that cannot be forecast (too little history, every model skipped)
    is logged and omitted rather than aborting the run, so the remaining
    targets still deliver.
    """
    cfg = cfg or AppConfig.default()
    out: dict[str, ForecastResult] = {}
    for target in cfg.forecast.targets:
        evaluation = evaluations.get(target)
        if evaluation is None:
            log.warning("No evaluation for %s; skipping its forecast.", target)
            continue
        try:
            out[target] = generate_forecast(daily, target, evaluation, cfg)
        except (NotEnoughDataError, ValueError) as exc:
            log.warning("Could not forecast %s: %s", target, exc)
    return out
