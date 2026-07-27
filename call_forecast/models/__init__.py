"""
call_forecast.models
====================
Forecasting models and the registry that ties them together.

Every model implements the same small interface — ``fit(daily)`` then
``predict(horizon)`` — so the evaluation, selection and reporting layers never
need to know which family produced a number.

============================  ======================================================
:class:`SeasonalNaiveForecaster`  Repeat recent same-weekday values (the baseline)
:class:`LinearRegressionForecaster`  Ridge-regularised least squares on features
:class:`RandomForestForecaster`   Bagged regression trees
:class:`XGBoostForecaster`        Gradient-boosted trees
:class:`ProphetForecaster`        Additive trend + weekly + holiday model
:class:`SarimaForecaster`         Seasonal ARIMA state-space model
============================  ======================================================
"""

from .base import Forecaster, NotEnoughDataError, TabularForecaster
from .baseline import SeasonalNaiveForecaster
from .prophet_model import PROPHET_AVAILABLE, ProphetForecaster
from .registry import REGISTRY, available_models, build_models, get_model_class
from .sarima import SarimaForecaster
from .tabular import (
    LinearRegressionForecaster,
    RandomForestForecaster,
    XGBoostForecaster,
)

__all__ = [
    "Forecaster",
    "TabularForecaster",
    "NotEnoughDataError",
    "SeasonalNaiveForecaster",
    "LinearRegressionForecaster",
    "RandomForestForecaster",
    "XGBoostForecaster",
    "ProphetForecaster",
    "SarimaForecaster",
    "PROPHET_AVAILABLE",
    "REGISTRY",
    "get_model_class",
    "build_models",
    "available_models",
]
