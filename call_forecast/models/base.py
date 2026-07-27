#!/usr/bin/env python3
"""
call_forecast.models.base
=========================
The forecaster interface every model implements, plus the shared recursive
multi-step machinery used by the tabular (scikit-learn / XGBoost) models.

Interface
---------
A :class:`Forecaster` is constructed with a target name and config, fitted on a
**base daily frame** (the output of :func:`call_forecast.features.build_daily`),
and then asked for a horizon:

>>> model = SomeForecaster("call_volume", cfg)      # doctest: +SKIP
>>> model.fit(daily)                                # doctest: +SKIP
>>> fc = model.predict(30)                          # doctest: +SKIP
>>> fc.columns.tolist()                             # doctest: +SKIP
['yhat', 'yhat_lower', 'yhat_upper']

Passing the *daily frame* rather than a pre-built feature matrix is deliberate:
it lets each model decide what it needs (Prophet and SARIMA want the raw
series; the tabular models want engineered features) and it keeps the
recursive forecast honest, because features for future days are rebuilt by the
same :func:`~call_forecast.features.engineer` call used at training time.

Multi-step strategy
-------------------
Tabular models forecast **recursively**: predict day *t+1*, write that
prediction into the history, rebuild features, predict day *t+2*, and so on.
That is what makes lag-1 and rolling-mean features usable at a 90-day horizon.
The cost is error accumulation, which the interval machinery accounts for by
calibrating residuals *per horizon step* rather than pooling them.

Uncertainty
-----------
Point forecasts are turned into intervals from **out-of-sample residuals**
supplied by :mod:`call_forecast.evaluation` via :meth:`Forecaster.calibrate`.
In-sample residuals are used only as a clearly-logged fallback, because they
understate real forecast error badly for tree ensembles.

For aggregated quantities (monthly cost, for example) summing daily quantiles
would be wrong — it assumes perfect correlation. :meth:`Forecaster.sample_paths`
instead draws whole trajectories using a **moving-block bootstrap**, which
preserves the day-to-day autocorrelation of the errors, and the aggregate
interval is taken from the distribution of aggregated paths.
"""

from __future__ import annotations

import abc
import logging
from typing import Any, Sequence

import numpy as np
import pandas as pd

from ..config import AppConfig
from ..features import FeatureSpec, engineer, extend_calendar

log = logging.getLogger(__name__)

__all__ = ["Forecaster", "TabularForecaster", "NotEnoughDataError"]


class NotEnoughDataError(RuntimeError):
    """Raised when a model has too little history to fit responsibly."""


