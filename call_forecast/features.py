#!/usr/bin/env python3
"""
call_forecast.features
======================
Turn call-level records into a daily modelling table, then engineer features.

Two stages:

1. :func:`build_daily` collapses individual calls into one row per **calendar
   day** (including days with zero calls) and computes the daily aggregates —
   volume, average duration, cost, missed-call share, business-hours split,
   inbound/outbound ratio, sentiment, latency.
2. :func:`engineer` adds the model features on top: calendar terms, holiday
   flags, lags, rolling means, and per-weekday duration norms.

Feature families
----------------
Features are tagged by family because multi-step forecasting has to treat them
differently — this is what keeps the recursive forecast honest:

``calendar``
    Known for any future date (day of week, month, holiday flag). Computed
    directly for future rows.
``autoregressive``
    Derived from a target's own history (lag 1/7, rolling means). During
    multi-step forecasting these are recomputed from previously *predicted*
    values, not from actuals.
``exogenous``
    Observed properties of the calls themselves (cost per minute, missed-call
    share, after-hours mix). These are *not* known in advance, so future rows
    carry forward a trailing average — an explicit, documented assumption
    rather than silent leakage.

Leakage policy
--------------
Every autoregressive feature is shifted by at least one day before any rolling
window is applied, so the row for day *t* only ever sees data from day *t-1*
and earlier. :func:`engineer` is a pure function of the daily frame, and the
forecaster re-runs it on a growing frame, which guarantees that training-time
and prediction-time features are computed by exactly the same code path.

>>> from call_forecast.config import AppConfig
>>> from call_forecast.ingest import load_calls
>>> cfg = AppConfig.default()
>>> calls = load_calls(cfg)                       # doctest: +SKIP
>>> daily = build_daily(calls.frame, cfg)         # doctest: +SKIP
>>> frame, spec = engineer(daily, cfg)            # doctest: +SKIP
>>> spec.for_target("call_volume")[:4]            # doctest: +SKIP
['day_of_week', 'is_weekend', 'week_of_year', 'month']
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig

log = logging.getLogger(__name__)

__all__ = [
    "FeatureSpec",
    "build_daily",
    "engineer",
    "extend_calendar",
    "TARGETS",
    "SENTIMENT_SCORE",
]

#: Targets the package forecasts, in canonical order.
TARGETS = ("call_volume", "avg_duration_sec", "total_cost")

#: Numeric encoding used to average a day's sentiment into one number.
SENTIMENT_SCORE = {"positive": 1.0, "neutral": 0.0, "negative": -1.0}


# --------------------------------------------------------------------------- #
#  Feature spec                                                                #
# --------------------------------------------------------------------------- #
@dataclass
class FeatureSpec:
    """Which engineered columns exist, and which family each belongs to."""

    calendar: list[str] = field(default_factory=list)
    exogenous: list[str] = field(default_factory=list)
    #: target name -> columns derived from that target's own history
    autoregressive: dict[str, list[str]] = field(default_factory=dict)
    #: columns dropped for zero variance, with the reason (for the report)
    dropped: dict[str, str] = field(default_factory=dict)

    def for_target(self, target: str) -> list[str]:
        """
        Feature columns to train on when predicting ``target``.

        Includes calendar + exogenous features plus the autoregressive block
        for *this* target only. Other targets' lags are excluded: they are not
        known at prediction time for a multi-step horizon, so including them
        would silently leak the future.
        """
        return list(self.calendar) + list(self.exogenous) + list(
            self.autoregressive.get(target, [])
        )

    @property
    def all_features(self) -> list[str]:
        """Every engineered column, across all families."""
        cols = list(self.calendar) + list(self.exogenous)
        for block in self.autoregressive.values():
            cols += block
        return list(dict.fromkeys(cols))

    def to_dict(self) -> dict:
        """JSON-serialisable view, written into the run manifest."""
        return {
            "calendar": self.calendar,
            "exogenous": self.exogenous,
            "autoregressive": {k: v for k, v in self.autoregressive.items()},
            "dropped": self.dropped,
        }


# --------------------------------------------------------------------------- #
#  Stage 1: daily aggregation                                                  #
# --------------------------------------------------------------------------- #
def _is_business_hour(ts: pd.Series, cfg: AppConfig) -> pd.Series:
    """Boolean mask: call landed inside configured business hours on a workday."""
    bh = cfg.business_hours
    return (
        ts.dt.hour.between(bh.start_hour, bh.end_hour - 1)
        & ts.dt.dayofweek.isin(list(bh.workdays))
    )


def _is_overnight(ts: pd.Series, cfg: AppConfig) -> pd.Series:
    """Boolean mask: call landed in the overnight window (may wrap midnight)."""
    bh = cfg.business_hours
    hour = ts.dt.hour
    if bh.overnight_start_hour <= bh.overnight_end_hour:
        return hour.between(bh.overnight_start_hour, bh.overnight_end_hour - 1)
    return (hour >= bh.overnight_start_hour) | (hour < bh.overnight_end_hour)


def build_daily(calls: pd.DataFrame, cfg: AppConfig | None = None) -> pd.DataFrame:
    """
    Collapse call-level records into one row per calendar day.

    Days between the first and last call that contain no calls are inserted as
    genuine zeros for volume/cost — omitting them would bias every model
    upward, because "no calls" is real information about demand, not a gap.
    Duration-type columns stay ``NaN`` on those days, since the average
    duration of zero calls is undefined rather than zero.

    Parameters
    ----------
    calls:
        Canonical frame from :func:`call_forecast.ingest.load_calls`.
    cfg:
        Configuration; defaults used when omitted.

    Returns
    -------
    pandas.DataFrame
        Indexed by ``date`` (``DatetimeIndex``, daily frequency).
    """
    cfg = cfg or AppConfig.default()
    if calls.empty:
        raise ValueError("Cannot build a daily frame from zero calls.")

    df = calls.copy()
    df["date"] = df["ts"].dt.normalize()
    df["_business_hours"] = _is_business_hour(df["ts"], cfg)
    df["_overnight"] = _is_overnight(df["ts"], cfg)
    df["_sentiment_score"] = (
        df["sentiment"].astype("string").str.lower().map(SENTIMENT_SCORE)
    )
    df["_duration_min"] = df["duration_sec"] / 60.0

    grouped = df.groupby("date", sort=True)

    daily = pd.DataFrame(
        {
            # --- targets ---------------------------------------------------
            "call_volume": grouped.size(),
            "avg_duration_sec": grouped["duration_sec"].mean(),
            "total_cost": grouped["cost"].sum(),
            # --- supporting aggregates -------------------------------------
            "median_duration_sec": grouped["duration_sec"].median(),
            "max_duration_sec": grouped["duration_sec"].max(),
            "total_duration_min": grouped["_duration_min"].sum(),
            "connected_calls": grouped["connected"].sum(),
            "missed_calls": grouped["missed"].sum(),
            "business_hours_calls": grouped["_business_hours"].sum(),
            "overnight_calls": grouped["_overnight"].sum(),
            "inbound_calls": grouped["direction"].apply(lambda s: (s == "inbound").sum()),
            "outbound_calls": grouped["direction"].apply(lambda s: (s == "outbound").sum()),
            "successful_calls": grouped["successful"].apply(lambda s: int(s.fillna(False).sum())),
            "agent_hangup_calls": grouped["disconnection_reason"].apply(
                lambda s: int((s.astype("string").str.lower() == "agent_hangup").sum())
            ),
            "sentiment_score": grouped["_sentiment_score"].mean(),
            "avg_latency_ms": grouped["latency_ms"].mean(),
        }
    )
    daily.index = pd.DatetimeIndex(daily.index, name="date")

    # -- insert genuine zero-call days -------------------------------------- #
    if cfg.data.fill_calendar_gaps:
        full = pd.date_range(daily.index.min(), daily.index.max(), freq="D", name="date")
        n_missing = len(full) - len(daily)
        daily = daily.reindex(full)
        if n_missing:
            log.info("Inserted %d zero-call calendar day(s).", n_missing)

    # Count-like columns are genuinely 0 on a day with no calls.
    count_cols = [
        "call_volume", "total_cost", "total_duration_min", "connected_calls",
        "missed_calls", "business_hours_calls", "overnight_calls",
        "inbound_calls", "outbound_calls", "successful_calls", "agent_hangup_calls",
    ]
    daily[count_cols] = daily[count_cols].fillna(0.0)

    # -- derived ratios ------------------------------------------------------ #
    volume = daily["call_volume"]
    safe_volume = volume.where(volume > 0)          # NaN on zero-call days

    daily["after_hours_calls"] = volume - daily["business_hours_calls"]
    daily["business_hours_share"] = daily["business_hours_calls"] / safe_volume
    daily["after_hours_share"] = daily["after_hours_calls"] / safe_volume
    daily["missed_call_pct"] = daily["missed_calls"] / safe_volume
    daily["success_rate"] = daily["successful_calls"] / safe_volume
    daily["agent_hangup_rate"] = daily["agent_hangup_calls"] / safe_volume

    # Inbound/outbound ratio: guard the divide-by-zero, and leave it NaN when
    # the export carries no direction column at all (all-zero on both sides).
    has_direction = (daily["inbound_calls"] + daily["outbound_calls"]) > 0
    daily["inbound_outbound_ratio"] = np.where(
        has_direction,
        daily["inbound_calls"] / daily["outbound_calls"].replace(0, np.nan),
        np.nan,
    )
    # All-inbound days divide by zero -> +inf; represent as "fully inbound".
    daily["inbound_outbound_ratio"] = daily["inbound_outbound_ratio"].replace(
        [np.inf, -np.inf], np.nan
    )
    daily["inbound_share"] = np.where(
        has_direction,
        daily["inbound_calls"] / (daily["inbound_calls"] + daily["outbound_calls"]),
        np.nan,
    )

    # Cost per minute is only meaningful when the day had talk time.
    talk = daily["total_duration_min"].where(daily["total_duration_min"] > 0)
    daily["cost_per_minute"] = daily["total_cost"] / talk
    daily["cost_per_call"] = daily["total_cost"] / safe_volume

    daily.index.name = "date"
    return daily


# --------------------------------------------------------------------------- #
#  Stage 2: feature engineering                                                #
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=8)
def _holiday_set(country: str, subdiv: str | None, y0: int, y1: int) -> frozenset:
    """Public-holiday dates for a year span, cached per (country, subdiv, span)."""
    try:
        import holidays as _holidays
    except ImportError:      # pragma: no cover - optional dependency
        log.warning(
            "The `holidays` package is not installed; holiday features will be "
            "all-zero. Install it with `pip install holidays`."
        )
        return frozenset()

    years = list(range(y0, y1 + 1))
    try:
        cal = _holidays.country_holidays(country, subdiv=subdiv, years=years)
    except (KeyError, NotImplementedError):
        log.warning(
            "Unknown holiday region %s/%s; falling back to national %s calendar.",
            country, subdiv, country,
        )
        cal = _holidays.country_holidays(country, years=years)
    return frozenset(pd.Timestamp(d).normalize() for d in cal)


def _calendar_features(index: pd.DatetimeIndex, cfg: AppConfig) -> pd.DataFrame:
    """Build the calendar block for an arbitrary daily index (past or future)."""
    bh = cfg.business_hours
    out = pd.DataFrame(index=index)

    out["day_of_week"] = index.dayofweek
    out["is_weekend"] = (~index.dayofweek.isin(list(bh.workdays))).astype(int)
    out["week_of_year"] = index.isocalendar().week.to_numpy(dtype=int)
    out["month"] = index.month
    out["day_of_month"] = index.day
    out["quarter"] = index.quarter
    out["is_month_start"] = index.is_month_start.astype(int)
    out["is_month_end"] = index.is_month_end.astype(int)

    # Cyclical encodings so linear models can see that Sunday is next to Monday
    # and December is next to January.
    out["dow_sin"] = np.sin(2 * np.pi * index.dayofweek / 7.0)
    out["dow_cos"] = np.cos(2 * np.pi * index.dayofweek / 7.0)
    out["month_sin"] = np.sin(2 * np.pi * (index.month - 1) / 12.0)
    out["month_cos"] = np.cos(2 * np.pi * (index.month - 1) / 12.0)

    # Linear trend term, anchored so it keeps counting into the future.
    out["time_index"] = (index - index[0]).days.to_numpy(dtype=float)

    # -- holidays ------------------------------------------------------------ #
    hol = _holiday_set(
        cfg.data.holiday_country, cfg.data.holiday_subdiv,
        int(index.min().year) - 1, int(index.max().year) + 1,
    )
    norm = index.normalize()
    out["is_holiday"] = np.fromiter((d in hol for d in norm), dtype=int, count=len(norm))
    out["is_holiday_eve"] = np.fromiter(
        ((d + pd.Timedelta(days=1)) in hol for d in norm), dtype=int, count=len(norm)
    )
    out["is_day_after_holiday"] = np.fromiter(
        ((d - pd.Timedelta(days=1)) in hol for d in norm), dtype=int, count=len(norm)
    )
    out["is_business_day"] = (
        (out["is_weekend"] == 0) & (out["is_holiday"] == 0)
    ).astype(int)
    return out


def _autoregressive_features(
    series: pd.Series, prefix: str, cfg: AppConfig
) -> pd.DataFrame:
    """
    Lag and rolling features for one target series.

    Every column here is shifted by one day before any window is applied, so a
    row never sees its own day's value.
    """
    fc = cfg.features
    out = pd.DataFrame(index=series.index)
    shifted = series.shift(1)

    for lag in fc.lags:
        out[f"{prefix}_lag_{lag}"] = series.shift(lag)

    for window in fc.rolling_windows:
        # min_periods=2 keeps early rows usable instead of all-NaN, while still
        # requiring more than a single observation to form a mean.
        roll = shifted.rolling(window, min_periods=min(2, window))
        out[f"{prefix}_roll{window}_mean"] = roll.mean()
        out[f"{prefix}_roll{window}_std"] = roll.std()

    # Momentum: is the recent week above or below the monthly norm?
    if {7, 30} <= set(fc.rolling_windows):
        out[f"{prefix}_roll7_vs_roll30"] = (
            out[f"{prefix}_roll7_mean"] - out[f"{prefix}_roll30_mean"]
        )

    # Same weekday last week / two weeks ago, differenced.
    if 7 in fc.lags:
        out[f"{prefix}_diff_7"] = series.shift(1) - series.shift(8)

    return out


def _weekday_norm(series: pd.Series, name: str) -> pd.Series:
    """
    Expanding per-weekday mean, shifted so day *t* sees only prior weeks.

    This is the "average duration by weekday" / "average volume by weekday"
    feature: for a Tuesday it carries the mean of every *previous* Tuesday.
    """
    by_dow = series.groupby(series.index.dayofweek)
    out = by_dow.transform(lambda s: s.shift(1).expanding(min_periods=1).mean())
    out.name = name
    return out


def _carry_forward_exogenous(
    frame: pd.DataFrame, columns: Sequence[str], cfg: AppConfig
) -> pd.DataFrame:
    """
    Fill exogenous gaps (and future rows) with a trailing average.

    Exogenous columns describe *observed* call properties, so they are unknown
    for any future date and undefined on zero-call days. Both cases are filled
    with the mean of the last ``exog_carry_forward_days`` observed values —
    stated here rather than hidden, because it is a real modelling assumption.
    """
    window = cfg.features.exog_carry_forward_days
    out = frame.copy()
    for col in columns:
        if col not in out.columns:
            continue
        s = out[col]
        trailing = s.shift(1).rolling(window, min_periods=1).mean()
        filled = s.fillna(trailing)
        # Leading NaNs (before any observation exists) fall back to the global
        # mean, then to 0 if the column is entirely empty.
        filled = filled.fillna(s.mean()).fillna(0.0)
        out[col] = filled
    return out


def engineer(
    daily: pd.DataFrame,
    cfg: AppConfig | None = None,
    targets: Iterable[str] = TARGETS,
) -> tuple[pd.DataFrame, FeatureSpec]:
    """
    Add calendar, autoregressive and exogenous features to a daily frame.

    This is a **pure function** of ``daily``: calling it on history alone, or
    on history plus appended future rows, produces identically-computed
    columns. The recursive forecaster relies on that property — it appends a
    predicted day and re-runs ``engineer`` rather than maintaining a second,
    drift-prone feature path.

    Parameters
    ----------
    daily:
        Output of :func:`build_daily`, optionally extended with future rows
        whose target columns are ``NaN`` (see :func:`extend_calendar`).
    cfg:
        Configuration; defaults used when omitted.
    targets:
        Targets to build autoregressive blocks for.

    Returns
    -------
    (frame, spec)
        ``frame`` is ``daily`` plus every engineered column; ``spec`` records
        which family each column belongs to.
    """
    cfg = cfg or AppConfig.default()
    if not isinstance(daily.index, pd.DatetimeIndex):
        raise TypeError("`daily` must be indexed by a DatetimeIndex of dates.")
    if not daily.index.is_monotonic_increasing:
        daily = daily.sort_index()

    spec = FeatureSpec()
    frame = daily.copy()

    # -- calendar ----------------------------------------------------------- #
    cal = _calendar_features(frame.index, cfg)
    frame = frame.join(cal)
    spec.calendar = list(cal.columns)

    # -- autoregressive, per target ----------------------------------------- #
    for target in targets:
        if target not in frame.columns:
            log.warning("Target %s absent from daily frame; skipping its lags.", target)
            continue
        block = _autoregressive_features(frame[target], target, cfg)

        norm_name = f"{target}_weekday_norm"
        block[norm_name] = _weekday_norm(frame[target], norm_name)

        frame = frame.join(block)
        spec.autoregressive[target] = list(block.columns)

    # "Days since the last call" captures the bursty, intermittent pattern that
    # plain lags miss; it is shared across targets so it lives in the volume block.
    had_calls = (frame["call_volume"].fillna(0) > 0).astype(int)
    idx = np.arange(len(frame))
    last_active = pd.Series(np.where(had_calls == 1, idx, np.nan), index=frame.index).ffill()
    frame["days_since_last_call"] = (idx - last_active.shift(1)).astype(float)
    frame["days_since_last_call"] = frame["days_since_last_call"].fillna(0.0)
    spec.autoregressive.setdefault("call_volume", []).append("days_since_last_call")

    # -- exogenous ---------------------------------------------------------- #
    exog_candidates = [
        "cost_per_minute",
        "cost_per_call",
        "missed_call_pct",
        "business_hours_share",
        "after_hours_share",
        "inbound_outbound_ratio",
        "inbound_share",
        "success_rate",
        "agent_hangup_rate",
        "sentiment_score",
        "avg_latency_ms",
    ]
    exog = [c for c in exog_candidates if c in frame.columns]

    # Exogenous values must not describe the same day we are predicting, so
    # shift them by one day *before* the carry-forward fill.
    for col in exog:
        frame[f"{col}_prev"] = frame[col].shift(1)
    exog_prev = [f"{c}_prev" for c in exog]
    frame = _carry_forward_exogenous(frame, exog_prev, cfg)
    spec.exogenous = exog_prev

    # -- drop degenerate columns -------------------------------------------- #
    if cfg.features.drop_zero_variance:
        _drop_zero_variance(frame, spec, cfg)

    return frame, spec


def _drop_zero_variance(frame: pd.DataFrame, spec: FeatureSpec, cfg: AppConfig) -> None:
    """
    Remove engineered columns that carry no signal, recording why.

    A constant column is not merely useless: it makes linear models
    ill-conditioned and pollutes SHAP output with zero-importance noise. The
    common real case here is ``inbound_outbound_ratio_prev`` on an
    inbound-only export.
    """
    tol = cfg.features.zero_variance_tol
    for family in ("calendar", "exogenous"):
        keep: list[str] = []
        for col in getattr(spec, family):
            values = frame[col].to_numpy(dtype="float64", na_value=np.nan)
            finite = values[np.isfinite(values)]
            if finite.size == 0:
                spec.dropped[col] = "all values missing"
                continue
            if float(np.nanvar(finite)) <= tol:
                spec.dropped[col] = f"zero variance (constant = {finite[0]:.4g})"
                continue
            keep.append(col)
        setattr(spec, family, keep)

    for target, cols in list(spec.autoregressive.items()):
        keep = []
        for col in cols:
            values = frame[col].to_numpy(dtype="float64", na_value=np.nan)
            finite = values[np.isfinite(values)]
            if finite.size == 0:
                spec.dropped[col] = "all values missing"
                continue
            if float(np.nanvar(finite)) <= tol:
                spec.dropped[col] = f"zero variance (constant = {finite[0]:.4g})"
                continue
            keep.append(col)
        spec.autoregressive[target] = keep

    if spec.dropped:
        log.info(
            "Dropped %d degenerate feature(s): %s",
            len(spec.dropped),
            ", ".join(f"{k} ({v})" for k, v in spec.dropped.items()),
        )


# --------------------------------------------------------------------------- #
#  Future-row scaffolding                                                      #
# --------------------------------------------------------------------------- #
def extend_calendar(daily: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """
    Append ``horizon`` future days to a daily frame, with all values ``NaN``.

    The recursive forecaster fills the target column one day at a time and
    re-runs :func:`engineer` after each step.

    >>> import pandas as pd
    >>> d = pd.DataFrame({"call_volume": [1.0, 2.0]},
    ...                  index=pd.DatetimeIndex(["2026-01-01", "2026-01-02"], name="date"))
    >>> extend_calendar(d, 2).index[-1].date().isoformat()
    '2026-01-04'
    """
    if horizon <= 0:
        return daily.copy()
    future_index = pd.date_range(
        daily.index.max() + pd.Timedelta(days=1), periods=horizon, freq="D", name="date"
    )
    future = pd.DataFrame(index=future_index, columns=daily.columns, dtype="float64")
    return pd.concat([daily, future])
