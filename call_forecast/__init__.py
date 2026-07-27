#!/usr/bin/env python3
"""
call_forecast
=============
Forecasting and anomaly detection for call-analytics exports.

Ingests raw call exports (RetellAI-style CSV/XLSX), cleans and validates them,
engineers daily features, cross-validates six forecasting models, selects the
best by walk-forward accuracy, and produces 30/60/90-day forecasts with
calibrated intervals — plus anomaly alerts, SHAP explanations, Erlang-C
staffing scenarios and a self-contained HTML dashboard.

Quick start
-----------
Drop an export into ``data/`` and run::

    python -m call_forecast run -v

Or from Python:

>>> from call_forecast import AppConfig, run_pipeline
>>> result = run_pipeline(AppConfig.default())      # doctest: +SKIP
>>> print(result.summary())                         # doctest: +SKIP

Module map
----------
================================  =================================================
:mod:`~call_forecast.config`      typed configuration for every tunable
:mod:`~call_forecast.ingest`      load, clean and validate raw exports
:mod:`~call_forecast.features`    daily aggregation and feature engineering
:mod:`~call_forecast.models`      the six forecasters and their registry
:mod:`~call_forecast.evaluation`  metrics, walk-forward CV, model selection
:mod:`~call_forecast.forecast`    fit the winner, produce horizons + intervals
:mod:`~call_forecast.anomalies`   outlier detection and the standing alerts
:mod:`~call_forecast.explain`     SHAP, permutation and native importance
:mod:`~call_forecast.scenarios`   what-if volume, cost, wait time, staffing
:mod:`~call_forecast.dashboard`   self-contained interactive HTML report
:mod:`~call_forecast.pipeline`    orchestration and automatic retraining
:mod:`~call_forecast.cli`         command-line interface
================================  =================================================
"""

from .config import AppConfig
from .features import TARGETS, build_daily, engineer
from .ingest import load_call_files, load_calls
from .pipeline import RunResult, needs_retrain, run_pipeline

__version__ = "1.0.0"

__all__ = [
    "AppConfig",
    "TARGETS",
    "build_daily",
    "engineer",
    "load_calls",
    "load_call_files",
    "run_pipeline",
    "needs_retrain",
    "RunResult",
    "__version__",
]
