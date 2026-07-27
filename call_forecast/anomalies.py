#!/usr/bin/env python3
"""
call_forecast.anomalies
=======================
Anomaly detection over the daily series, plus four standing alert rules.

Detection layers
----------------
1. **Statistical outliers** — robust z-scores on volume, duration and cost.
   The z-score uses the *median* and *median absolute deviation* rather than
   mean and standard deviation, because a single freak day inflates a standard
   deviation enough to hide itself. With MAD, the outlier cannot mask its own
   detection.
2. **Standing rules** — the four operational alerts, each of which compares a
   day against what was expected rather than against a fixed threshold:

   ==================================  =========================================
   ``cost_overrun``                    daily cost exceeds expectation by >20%
   ``duration_spike``                  average duration >2 sigma above the norm
   ``missed_call_spike``               missed-call share >2 sigma above the norm
   ``overnight_activity``              any call inside the overnight window
   ==================================  =========================================

What "expected" means
---------------------
Every baseline in this module is **trailing and weekday-aware**: the
expectation for a Tuesday is built from previous Tuesdays and the preceding
rolling window only. No day contributes to its own baseline, so a sustained
shift raises alerts instead of quietly redefining normal — and the same
detector can run unchanged on a live feed, where the future genuinely does not
exist yet.

Once a model has been fitted, :func:`detect_anomalies` accepts a model-derived
``expected`` series and uses that instead, which is more accurate; the trailing
baseline is the fallback that always works.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Iterable, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig

log = logging.getLogger(__name__)

__all__ = [
    "Anomaly",
    "AnomalyReport",
    "robust_zscore",
    "trailing_baseline",
    "detect_anomalies",
    "check_latest_day",
]

#: Scale factor making MAD a consistent estimator of sigma for normal data.
_MAD_TO_SIGMA = 1.4826


# --------------------------------------------------------------------------- #
#  Containers                                                                  #
# --------------------------------------------------------------------------- #
@dataclass
class Anomaly:
    """A single flagged day."""

    date: pd.Timestamp
    rule: str
    metric: str
    actual: float
    expected: float
    deviation: float
    severity: str
    message: str

    def as_row(self) -> dict:
        """Flat dict for building the anomalies DataFrame/CSV."""
        return {
            "date": self.date,
            "rule": self.rule,
            "metric": self.metric,
            "actual": self.actual,
            "expected": self.expected,
            "deviation": self.deviation,
            "severity": self.severity,
            "message": self.message,
        }


@dataclass
class AnomalyReport:
    """All anomalies found, with convenience views for the dashboard."""

    anomalies: list[Anomaly] = field(default_factory=list)
    baselines: pd.DataFrame = field(default_factory=pd.DataFrame)
    notes: list[str] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.anomalies)

    def to_frame(self) -> pd.DataFrame:
        """Anomalies as a date-sorted DataFrame (newest first)."""
        if not self.anomalies:
            return pd.DataFrame(
                columns=["date", "rule", "metric", "actual", "expected",
                         "deviation", "severity", "message"]
            )
        out = pd.DataFrame([a.as_row() for a in self.anomalies])
        severity_order = {"critical": 0, "warning": 1, "info": 2}
        out["_sev"] = out["severity"].map(severity_order).fillna(3)
        return (
            out.sort_values(["date", "_sev"], ascending=[False, True])
            .drop(columns="_sev")
            .reset_index(drop=True)
        )

    def by_rule(self) -> pd.DataFrame:
        """Count of anomalies per rule and severity, for the alert summary."""
        frame = self.to_frame()
        if frame.empty:
            return pd.DataFrame(columns=["rule", "severity", "count"])
        return (
            frame.groupby(["rule", "severity"], as_index=False)
            .size()
            .rename(columns={"size": "count"})
            .sort_values("count", ascending=False)
            .reset_index(drop=True)
        )

    @property
    def critical(self) -> list[Anomaly]:
        """Only the critical-severity anomalies."""
        return [a for a in self.anomalies if a.severity == "critical"]


# --------------------------------------------------------------------------- #
#  Statistical primitives                                                      #
# --------------------------------------------------------------------------- #
def robust_zscore(series: pd.Series) -> pd.Series:
    """
    Median/MAD-based z-score, resistant to the outliers it is looking for.

    Falls back to the standard deviation when the MAD is zero, which happens
    whenever more than half the values are identical — common here, since most
    days have zero calls. If both are zero the series is constant and every
    score is 0.

    The outlier barely moves the MAD, so it scores far higher than it would
    against its own inflated standard deviation:

    >>> import pandas as pd
    >>> s = pd.Series([1.0, 2.0, 1.0, 2.0, 1.0, 2.0, 20.0])
    >>> round(float(robust_zscore(s).iloc[-1]), 1)
    12.1

    With more than half the values identical the MAD collapses to zero and the
    standard deviation takes over, which is markedly less sensitive:

    >>> flat = pd.Series([1.0, 1.0, 1.0, 1.0, 20.0])
    >>> round(float(robust_zscore(flat).iloc[-1]), 1)
    2.5
    """
    values = series.astype(float)
    median = float(values.median())
    mad = float((values - median).abs().median())

    if mad > 0:
        scale = mad * _MAD_TO_SIGMA
    else:
        std = float(values.std(ddof=0))
        if not np.isfinite(std) or std <= 0:
            return pd.Series(0.0, index=series.index)
        scale = std
    return (values - median) / scale


def trailing_baseline(
    series: pd.Series, window: int, weekday_aware: bool = True, min_periods: int = 3
) -> pd.DataFrame:
    """
    Rolling mean and standard deviation using only prior days.

    Parameters
    ----------
    series:
        Daily metric.
    window:
        Trailing window length in days (or in same-weekday observations when
        ``weekday_aware``).
    weekday_aware:
        Build a Tuesday's baseline from previous Tuesdays. Call traffic is
        strongly weekday-driven, so a plain 30-day window flags every Monday as
        high and every Sunday as low.
    min_periods:
        Minimum prior observations before a baseline is emitted; earlier rows
        get NaN and are never flagged.

    Returns
    -------
    pandas.DataFrame
        Columns ``mean``, ``std``, indexed like ``series``. Every value is
        shifted by one day, so a day never informs its own expectation.
    """
    values = series.astype(float)

    if weekday_aware:
        grouped = values.groupby(values.index.dayofweek)
        mean = grouped.transform(
            lambda s: s.shift(1).rolling(window, min_periods=min_periods).mean()
        )
        std = grouped.transform(
            lambda s: s.shift(1).rolling(window, min_periods=min_periods).std()
        )
        # Early rows have too few same-weekday observations; fall back to an
        # all-days window rather than declining to check them at all.
        shifted = values.shift(1)
        mean = mean.fillna(shifted.rolling(window, min_periods=min_periods).mean())
        std = std.fillna(shifted.rolling(window, min_periods=min_periods).std())
    else:
        shifted = values.shift(1)
        mean = shifted.rolling(window, min_periods=min_periods).mean()
        std = shifted.rolling(window, min_periods=min_periods).std()

    return pd.DataFrame({"mean": mean, "std": std}, index=series.index)


def _severity(ratio: float, warn: float, critical: float) -> str:
    """Map an exceedance ratio onto a severity label."""
    if not np.isfinite(ratio):
        return "info"
    if ratio >= critical:
        return "critical"
    if ratio >= warn:
        return "warning"
    return "info"


# --------------------------------------------------------------------------- #
#  Rules                                                                       #
# --------------------------------------------------------------------------- #
def _rule_cost_overrun(
    daily: pd.DataFrame, cfg: AppConfig, expected: pd.Series | None
) -> tuple[list[Anomaly], pd.Series]:
    """Rule 1: daily cost exceeds expectation by more than the configured margin."""
    threshold = cfg.anomalies.cost_overrun_pct
    actual = daily["total_cost"].astype(float)

    if expected is None:
        expected = trailing_baseline(
            actual, cfg.anomalies.baseline_window_days // 7 or 4
        )["mean"]

    out: list[Anomaly] = []
    for date, value in actual.items():
        exp = float(expected.get(date, np.nan))
        # A near-zero expectation makes the percentage meaningless (any activity
        # is an infinite overrun), so require a floor of one cent.
        if not np.isfinite(exp) or exp < 0.01 or not np.isfinite(value):
            continue
        overrun = (value - exp) / exp
        if overrun > threshold:
            out.append(
                Anomaly(
                    date=date, rule="cost_overrun", metric="total_cost",
                    actual=float(value), expected=exp, deviation=float(overrun),
                    severity=_severity(overrun, threshold, threshold * 3),
                    message=(
                        f"Cost ${value:.2f} is {overrun:.0%} above the expected "
                        f"${exp:.2f} (threshold {threshold:.0%})."
                    ),
                )
            )
    return out, expected


def _rule_duration_spike(daily: pd.DataFrame, cfg: AppConfig) -> tuple[list[Anomaly], pd.DataFrame]:
    """Rule 2: average call duration more than N sigma above the trailing norm."""
    sigma = cfg.anomalies.duration_sigma
    actual = daily["avg_duration_sec"].astype(float)
    base = trailing_baseline(actual, cfg.anomalies.baseline_window_days // 7 or 4)

    out: list[Anomaly] = []
    for date, value in actual.items():
        mean, std = float(base.loc[date, "mean"]), float(base.loc[date, "std"])
        if not np.isfinite(value) or not np.isfinite(mean) or not np.isfinite(std) or std <= 0:
            continue
        z = (value - mean) / std
        if z > sigma:
            out.append(
                Anomaly(
                    date=date, rule="duration_spike", metric="avg_duration_sec",
                    actual=float(value), expected=mean, deviation=float(z),
                    severity=_severity(z, sigma, sigma * 2),
                    message=(
                        f"Average duration {value:.0f}s is {z:.1f} sigma above the "
                        f"usual {mean:.0f}s (+/-{std:.0f}s)."
                    ),
                )
            )
    return out, base


def _rule_missed_spike(daily: pd.DataFrame, cfg: AppConfig) -> list[Anomaly]:
    """
    Rule 3: missed-call share spikes above the trailing norm.

    Guarded by a minimum absolute count: on a two-call day one missed call is
    a 50% miss rate and statistically extreme, but operationally it is noise.
    """
    sigma = cfg.anomalies.missed_spike_sigma
    min_count = cfg.anomalies.missed_spike_min_count

    share = daily["missed_call_pct"].astype(float)
    counts = daily["missed_calls"].astype(float)
    base = trailing_baseline(share, cfg.anomalies.baseline_window_days // 7 or 4)

    out: list[Anomaly] = []
    for date, value in share.items():
        count = float(counts.get(date, 0.0))
        mean, std = float(base.loc[date, "mean"]), float(base.loc[date, "std"])
        if not np.isfinite(value) or count < min_count:
            continue
        if not np.isfinite(mean) or not np.isfinite(std) or std <= 0:
            continue
        z = (value - mean) / std
        if z > sigma:
            out.append(
                Anomaly(
                    date=date, rule="missed_call_spike", metric="missed_call_pct",
                    actual=float(value), expected=mean, deviation=float(z),
                    severity=_severity(z, sigma, sigma * 2),
                    message=(
                        f"{int(count)} missed calls ({value:.0%} of volume), "
                        f"{z:.1f} sigma above the usual {mean:.0%}."
                    ),
                )
            )
    return out


def _rule_overnight(daily: pd.DataFrame, cfg: AppConfig) -> list[Anomaly]:
    """
    Rule 4: any call in the overnight window.

    This one is a threshold rather than a statistical test on purpose. A call
    at 03:00 to a business line is worth a look on its own terms — as a
    misrouted number, a robocall sweep, or a customer in a different timezone —
    and it should not stop being reported merely because it has happened often
    enough to become statistically "normal".
    """
    bh = cfg.business_hours
    min_calls = cfg.anomalies.overnight_min_calls
    counts = daily["overnight_calls"].astype(float)

    out: list[Anomaly] = []
    for date, value in counts.items():
        if not np.isfinite(value) or value < min_calls:
            continue
        out.append(
            Anomaly(
                date=date, rule="overnight_activity", metric="overnight_calls",
                actual=float(value), expected=0.0, deviation=float(value),
                severity="warning" if value >= 3 else "info",
                message=(
                    f"{int(value)} call(s) between {bh.overnight_start_hour:02d}:00 "
                    f"and {bh.overnight_end_hour:02d}:00."
                ),
            )
        )
    return out


def _rule_statistical(daily: pd.DataFrame, cfg: AppConfig) -> list[Anomaly]:
    """Robust z-score outliers on each headline metric."""
    threshold = cfg.anomalies.robust_z_threshold
    metrics = {
        "call_volume": "calls",
        "avg_duration_sec": "seconds",
        "total_cost": "dollars",
    }

    out: list[Anomaly] = []
    for metric, unit in metrics.items():
        if metric not in daily.columns:
            continue
        series = daily[metric].astype(float).dropna()
        if len(series) < 10:
            continue
        z = robust_zscore(series)
        median = float(series.median())
        for date, score in z.items():
            if not np.isfinite(score) or abs(score) <= threshold:
                continue
            direction = "above" if score > 0 else "below"
            out.append(
                Anomaly(
                    date=date, rule="statistical_outlier", metric=metric,
                    actual=float(series[date]), expected=median,
                    deviation=float(score),
                    severity=_severity(abs(score), threshold, threshold * 2),
                    message=(
                        f"{metric} of {series[date]:.4g} {unit} is {abs(score):.1f} "
                        f"robust sigma {direction} the median {median:.4g}."
                    ),
                )
            )
    return out


# --------------------------------------------------------------------------- #
#  Entry points                                                                #
# --------------------------------------------------------------------------- #
def detect_anomalies(
    daily: pd.DataFrame,
    cfg: AppConfig | None = None,
    expected_cost: pd.Series | None = None,
) -> AnomalyReport:
    """
    Run every detector over the historical daily frame.

    Parameters
    ----------
    daily:
        Base daily frame from :func:`call_forecast.features.build_daily`.
    cfg:
        Configuration; defaults used when omitted.
    expected_cost:
        Optional model-derived expected daily cost, indexed like ``daily``.
        When supplied it replaces the trailing baseline in the cost-overrun
        rule. Anything you pass here must be a genuine one-step-ahead
        prediction — feeding in a fitted-on-everything in-sample curve would
        make the rule compare each day against a line drawn through itself.

    Returns
    -------
    AnomalyReport
    """
    cfg = cfg or AppConfig.default()
    report = AnomalyReport()

    if len(daily) < 10:
        report.notes.append(
            f"Only {len(daily)} days of history: anomaly baselines need at "
            "least 10 days, so detection was skipped."
        )
        return report

    cost_anomalies, cost_expected = _rule_cost_overrun(daily, cfg, expected_cost)
    duration_anomalies, duration_base = _rule_duration_spike(daily, cfg)

    report.anomalies = [
        *cost_anomalies,
        *duration_anomalies,
        *_rule_missed_spike(daily, cfg),
        *_rule_overnight(daily, cfg),
        *_rule_statistical(daily, cfg),
    ]

    report.baselines = pd.DataFrame(
        {
            "expected_cost": cost_expected,
            "expected_duration": duration_base["mean"],
            "expected_duration_std": duration_base["std"],
        }
    )

    if expected_cost is None:
        report.notes.append(
            "Cost overruns were measured against a trailing weekday baseline "
            "(no model expectation supplied)."
        )

    counts = pd.Series([a.rule for a in report.anomalies]).value_counts().to_dict()
    log.info(
        "Anomaly detection: %d flagged day-events across %d days. %s",
        len(report.anomalies), len(daily), counts or "none",
    )
    return report


def check_latest_day(
    daily: pd.DataFrame,
    forecasts: dict | None = None,
    cfg: AppConfig | None = None,
) -> list[Anomaly]:
    """
    Evaluate only the most recent day — the check to run on a schedule.

    Where :func:`detect_anomalies` audits history, this answers "is *today*
    worth an alert?". When forecasts are supplied, the cost rule compares
    against the model's prediction for that date, which is the intended
    reading of "daily cost exceeded predicted cost by 20%".

    Parameters
    ----------
    daily:
        Base daily frame including the day to check as its last row.
    forecasts:
        Optional ``{target: ForecastResult}``. Only used if a forecast covers
        the date being checked.
    cfg:
        Configuration; defaults used when omitted.

    Returns
    -------
    list[Anomaly]
        Anomalies for the final day only.
    """
    cfg = cfg or AppConfig.default()
    if daily.empty:
        return []

    last_date = daily.index.max()
    expected_cost = None

    if forecasts:
        result = forecasts.get("total_cost")
        if result is not None and last_date in result.daily.index:
            expected_cost = pd.Series(
                float(result.daily.loc[last_date, "yhat"]), index=[last_date]
            )

    report = detect_anomalies(daily, cfg, expected_cost=expected_cost)
    return [a for a in report.anomalies if a.date == last_date]
