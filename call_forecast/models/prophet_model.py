#!/usr/bin/env python3
"""
call_forecast.models.prophet_model
==================================
Facebook/Meta Prophet: additive trend + seasonality + holiday effects.

Prophet is the strongest member of the comparison when the series has a clear
weekly rhythm and a trend that needs extrapolating — the case the tree models
structurally cannot handle. It also produces its own uncertainty intervals from
its posterior, so it bypasses the residual-bootstrap machinery in
:class:`~call_forecast.models.base.Forecaster`.

Prophet is an **optional dependency**. If it is not installed the model is
skipped with a logged reason and the rest of the leaderboard still runs.
"""

from __future__ import annotations

import contextlib
import io
import logging
import os

import numpy as np
import pandas as pd

from ..config import AppConfig
from ..features import _holiday_set
from .base import Forecaster, NotEnoughDataError

log = logging.getLogger(__name__)

__all__ = ["ProphetForecaster", "PROPHET_AVAILABLE"]

try:  # pragma: no cover - environment dependent
    from prophet import Prophet as _Prophet

    PROPHET_AVAILABLE = True
except ImportError:  # pragma: no cover - environment dependent
    _Prophet = None
    PROPHET_AVAILABLE = False


@contextlib.contextmanager
def _quiet():
    """
    Silence Prophet's Stan backend.

    cmdstanpy logs an INFO line per fit and Stan writes progress to the real
    stdout file descriptor, which turns a 20-fold CV run into hundreds of lines
    of noise that bury the pipeline's own output.
    """
    loggers = [logging.getLogger(n) for n in ("cmdstanpy", "prophet", "stan")]
    previous = [(lg, lg.level, lg.propagate) for lg in loggers]
    for lg in loggers:
        lg.setLevel(logging.CRITICAL)
        lg.propagate = False
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            yield
    finally:
        for lg, level, propagate in previous:
            lg.setLevel(level)
            lg.propagate = propagate


class ProphetForecaster(Forecaster):
    """
    Prophet with a weekly seasonality and the configured holiday calendar.

    Two guards matter on short history:

    * **Yearly seasonality** is only enabled with at least two years of data.
      Prophet's ``"auto"`` setting turns it on from about one year, and a
      10-Fourier-term annual cycle fitted to 14 months of data will happily
      invent an annual pattern that is really just noise.
    * **Holidays** are passed in explicitly from the configured country/region
      rather than left to Prophet's built-in list, so they match the holiday
      features the tabular models see.
    """

    name = "prophet"
    label = "Prophet"
    uses_features = False

    #: Days of history required before yearly seasonality is allowed.
    YEARLY_SEASONALITY_MIN_DAYS = 730

    def __init__(self, target: str, cfg: AppConfig | None = None):
        super().__init__(target, cfg)
        self.model_ = None
        self._last_forecast: pd.DataFrame | None = None

    # -- fitting ------------------------------------------------------------ #
    def _holiday_frame(self, index: pd.DatetimeIndex) -> pd.DataFrame | None:
        """Prophet-shaped holiday table spanning history plus the forecast."""
        years_ahead = 2
        dates = _holiday_set(
            self.cfg.data.holiday_country,
            self.cfg.data.holiday_subdiv,
            int(index.min().year) - 1,
            int(index.max().year) + years_ahead,
        )
        if not dates:
            return None
        return pd.DataFrame(
            {
                "holiday": "public_holiday",
                "ds": pd.DatetimeIndex(sorted(dates)),
                "lower_window": -1,   # the day before a holiday behaves differently
                "upper_window": 1,
            }
        )

    def _fit(self, daily: pd.DataFrame) -> None:
        if not PROPHET_AVAILABLE:  # pragma: no cover - environment dependent
            raise NotEnoughDataError(
                "Prophet is not installed (`pip install prophet`); model skipped."
            )

        series = daily[self.target].astype(float)
        train = series.dropna()
        if train.nunique() <= 1:
            raise NotEnoughDataError(
                f"{self.label}: {self.target!r} is constant over the training "
                "window; nothing to fit."
            )

        params = dict(self.cfg.models.prophet)
        span_days = int((series.index.max() - series.index.min()).days) + 1
        if params.get("yearly_seasonality") in ("auto", True):
            if span_days < self.YEARLY_SEASONALITY_MIN_DAYS:
                params["yearly_seasonality"] = False
                log.info(
                    "Prophet/%s: yearly seasonality disabled (%d days of history, "
                    "need %d).", self.target, span_days, self.YEARLY_SEASONALITY_MIN_DAYS,
                )
        if params.get("weekly_seasonality") and span_days < 14:
            params["weekly_seasonality"] = False
            log.info(
                "Prophet/%s: weekly seasonality disabled (%d days of history).",
                self.target, span_days,
            )

        params["interval_width"] = self.cfg.forecast.interval_level
        holidays = self._holiday_frame(series.index)
        if holidays is not None:
            params["holidays"] = holidays

        df = pd.DataFrame({"ds": train.index, "y": train.to_numpy(dtype=float)})
        with _quiet():
            self.model_ = _Prophet(**params)
            self.model_.fit(df)
            in_sample = self.model_.predict(df[["ds"]])

        resid = df["y"].to_numpy(dtype=float) - in_sample["yhat"].to_numpy(dtype=float)
        self._insample_residuals = resid[np.isfinite(resid)]

    # -- prediction --------------------------------------------------------- #
    def _run(self, horizon: int) -> pd.DataFrame:
        """Predict and cache, so point and interval share a single Stan call."""
        index = self._future_index(horizon)
        if (
            self._last_forecast is not None
            and len(self._last_forecast) == horizon
            and self._last_forecast.index.equals(index)
        ):
            return self._last_forecast

        with _quiet():
            raw = self.model_.predict(pd.DataFrame({"ds": index}))
        out = raw[["yhat", "yhat_lower", "yhat_upper"]].copy()
        out.index = index
        self._last_forecast = out
        return out

    def _predict_point(self, horizon: int) -> pd.Series:
        return self._run(horizon)["yhat"].rename(self.target)

    def _native_interval(self, horizon: int, level: float):
        """
        Prophet's own posterior interval.

        Only used when the requested level matches the width the model was
        fitted with; otherwise fall back to residual quantiles rather than
        silently returning an interval of the wrong width.
        """
        if not np.isclose(level, self.cfg.forecast.interval_level):
            return None
        fc = self._run(horizon)
        return fc["yhat_lower"].to_numpy(float), fc["yhat_upper"].to_numpy(float)

    def components(self, horizon: int = 30) -> pd.DataFrame:
        """
        Trend / weekly / holiday decomposition, for the dashboard.

        This is Prophet's interpretability story and the analogue of the tree
        models' SHAP values: it shows how much of each predicted day comes from
        the underlying trend versus the weekday effect versus a holiday.
        """
        self._check_fitted()
        index = self._future_index(horizon)
        with _quiet():
            raw = self.model_.predict(pd.DataFrame({"ds": index}))
        keep = [c for c in ("trend", "weekly", "yearly", "holidays") if c in raw.columns]
        out = raw[keep].copy()
        out.index = index
        out.index.name = "date"
        return out
