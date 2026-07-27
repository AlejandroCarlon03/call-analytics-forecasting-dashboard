#!/usr/bin/env python3
"""
call_forecast.config
====================
Typed configuration for the whole pipeline.

Every tunable lives here so the rest of the package never hard-codes a
threshold. Load defaults with ``AppConfig.default()`` or read a YAML file
with ``AppConfig.from_yaml(path)``; any key you omit keeps its default.

Example
-------
>>> cfg = AppConfig.default()
>>> cfg.forecast.horizons
(30, 60, 90)
>>> cfg = AppConfig.from_yaml("config.yaml")   # doctest: +SKIP
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

__all__ = [
    "BusinessHoursConfig",
    "DataConfig",
    "FeatureConfig",
    "ModelConfig",
    "CVConfig",
    "ForecastConfig",
    "AnomalyConfig",
    "ScenarioConfig",
    "PathsConfig",
    "AppConfig",
]


# --------------------------------------------------------------------------- #
#  Sub-configs                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class BusinessHoursConfig:
    """Defines what counts as "business hours" for after-hours features/alerts."""

    start_hour: int = 8
    end_hour: int = 17          # exclusive; 17 == calls up to 16:59 are in-hours
    workdays: tuple[int, ...] = (0, 1, 2, 3, 4)   # Monday=0 .. Sunday=6

    #: Calls landing inside this window are "overnight" and trigger an alert.
    overnight_start_hour: int = 22
    overnight_end_hour: int = 6


@dataclass(frozen=True)
class DataConfig:
    """How to find and interpret the raw call export(s)."""

    #: Glob(s), relative to ``PathsConfig.data_dir``, matching raw exports.
    patterns: tuple[str, ...] = ("*.csv",)

    #: IANA country code used for the holiday calendar.
    holiday_country: str = "US"
    holiday_subdiv: str | None = "AZ"

    #: Rows whose timestamp fails to parse are dropped; abort if the share of
    #: unparseable rows exceeds this.
    max_bad_timestamp_share: float = 0.05

    #: A day with a call whose duration exceeds this is treated as corrupt.
    max_plausible_duration_sec: float = 4 * 3600.0

    #: Costs above this per single call are treated as corrupt.
    max_plausible_cost: float = 100.0

    #: Calendar days with no calls are inserted as zero-volume rows.
    fill_calendar_gaps: bool = True


@dataclass(frozen=True)
class FeatureConfig:
    """Feature-engineering switches."""

    lags: tuple[int, ...] = (1, 2, 3, 7, 14)
    rolling_windows: tuple[int, ...] = (7, 30)

    #: Drop engineered columns whose variance is ~0 (e.g. a direction ratio
    #: that is constant because the export is inbound-only).
    drop_zero_variance: bool = True
    zero_variance_tol: float = 1e-10

    #: Future values of observed-only columns (cost/minute, missed %, ...) are
    #: carried forward as the mean of this many trailing days.
    exog_carry_forward_days: int = 28


@dataclass(frozen=True)
class ModelConfig:
    """Which models to train and their hyper-parameters."""

    enabled: tuple[str, ...] = (
        "seasonal_naive",
        "linear_regression",
        "random_forest",
        "xgboost",
        "prophet",
        "sarima",
    )

    random_state: int = 42

    random_forest: Mapping[str, Any] = field(
        default_factory=lambda: {
            "n_estimators": 400,
            "max_depth": 8,
            "min_samples_leaf": 2,
            "n_jobs": -1,
        }
    )
    xgboost: Mapping[str, Any] = field(
        default_factory=lambda: {
            "n_estimators": 400,
            "max_depth": 4,
            "learning_rate": 0.05,
            "subsample": 0.9,
            "colsample_bytree": 0.9,
            "reg_lambda": 1.0,
            "n_jobs": 4,
        }
    )
    prophet: Mapping[str, Any] = field(
        default_factory=lambda: {
            "weekly_seasonality": True,
            "daily_seasonality": False,
            # Enabled only when >= 2 years of history exists (see prophet_model).
            "yearly_seasonality": "auto",
            "seasonality_mode": "additive",
            "changepoint_prior_scale": 0.05,
        }
    )
    sarima: Mapping[str, Any] = field(
        default_factory=lambda: {
            "order": (1, 0, 1),
            "seasonal_order": (1, 0, 1, 7),
            "trend": "c",
        }
    )

    #: Minimum non-null observations a model needs before it is allowed to
    #: train. Models below this are skipped with a logged reason rather than
    #: producing a meaningless fit.
    min_observations: Mapping[str, int] = field(
        default_factory=lambda: {
            "seasonal_naive": 14,
            "linear_regression": 30,
            "random_forest": 30,
            "xgboost": 30,
            "prophet": 30,
            "sarima": 28,      # ~4 weekly cycles
        }
    )


@dataclass(frozen=True)
class CVConfig:
    """Rolling-origin (walk-forward) cross-validation settings."""

    initial_train_days: int = 42
    horizon: int = 7          # days predicted per fold
    step: int = 7             # how far the origin advances between folds
    min_folds: int = 2

    #: Metric used to pick the winner. One of mae/rmse/mape/smape/mase/r2.
    #: MASE is the default because it stays meaningful on intermittent series
    #: with zero-call days, where MAPE is undefined.
    selection_metric: str = "mase"
    selection_tiebreaker: str = "rmse"


@dataclass(frozen=True)
class ForecastConfig:
    """Horizons and interval settings for the production forecast."""

    horizons: tuple[int, ...] = (30, 60, 90)
    interval_level: float = 0.80          # central interval, e.g. 0.80 -> p10..p90
    n_simulations: int = 1000             # bootstrap paths for aggregated CIs
    targets: tuple[str, ...] = ("call_volume", "avg_duration_sec", "total_cost")
    non_negative_targets: tuple[str, ...] = (
        "call_volume",
        "avg_duration_sec",
        "total_cost",
    )
    round_integer_targets: tuple[str, ...] = ("call_volume",)


@dataclass(frozen=True)
class AnomalyConfig:
    """Thresholds for anomaly detection and the four standing alert rules."""

    #: Robust z-score (median / MAD) magnitude above which a point is flagged.
    robust_z_threshold: float = 3.0

    #: Rule 1 - daily cost exceeds model expectation by this fraction.
    cost_overrun_pct: float = 0.20

    #: Rule 2 - daily average duration this many sigma above the trailing norm.
    duration_sigma: float = 2.0

    #: Rule 3 - missed-call share above trailing mean by this many sigma AND
    #: at least this many missed calls (suppresses noise on tiny days).
    missed_spike_sigma: float = 2.0
    missed_spike_min_count: int = 3

    #: Rule 4 - any call in the overnight window fires; this is the minimum
    #: count before it is reported, to avoid single-call noise.
    overnight_min_calls: int = 1

    #: Trailing window used for the "normal" baseline in the sigma rules.
    baseline_window_days: int = 30


@dataclass(frozen=True)
class ScenarioConfig:
    """What-if analysis and Erlang-C staffing assumptions."""

    #: Volume uplifts to evaluate, as fractions (0.10 == +10%).
    volume_uplifts: tuple[float, ...] = (0.10, 0.15, 0.25)

    #: Agents currently answering during business hours. Used as the baseline
    #: for staffing comparisons.
    current_agents: int = 1

    #: Service-level goal: answer ``service_level_pct`` of calls within
    #: ``target_answer_seconds``.
    target_answer_seconds: float = 30.0
    service_level_pct: float = 0.80

    #: Share of callers who abandon rather than wait, per second of expected
    #: wait. Used to translate wait time into expected missed calls.
    abandon_rate_per_second: float = 0.01

    #: Hours per day the queue is staffed (used to convert daily volume into
    #: an arrival rate).
    staffed_hours_per_day: float = 9.0


@dataclass(frozen=True)
class PathsConfig:
    """Filesystem layout. All paths are resolved relative to ``root``."""

    root: Path = Path(".")
    data_dir: Path = Path("data")
    output_dir: Path = Path("outputs")
    model_dir: Path = Path("models")
    report_dir: Path = Path("reports")

    def resolved(self) -> "PathsConfig":
        """
        Return a copy with every path made absolute against ``root``.

        Accepts plain strings as well as ``Path`` objects, so hand-built
        configs and YAML-loaded ones behave identically.
        """
        root = Path(self.root).expanduser().resolve()

        def _abs(p: Path) -> Path:
            p = Path(p).expanduser()
            return p if p.is_absolute() else root / p

        return dataclasses.replace(
            self,
            root=root,
            data_dir=_abs(self.data_dir),
            output_dir=_abs(self.output_dir),
            model_dir=_abs(self.model_dir),
            report_dir=_abs(self.report_dir),
        )

    def ensure(self) -> "PathsConfig":
        """Create every output directory and return the resolved config."""
        r = self.resolved()
        for p in (r.data_dir, r.output_dir, r.model_dir, r.report_dir):
            p.mkdir(parents=True, exist_ok=True)
        return r


# --------------------------------------------------------------------------- #
#  Root config                                                                 #
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class AppConfig:
    """Root configuration object passed through the whole pipeline."""

    paths: PathsConfig = field(default_factory=PathsConfig)
    data: DataConfig = field(default_factory=DataConfig)
    business_hours: BusinessHoursConfig = field(default_factory=BusinessHoursConfig)
    features: FeatureConfig = field(default_factory=FeatureConfig)
    models: ModelConfig = field(default_factory=ModelConfig)
    cv: CVConfig = field(default_factory=CVConfig)
    forecast: ForecastConfig = field(default_factory=ForecastConfig)
    anomalies: AnomalyConfig = field(default_factory=AnomalyConfig)
    scenarios: ScenarioConfig = field(default_factory=ScenarioConfig)

    # -- constructors ------------------------------------------------------- #
    @classmethod
    def default(cls) -> "AppConfig":
        """Configuration with every default applied."""
        return cls()

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any] | None) -> "AppConfig":
        """Build a config from a nested mapping, filling gaps with defaults."""
        raw = dict(raw or {})
        sections = {
            "paths": PathsConfig,
            "data": DataConfig,
            "business_hours": BusinessHoursConfig,
            "features": FeatureConfig,
            "models": ModelConfig,
            "cv": CVConfig,
            "forecast": ForecastConfig,
            "anomalies": AnomalyConfig,
            "scenarios": ScenarioConfig,
        }
        kwargs: dict[str, Any] = {}
        for name, klass in sections.items():
            kwargs[name] = _build_section(klass, raw.get(name))

        unknown = set(raw) - set(sections)
        if unknown:
            raise ValueError(
                f"Unknown config section(s): {sorted(unknown)}. "
                f"Valid sections: {sorted(sections)}"
            )
        return cls(**kwargs)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "AppConfig":
        """Load configuration from a YAML file."""
        import yaml

        path = Path(path)
        with path.open("r", encoding="utf-8") as fh:
            raw = yaml.safe_load(fh) or {}
        cfg = cls.from_mapping(raw)
        # A relative `root` in the YAML is interpreted relative to the YAML file.
        if not Path(cfg.paths.root).is_absolute():
            cfg = dataclasses.replace(
                cfg,
                paths=dataclasses.replace(
                    cfg.paths, root=path.parent / cfg.paths.root
                ),
            )
        return cfg

    def to_dict(self) -> dict[str, Any]:
        """Serialise to plain types (``Path`` -> ``str``) for JSON/YAML dumps."""
        return _to_plain(dataclasses.asdict(self))


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _build_section(klass: type, raw: Mapping[str, Any] | None):
    """Instantiate a dataclass section, coercing lists to tuples and validating keys."""
    if raw is None:
        return klass()
    if not isinstance(raw, Mapping):
        raise TypeError(f"Config section for {klass.__name__} must be a mapping")

    valid = {f.name: f for f in dataclasses.fields(klass)}
    unknown = set(raw) - set(valid)
    if unknown:
        raise ValueError(
            f"Unknown key(s) for {klass.__name__}: {sorted(unknown)}. "
            f"Valid keys: {sorted(valid)}"
        )

    kwargs: dict[str, Any] = {}
    for key, value in raw.items():
        # YAML gives lists; the dataclasses declare tuples for hashability.
        if isinstance(value, list):
            value = tuple(
                tuple(v) if isinstance(v, list) else v for v in value
            )
        if key in {"root", "data_dir", "output_dir", "model_dir", "report_dir"}:
            value = Path(value)
        kwargs[key] = value
    return klass(**kwargs)


def _to_plain(obj: Any) -> Any:
    """Recursively convert Paths/tuples into JSON-friendly types."""
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, Mapping):
        return {k: _to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_plain(v) for v in obj]
    return obj
