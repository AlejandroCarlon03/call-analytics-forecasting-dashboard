#!/usr/bin/env python3
"""
call_forecast.models.baseline
=============================
Seasonal-naive baseline: "next Tuesday looks like recent Tuesdays".

This model exists to keep the leaderboard honest. On short, intermittent
series a gradient-boosted ensemble frequently *loses* to repeating last week,
and without a baseline in the comparison that failure is invisible — you just
see one model with a slightly better MAE than another and assume it learned
something. It is also the denominator of MASE, the package's default selection
metric.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .base import Forecaster

__all__ = ["SeasonalNaiveForecaster"]


class SeasonalNaiveForecaster(Forecaster):
    """
    Repeat the seasonal profile of recent history.

    For each future date, the forecast is the mean of the last ``n_cycles``
    observations that fell on the same weekday. Using a mean rather than a
    single lagged value keeps the baseline from inheriting one freak day, which
    would flatter every other model by comparison.
    """

    name = "seasonal_naive"
    label = "Seasonal Naive"
    uses_features = False

    #: Weekly seasonality; the series is daily.
    season_length = 7
    #: How many same-weekday observations to average.
    n_cycles = 4

    def __init__(self, target: str, cfg=None):
        super().__init__(target, cfg)
        self._weekday_means: pd.Series | None = None
        self._global_mean: float = 0.0

    def _fit(self, daily: pd.DataFrame) -> None:
        series = daily[self.target].astype(float)
        observed = series.dropna()
        self._global_mean = float(observed.mean()) if not observed.empty else 0.0

        # Mean of the most recent `n_cycles` observations per weekday.
        recent = observed.tail(self.season_length * self.n_cycles)
        self._weekday_means = recent.groupby(recent.index.dayofweek).mean()

        # In-sample residuals: compare each day against its weekday mean.
        expected = series.index.dayofweek.map(
            lambda d: self._weekday_means.get(d, self._global_mean)
        )
        expected = np.asarray(expected, dtype=float)
        resid = series.to_numpy(dtype=float) - expected
        self._insample_residuals = resid[np.isfinite(resid)]

    def _predict_point(self, horizon: int) -> pd.Series:
        index = self._future_index(horizon)
        assert self._weekday_means is not None
        values = [
            float(self._weekday_means.get(d, self._global_mean)) for d in index.dayofweek
        ]
        return pd.Series(values, index=index, name=self.target)
