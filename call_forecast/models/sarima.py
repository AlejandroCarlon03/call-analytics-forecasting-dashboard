#!/usr/bin/env python3
"""
call_forecast.models.sarima
===========================
Seasonal ARIMA via ``statsmodels`` SARIMAX.

SARIMA is the classical counterweight to the machine-learning models: it works
directly on the series, models autocorrelation explicitly, and derives its
prediction intervals from the estimated error variance rather than from
resampled residuals. On short daily series with a weekly cycle it is often
competitive with — and sometimes better than — the boosted trees.

Missing observations are passed straight through: SARIMAX is a state-space
model, so its Kalman filter handles gaps natively. That is genuinely useful
here, because the average-duration target is undefined (not zero) on days with
no calls, and imputing those days would fabricate signal.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd

from ..config import AppConfig
from .base import Forecaster, NotEnoughDataError

log = logging.getLogger(__name__)

__all__ = ["SarimaForecaster"]


class SarimaForecaster(Forecaster):
    """
    SARIMA with a weekly (period-7) seasonal component.

    The configured seasonal order is *demoted* rather than blindly applied when
    the history is too short to identify it: fitting a seasonal AR term needs
    several complete cycles, and a seasonal SARIMA fitted to three weeks of
    data produces confident, meaningless forecasts. Demotion is logged so the
    report shows what was actually fitted.
    """

    name = "sarima"
    label = "SARIMA"
    uses_features = False

    #: Complete seasonal cycles required before the seasonal terms are kept.
    MIN_SEASONAL_CYCLES = 3

    def __init__(self, target: str, cfg: AppConfig | None = None):
        super().__init__(target, cfg)
        self.result_ = None
        self.order_: tuple = (1, 0, 1)
        self.seasonal_order_: tuple = (0, 0, 0, 0)
        self._last_forecast = None

    # -- fitting ------------------------------------------------------------ #
    def _resolve_orders(self, n_obs: int) -> tuple[tuple, tuple]:
        """Pick the (p,d,q) and seasonal orders that the data can support."""
        params = dict(self.cfg.models.sarima)
        order = tuple(params.get("order", (1, 0, 1)))
        seasonal = tuple(params.get("seasonal_order", (1, 0, 1, 7)))

        period = int(seasonal[3]) if len(seasonal) == 4 else 0
        if period > 1:
            needed = period * self.MIN_SEASONAL_CYCLES
            if n_obs < needed:
                log.info(
                    "SARIMA/%s: dropping seasonal order %s - needs >= %d "
                    "observations for %d complete cycles, have %d.",
                    self.target, seasonal, needed, self.MIN_SEASONAL_CYCLES, n_obs,
                )
                seasonal = (0, 0, 0, 0)

        # Each AR/MA/seasonal term costs a degree of freedom; keep the total
        # parameter count well under the sample size.
        n_params = order[0] + order[2] + seasonal[0] + seasonal[2]
        if n_obs < 4 * max(n_params, 1):
            order = (1, 0, 0)
            seasonal = (0, 0, 0, 0)
            log.info(
                "SARIMA/%s: reduced to ARIMA(1,0,0) for a %d-observation series.",
                self.target, n_obs,
            )
        return order, seasonal

    def _fit(self, daily: pd.DataFrame) -> None:
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        series = daily[self.target].astype(float)
        # Trim leading/trailing gaps; interior NaNs are handled by the filter.
        observed = series.dropna()
        if observed.empty:
            raise NotEnoughDataError(f"{self.label}: no observations of {self.target!r}.")
        series = series.loc[observed.index.min(): observed.index.max()]
        series = series.asfreq("D")

        n_obs = int(series.notna().sum())
        if series.nunique(dropna=True) <= 1:
            raise NotEnoughDataError(
                f"{self.label}: {self.target!r} is constant; nothing to fit."
            )

        self.order_, self.seasonal_order_ = self._resolve_orders(n_obs)
        trend = self.cfg.models.sarima.get("trend", "c")
        # A constant is not identifiable alongside differencing.
        if self.order_[1] > 0 or self.seasonal_order_[1] > 0:
            trend = None

        with warnings.catch_warnings():
            # Short series routinely trip convergence and non-invertibility
            # warnings; they are informative but not actionable per-fold, and
            # the fitted flag below is the check that actually matters.
            warnings.simplefilter("ignore")
            model = SARIMAX(
                series,
                order=self.order_,
                seasonal_order=self.seasonal_order_,
                trend=trend,
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            self.result_ = model.fit(disp=False, maxiter=200)

        resid = np.asarray(self.result_.resid, dtype=float)
        self._insample_residuals = resid[np.isfinite(resid)]
        self._last_forecast = None

    # -- prediction --------------------------------------------------------- #
    def _run(self, horizon: int):
        """Forecast once and cache, so point and interval agree."""
        if self._last_forecast is not None and self._last_forecast[0] == horizon:
            return self._last_forecast[1]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fc = self.result_.get_forecast(steps=horizon)
        self._last_forecast = (horizon, fc)
        return fc

    def _predict_point(self, horizon: int) -> pd.Series:
        fc = self._run(horizon)
        values = np.asarray(fc.predicted_mean, dtype=float)
        return pd.Series(values, index=self._future_index(horizon), name=self.target)

    def _native_interval(self, horizon: int, level: float):
        """Interval from the state-space model's own forecast error variance."""
        fc = self._run(horizon)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ci = fc.conf_int(alpha=1.0 - level)
        values = np.asarray(ci, dtype=float)
        if values.ndim != 2 or values.shape[1] != 2:  # pragma: no cover - defensive
            return None
        return values[:, 0], values[:, 1]

    @property
    def spec(self) -> str:
        """The order actually fitted, e.g. ``SARIMA(1,0,1)(1,0,1,7)``."""
        if self.seasonal_order_ and self.seasonal_order_[3]:
            return f"SARIMA{self.order_}{self.seasonal_order_}"
        return f"ARIMA{self.order_}"
