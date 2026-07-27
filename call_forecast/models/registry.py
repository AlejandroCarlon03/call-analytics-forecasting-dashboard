#!/usr/bin/env python3
"""
call_forecast.models.registry
=============================
Name -> forecaster-class lookup, and the factory the pipeline uses.

Adding a model to the comparison is a two-line change: implement
:class:`~call_forecast.models.base.Forecaster` (or ``TabularForecaster``) and
register the class here. Everything downstream — cross-validation, selection,
intervals, explainability, the dashboard — discovers it automatically.
"""

from __future__ import annotations

import logging
from typing import Iterable, Type

from ..config import AppConfig
from .base import Forecaster, NotEnoughDataError, TabularForecaster
from .baseline import SeasonalNaiveForecaster
from .prophet_model import PROPHET_AVAILABLE, ProphetForecaster
from .sarima import SarimaForecaster
from .tabular import (
    LinearRegressionForecaster,
    RandomForestForecaster,
    XGBoostForecaster,
)

log = logging.getLogger(__name__)

__all__ = ["REGISTRY", "get_model_class", "build_models", "available_models"]

#: Every model the package knows about, keyed by config name.
REGISTRY: dict[str, Type[Forecaster]] = {
    SeasonalNaiveForecaster.name: SeasonalNaiveForecaster,
    LinearRegressionForecaster.name: LinearRegressionForecaster,
    RandomForestForecaster.name: RandomForestForecaster,
    XGBoostForecaster.name: XGBoostForecaster,
    ProphetForecaster.name: ProphetForecaster,
    SarimaForecaster.name: SarimaForecaster,
}


def get_model_class(name: str) -> Type[Forecaster]:
    """
    Look up a forecaster class by its registry name.

    Raises
    ------
    KeyError
        With the list of valid names, rather than a bare KeyError, because this
        is usually a typo in a YAML config.
    """
    try:
        return REGISTRY[name]
    except KeyError:
        raise KeyError(
            f"Unknown model {name!r}. Available: {sorted(REGISTRY)}"
        ) from None


def available_models(cfg: AppConfig | None = None) -> list[str]:
    """
    Enabled model names whose dependencies are actually importable.

    Prophet is optional; if it is missing it is filtered out here with a
    warning rather than raising at fit time, so an install without a working
    Stan toolchain still gets a full run from the other five models.
    """
    cfg = cfg or AppConfig.default()
    names: list[str] = []
    for name in cfg.models.enabled:
        if name not in REGISTRY:
            log.warning("Ignoring unknown model %r in config.", name)
            continue
        if name == "prophet" and not PROPHET_AVAILABLE:
            log.warning(
                "Prophet is enabled in config but not installed; skipping it. "
                "Install with `pip install prophet`."
            )
            continue
        names.append(name)
    return names


def build_models(
    target: str,
    cfg: AppConfig | None = None,
    names: Iterable[str] | None = None,
) -> dict[str, Forecaster]:
    """
    Instantiate one unfitted forecaster per enabled model for ``target``.

    Parameters
    ----------
    target:
        Column to forecast, e.g. ``"call_volume"``.
    cfg:
        Configuration; defaults used when omitted.
    names:
        Explicit model names, overriding ``cfg.models.enabled``.

    Returns
    -------
    dict
        ``{model_name: unfitted forecaster}``, in config order.
    """
    cfg = cfg or AppConfig.default()
    names = list(names) if names is not None else available_models(cfg)
    return {name: get_model_class(name)(target, cfg) for name in names}