# --------------------------------------------------------------------------- #
#  Base                                                                        #
# --------------------------------------------------------------------------- #
class Forecaster(abc.ABC):
    """Abstract base for every forecasting model in the package."""

    #: Registry key, e.g. ``"xgboost"``. Set by each subclass.
    name: str = "base"
    #: Human-readable label used in reports and charts.
    label: str = "Base"
    #: Whether this model consumes engineered features (vs. the raw series).
    uses_features: bool = False

    def __init__(self, target: str, cfg: AppConfig | None = None):
        self.target = target
        self.cfg = cfg or AppConfig.default()
        self.fitted_ = False

        self._daily: pd.DataFrame | None = None       # training history
        self._train_index: pd.DatetimeIndex | None = None
        self._insample_residuals: np.ndarray | None = None
        self._residuals_by_step: dict[int, np.ndarray] | None = None
        self._rng = np.random.default_rng(self.cfg.models.random_state)

    # -- required hooks ----------------------------------------------------- #
    @abc.abstractmethod
    def _fit(self, daily: pd.DataFrame) -> None:
        """Fit the underlying estimator. ``daily`` contains history only."""

    @abc.abstractmethod
    def _predict_point(self, horizon: int) -> pd.Series:
        """Return ``horizon`` point forecasts indexed by future date."""

    # -- public API --------------------------------------------------------- #
    def fit(self, daily: pd.DataFrame) -> "Forecaster":
        """
        Fit on a base daily frame.

        Raises
        ------
        NotEnoughDataError
            If fewer than ``cfg.models.min_observations[self.name]`` usable
            observations of the target exist. Models are skipped rather than
            fitted on a handful of points and silently trusted.
        """
        if self.target not in daily.columns:
            raise ValueError(f"Target {self.target!r} not present in the daily frame.")

        usable = int(daily[self.target].notna().sum())
        required = self.cfg.models.min_observations.get(self.name, 1)
        if usable < required:
            raise NotEnoughDataError(
                f"{self.label} needs >= {required} observations of "
                f"{self.target!r} but only {usable} are available."
            )

        self._daily = daily.copy()
        self._train_index = daily.index
        self._fit(self._daily)
        self.fitted_ = True
        return self

    def predict(self, horizon: int, level: float | None = None) -> pd.DataFrame:
        """
        Forecast ``horizon`` days ahead with a central prediction interval.

        Parameters
        ----------
        horizon:
            Number of days to forecast.
        level:
            Central interval width (e.g. ``0.80`` -> p10/p90). Defaults to
            ``cfg.forecast.interval_level``.

        Returns
        -------
        pandas.DataFrame
            Indexed by future date with ``yhat``, ``yhat_lower``, ``yhat_upper``.
        """
        self._check_fitted()
        level = self.cfg.forecast.interval_level if level is None else level

        point = self._predict_point(horizon)
        point = self._postprocess(point)

        native = self._native_interval(horizon, level)
        if native is not None:
            lower, upper = native
        else:
            lower, upper = self._residual_interval(point, level)

        out = pd.DataFrame(
            {
                "yhat": point.to_numpy(dtype=float),
                "yhat_lower": np.asarray(lower, dtype=float),
                "yhat_upper": np.asarray(upper, dtype=float),
            },
            index=point.index,
        )
        # Clip bounds to the same domain as the point forecast, and repair any
        # inversion a native interval might produce near zero.
        if self.target in self.cfg.forecast.non_negative_targets:
            out[["yhat_lower", "yhat_upper"]] = out[["yhat_lower", "yhat_upper"]].clip(lower=0.0)
        out["yhat_lower"] = np.minimum(out["yhat_lower"], out["yhat"])
        out["yhat_upper"] = np.maximum(out["yhat_upper"], out["yhat"])
        out.index.name = "date"
        return out

    def calibrate(self, residuals_by_step: dict[int, np.ndarray]) -> "Forecaster":
        """
        Supply out-of-sample residuals, keyed by horizon step (1-based).

        Called by :mod:`call_forecast.evaluation` with the residuals collected
        during rolling-origin CV, so intervals widen with horizon the way real
        forecast error does.
        """
        cleaned = {
            int(step): np.asarray(vals, dtype=float)[np.isfinite(vals)]
            for step, vals in residuals_by_step.items()
        }
        self._residuals_by_step = {k: v for k, v in cleaned.items() if v.size}
        return self

    def sample_paths(self, horizon: int, n_paths: int | None = None) -> np.ndarray:
        """
        Simulate whole forecast trajectories for aggregate uncertainty.

        Returns an ``(n_paths, horizon)`` array. Errors are drawn with a
        **moving-block bootstrap** (block length 7 days) so that within a path
        the day-to-day errors stay autocorrelated the way real errors are.
        Summing independent daily quantiles instead would produce monthly
        intervals that are far too narrow.
        """
        self._check_fitted()
        n_paths = n_paths or self.cfg.forecast.n_simulations

        point = self._postprocess(self._predict_point(horizon)).to_numpy(dtype=float)
        pool = self._residual_pool()
        if pool.size == 0:
            return np.tile(point, (n_paths, 1))

        # Scale the residual pool per step so later days inherit wider error,
        # matching the per-step residuals when they are available.
        scale = self._step_scale(horizon)

        block = min(7, max(1, pool.size))
        n_blocks = int(np.ceil(horizon / block))
        starts = self._rng.integers(0, max(pool.size - block + 1, 1), size=(n_paths, n_blocks))
        offsets = np.arange(block)
        idx = (starts[:, :, None] + offsets[None, None, :]) % pool.size
        draws = pool[idx].reshape(n_paths, -1)[:, :horizon]

        paths = point[None, :] + draws * scale[None, :]
        if self.target in self.cfg.forecast.non_negative_targets:
            paths = self._enforce_non_negative(paths, point)
        return paths

    @staticmethod
    def _enforce_non_negative(paths: np.ndarray, point: np.ndarray) -> np.ndarray:
        """
        Impose the non-negativity floor without biasing the distribution upward.

        Clipping alone is not enough. Truncating the negative tail at zero moves
        probability mass upward, so the simulated mean drifts *above* the point
        forecast — and the drift compounds with the residual scale, which grows
        with horizon. At the scale a day-90 forecast reaches, the inflation is
        large enough to push even the 10th percentile of a 30-day sum above the
        sum of the point forecasts, producing the nonsense of an interval that
        does not contain its own forecast.

        The repair is to clip and then rescale each day's column by a positive
        factor so its mean returns to the point forecast. A positive factor
        cannot reintroduce negatives, and the result is a non-negative
        distribution centred where it should be. The cost is slightly narrower
        spread than the raw residuals imply, which is the right trade: an
        interval that is marginally tight beats one that is systematically
        displaced.

        Days whose point forecast is zero are left clipped, since there is no
        positive mean to rescale toward.
        """
        clipped = np.clip(paths, 0.0, None)
        realised = clipped.mean(axis=0)

        adjustable = (point > 0) & (realised > 0)
        factor = np.ones_like(point, dtype=float)
        factor[adjustable] = point[adjustable] / realised[adjustable]
        return clipped * factor[None, :]

    # -- interval helpers --------------------------------------------------- #
    def _native_interval(
        self, horizon: int, level: float
    ) -> tuple[np.ndarray, np.ndarray] | None:
        """
        Model-supplied interval, when the model has one.

        Prophet and SARIMA override this; tabular models return ``None`` and
        fall back to residual quantiles.
        """
        return None

    def _raw_residual_pool(self) -> np.ndarray:
        """Flattened residual sample, exactly as measured (bias included)."""
        if self._residuals_by_step:
            return np.concatenate(list(self._residuals_by_step.values()))
        if self._insample_residuals is not None:
            return self._insample_residuals[np.isfinite(self._insample_residuals)]
        return np.asarray([], dtype=float)

    @property
    def residual_bias(self) -> float:
        """
        Mean residual (actual - forecast) observed in validation.

        Positive means the model systematically **under**-forecasts. This is
        reported rather than silently subtracted from the forecast: on a short
        series the measured bias is itself estimated from very few points, and
        "correcting" by it would fit noise. Callers surface it as a caveat.
        """
        pool = self._raw_residual_pool()
        return float(np.mean(pool)) if pool.size else 0.0

    def _residual_pool(self) -> np.ndarray:
        """
        Mean-centred residuals, used for interval width and path simulation.

        Centring matters for coherence. Residuals from a biased model have a
        non-zero mean, so bootstrapping them *uncentred* shifts every simulated
        path in the direction of the bias — over a 30-day sum that compounds
        until the interval no longer contains its own point forecast, which is
        nonsense to publish. Centring makes the interval describe *spread*
        around the forecast; the bias itself is reported separately via
        :attr:`residual_bias`.
        """
        pool = self._raw_residual_pool()
        if pool.size == 0:
            return pool
        return pool - float(np.mean(pool))

    def _step_scale(self, horizon: int) -> np.ndarray:
        """
        Per-step multiplier applied to the residual pool.

        With CV residuals we use the observed spread at each step (relative to
        step 1), which naturally grows with horizon. Without them we fall back
        to the classic random-walk ``sqrt(step)`` widening, which is the
        conventional assumption when nothing better is known.
        """
        steps = np.arange(1, horizon + 1)
        if not self._residuals_by_step:
            return np.sqrt(steps)

        available = sorted(self._residuals_by_step)
        base = np.std(self._residuals_by_step[available[0]])
        if not np.isfinite(base) or base <= 0:
            return np.sqrt(steps)

        scale = np.empty(horizon, dtype=float)
        for i, step in enumerate(steps):
            nearest = min(available, key=lambda s: abs(s - step))
            sd = float(np.std(self._residuals_by_step[nearest]))
            # Beyond the CV horizon, keep widening rather than flat-lining.
            extrapolate = np.sqrt(max(step, 1) / max(nearest, 1))
            scale[i] = (sd / base) * extrapolate
        return scale

    def _residual_interval(
        self, point: pd.Series, level: float
    ) -> tuple[np.ndarray, np.ndarray]:
        """Empirical interval from residual quantiles, widening with horizon."""
        alpha = (1.0 - level) / 2.0
        pool = self._residual_pool()
        horizon = len(point)

        if pool.size < 5:
            log.warning(
                "%s/%s: only %d residual(s) available; intervals fall back to a "
                "+/-50%% heuristic and should be treated as indicative only.",
                self.label, self.target, pool.size,
            )
            values = point.to_numpy(dtype=float)
            return values * 0.5, values * 1.5

        if self._residuals_by_step is None:
            log.info(
                "%s/%s: using in-sample residuals for intervals (no CV residuals "
                "supplied); real coverage will be wider than stated.",
                self.label, self.target,
            )

        scale = self._step_scale(horizon)
        lo_q, hi_q = np.quantile(pool, [alpha, 1.0 - alpha])
        values = point.to_numpy(dtype=float)
        return values + lo_q * scale, values + hi_q * scale

    # -- shared utilities --------------------------------------------------- #
    def _postprocess(self, point: pd.Series) -> pd.Series:
        """Clip negatives and round integer-valued targets."""
        out = point.astype(float)
        if self.target in self.cfg.forecast.non_negative_targets:
            out = out.clip(lower=0.0)
        if self.target in self.cfg.forecast.round_integer_targets:
            out = out.round()
        return out

    def _future_index(self, horizon: int) -> pd.DatetimeIndex:
        """Daily index of the next ``horizon`` days after the training data."""
        assert self._daily is not None
        start = self._daily.index.max() + pd.Timedelta(days=1)
        return pd.date_range(start, periods=horizon, freq="D", name="date")

    def _check_fitted(self) -> None:
        if not self.fitted_:
            raise RuntimeError(f"{self.label} must be fitted before predicting.")

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        state = "fitted" if self.fitted_ else "unfitted"
        return f"<{type(self).__name__} target={self.target!r} ({state})>"


# --------------------------------------------------------------------------- #
#  Tabular (feature-based) forecasters                                         #
# --------------------------------------------------------------------------- #
class TabularForecaster(Forecaster):
    """
    Base for models that learn ``target ~ engineered features``.

    Subclasses only need to supply :meth:`_build_estimator`; the feature
    assembly, NaN policy, recursive multi-step loop and importance extraction
    all live here.
    """

    uses_features = True
    #: Set True by subclasses whose estimator handles NaN natively (XGBoost).
    handles_nan: bool = False

    def __init__(self, target: str, cfg: AppConfig | None = None):
        super().__init__(target, cfg)
        self.estimator_: Any = None
        self.spec_: FeatureSpec | None = None
        self.feature_names_: list[str] = []
        self.train_matrix_: pd.DataFrame | None = None
        self.train_target_: pd.Series | None = None
        #: Feature rows built for the most recent forecast, retained so
        #: `call_forecast.explain` can answer "why this prediction?" per day.
        self.future_matrix_: pd.DataFrame | None = None

    # -- required hook ------------------------------------------------------ #
    @abc.abstractmethod
    def _build_estimator(self):
        """Return an unfitted scikit-learn-compatible estimator/pipeline."""

    # -- fitting ------------------------------------------------------------ #
    def _fit(self, daily: pd.DataFrame) -> None:
        frame, spec = engineer(daily, self.cfg)
        self.spec_ = spec
        self.feature_names_ = spec.for_target(self.target)
        if not self.feature_names_:
            raise NotEnoughDataError(
                f"No usable features remain for {self.target!r} after dropping "
                "degenerate columns."
            )

        X, y = self._training_matrix(frame)
        if len(y) < self.cfg.models.min_observations.get(self.name, 1):
            raise NotEnoughDataError(
                f"{self.label} has only {len(y)} complete training row(s) for "
                f"{self.target!r} after feature warm-up."
            )

        self.train_matrix_, self.train_target_ = X, y
        self.estimator_ = self._build_estimator()
        self.estimator_.fit(X, y)

        fitted = np.asarray(self.estimator_.predict(X), dtype=float)
        self._insample_residuals = y.to_numpy(dtype=float) - fitted

    def _training_matrix(self, frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
        """
        Select trainable rows and columns.

        Rows are kept when the target is observed. For zero-call days the
        duration target is genuinely undefined (not zero), so those rows drop
        out here rather than being imputed with a misleading value.
        """
        X = frame[self.feature_names_].copy()
        y = frame[self.target].copy()

        mask = y.notna()
        # The first rows have all-NaN lag features; drop rows with no usable
        # predictor at all, but keep partially-warm rows for the imputer.
        mask &= X.notna().any(axis=1)
        X, y = X.loc[mask], y.loc[mask]
        return X, y.astype(float)

    # -- recursive multi-step prediction ------------------------------------ #
    def _predict_point(self, horizon: int) -> pd.Series:
        """
        Roll the model forward one day at a time.

        Each iteration appends a single future day, rebuilds every feature with
        the same :func:`engineer` call used in training, predicts, and writes
        the prediction back into the history so the next day's lag and rolling
        features see it.
        """
        assert self._daily is not None
        state = self._daily.copy()
        target_pos = state.columns.get_loc(self.target)
        seed = self._carry_forward_seed(state)

        predictions: list[float] = []
        rows: list[pd.DataFrame] = []
        for _ in range(horizon):
            state = extend_calendar(state, 1)
            # Seed non-target base columns so downstream derived features stay
            # sane; the target itself is filled from the model below.
            for col, value in seed.items():
                if col != self.target:
                    state.iloc[-1, state.columns.get_loc(col)] = value

            frame, _ = engineer(state, self.cfg)
            row = frame.iloc[[-1]].reindex(columns=self.feature_names_)
            yhat = float(np.asarray(self.estimator_.predict(row), dtype=float)[0])
            yhat = self._clip_one(yhat)

            state.iloc[-1, target_pos] = yhat
            predictions.append(yhat)
            rows.append(row)

        self.future_matrix_ = pd.concat(rows) if rows else None
        if self.future_matrix_ is not None:
            self.future_matrix_.index = self._future_index(horizon)

        return pd.Series(predictions, index=self._future_index(horizon), name=self.target)

    def _carry_forward_seed(self, state: pd.DataFrame) -> dict[str, float]:
        """
        Trailing-mean value for each base column, used to seed future rows.

        These are *observed* quantities (cost per minute, missed-call share,
        latency) that cannot be known in advance. Holding them at their recent
        average is the standard assumption; scenario analysis is the place to
        vary them deliberately.
        """
        window = self.cfg.features.exog_carry_forward_days
        tail = state.tail(window)
        seed: dict[str, float] = {}
        for col in state.columns:
            values = pd.to_numeric(tail[col], errors="coerce")
            mean = float(values.mean()) if values.notna().any() else np.nan
            seed[col] = 0.0 if not np.isfinite(mean) else mean
        return seed

    def _clip_one(self, value: float) -> float:
        """Apply the target's domain constraints to a single prediction."""
        if not np.isfinite(value):
            return 0.0
        if self.target in self.cfg.forecast.non_negative_targets:
            value = max(value, 0.0)
        if self.target in self.cfg.forecast.round_integer_targets:
            value = float(round(value))
        return value

    # -- explainability ----------------------------------------------------- #
    def feature_importance(self) -> pd.Series:
        """
        Native importance, as a Series indexed by feature name.

        Tree models return impurity/gain importance; linear models return the
        absolute standardised coefficient. Both are *relative* measures — see
        :mod:`call_forecast.explain` for SHAP and permutation importance, which
        are comparable across model families.
        """
        self._check_fitted()
        est = self._final_estimator()

        if hasattr(est, "feature_importances_"):
            values = np.asarray(est.feature_importances_, dtype=float)
        elif hasattr(est, "coef_"):
            values = np.abs(np.ravel(est.coef_)).astype(float)
        else:
            return pd.Series(dtype=float)

        if values.size != len(self.feature_names_):  # pragma: no cover - defensive
            return pd.Series(dtype=float)
        return pd.Series(values, index=self.feature_names_).sort_values(ascending=False)

    def _final_estimator(self):
        """Unwrap a Pipeline to reach the estimator that carries importances."""
        est = self.estimator_
        return est.steps[-1][1] if hasattr(est, "steps") else est
