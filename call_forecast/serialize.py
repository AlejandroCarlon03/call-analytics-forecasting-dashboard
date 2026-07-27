#!/usr/bin/env python3
r"""
call_forecast.serialize
=======================
Turn one pipeline run into a single JSON-safe payload.

Why this is separate from :mod:`call_forecast.dashboard`
--------------------------------------------------------
``dashboard.build_dashboard`` renders result objects straight into HTML, so the
data and its presentation are welded together and neither can be tested without
the other. This module extracts the data half: a pure function from result
objects to a plain dict. That dict can be asserted against directly, written to
``outputs/dashboard_data.json``, served by an API, or inlined into a page — the
consumer is not this module's concern.

What "JSON-safe" has to mean here
---------------------------------
The result objects are full of values that :func:`json.dumps` will either
refuse outright or — worse — accept and emit as something no other parser reads
back:

* **NaN and Infinity.** ``json.dumps`` writes them as bare ``NaN`` /
  ``Infinity`` tokens, which are **not valid JSON** and throw in
  ``JSON.parse``. This data is dense with them: ``avg_duration_sec`` is NaN on
  every zero-call day (59% of the real export), ``r2`` can be negative
  infinity, and a skipped model's whole metric row is NaN. Every non-finite
  float becomes ``null``.
* **numpy scalars.** ``np.float64`` / ``np.int64`` / ``np.bool_`` are not
  JSON-serialisable at all.
* **Timestamps**, and ``NaT``, which is a ``datetime`` subclass and so must be
  tested for before any date handling.
* **pandas Categoricals** — ``horizon_bucket`` is one.

:func:`dumps` then serialises with ``allow_nan=False``, so a non-finite value
that escapes the coercion raises *here* rather than producing a file that fails
silently in a browser three steps later.

``<``, ``>`` and ``&`` are escaped to their ``\uXXXX`` forms on the way out.
The payload is destined to be inlined into a ``<script type="application/json">``
block, and an anomaly message containing ``</script>`` would otherwise close the
tag early. Those messages are free text assembled from the data, so this is not
hypothetical. The escapes are legal JSON string escapes and parse back to the
original characters.

What is deliberately *not* in the payload
-----------------------------------------
* **Simulated paths.** ``ForecastResult.paths`` is a (1000, 90) array — 90,000
  floats per target. The quantiles read off it are what a reader needs, and
  those are already in the horizon roll-up and the monthly table.
* **The engineered feature matrix.** ~100 columns of model input. The base
  daily frame is what the charts draw.
* **Filesystem paths.** ``AppConfig.to_dict()`` includes absolute paths under
  the user's home directory. This payload is meant to end up in a file that
  gets mailed around, so the config summary is built field by field rather than
  dumped wholesale.

Naming
------
Structural keys are camelCase (``schemaVersion``, ``modelLabel``). Column,
target, metric and feature names pass through **verbatim** in their original
snake_case, because they are domain identifiers that also appear in the CSV
deliverables, in ``config.yaml`` and in the feature specification. Renaming
``call_volume`` to ``callVolume`` in one place only would break that
correspondence.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig

log = logging.getLogger(__name__)

__all__ = [
    "SCHEMA_VERSION",
    "TARGET_LABELS",
    "TARGET_UNITS",
    "build_payload",
    "dumps",
    "write_payload",
]

#: Bumped whenever the payload shape changes in a way a consumer must notice.
SCHEMA_VERSION = 1

#: Display names for the three targets. Canonical here rather than in
#: ``dashboard.py`` so the HTML renderer and the payload cannot drift apart.
TARGET_LABELS = {
    "call_volume": "Daily call volume",
    "avg_duration_sec": "Average call duration",
    "total_cost": "Daily cost",
}
TARGET_UNITS = {"call_volume": "calls", "avg_duration_sec": "seconds", "total_cost": "$"}

#: Weekday labels indexed by ``Timestamp.dayofweek`` (Monday == 0).
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

#: Characters escaped in the serialised output so the payload can be inlined
#: into a ``<script>`` block without the ability to close it.
_HTML_ESCAPES = {
    ord("<"): "\\u003c",
    ord(">"): "\\u003e",
    ord("&"): "\\u0026",
}


# --------------------------------------------------------------------------- #
#  Coercion                                                                    #
# --------------------------------------------------------------------------- #
def _iso(value: Any) -> str:
    """
    Render a timestamp as an ISO string.

    Midnight collapses to a bare ``YYYY-MM-DD``, because every frame in this
    payload is at daily grain and a trailing ``T00:00:00`` on 90 forecast rows
    is noise. Anything with a time component keeps it.
    """
    stamp = value if isinstance(value, (datetime, date)) else pd.Timestamp(value)
    if isinstance(stamp, date) and not isinstance(stamp, datetime):
        return stamp.isoformat()
    if stamp.hour or stamp.minute or stamp.second or stamp.microsecond:
        return stamp.isoformat()
    return stamp.strftime("%Y-%m-%d")


def _scalar(value: Any) -> Any:
    """
    Coerce one leaf value into something :func:`json.dumps` accepts.

    Order matters twice over: ``bool`` is a subclass of ``int`` and would
    otherwise serialise as 0/1, and ``pd.NaT`` is a subclass of ``datetime`` and
    would otherwise be formatted as a date.
    """
    if value is None or value is pd.NaT:
        return None
    # pandas' own missing sentinels (pd.NA, and NaN reaching us as an object).
    try:
        if value is pd.NA:
            return None
    except (AttributeError, TypeError):       # pragma: no cover - older pandas
        pass

    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        number = float(value)
        # The whole point of this module: NaN and +/-inf become null rather
        # than invalid JSON tokens.
        return number if math.isfinite(number) else None
    if isinstance(value, (pd.Timestamp, datetime, date, np.datetime64)):
        return _iso(value)
    if isinstance(value, pd.Timedelta):
        return value.isoformat()
    if isinstance(value, str):
        return value
    if isinstance(value, Path):
        return str(value)

    # Anything left is stringified rather than raised on: a payload with one
    # oddly-rendered field is worth more than a run that dies writing a report.
    log.debug("serialize: stringifying unexpected %s", type(value).__name__)
    return str(value)


def _json_safe(value: Any) -> Any:
    """Recursively coerce containers and leaves."""
    if isinstance(value, Mapping):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_json_safe(v) for v in value]
    if isinstance(value, pd.Series):
        return [_json_safe(v) for v in value.tolist()]
    return _scalar(value)


def _records(
    frame: pd.DataFrame | None,
    *,
    index_name: str | None = None,
    columns: Sequence[str] | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """
    Render a DataFrame as a list of JSON-safe row dicts.

    Parameters
    ----------
    index_name:
        When given, the index is promoted to a leading column of that name.
        Every frame here is date-indexed, and the date is data.
    columns:
        Restrict and order the output. Names absent from the frame are skipped,
        so a caller can ask for optional columns without guarding each one.
    limit:
        Keep only the first ``limit`` rows.
    """
    if frame is None or frame.empty:
        return []

    view = frame.copy()
    if index_name is not None:
        view.insert(0, index_name, view.index)
        view = view.reset_index(drop=True)
    if columns is not None:
        keep = [c for c in columns if c in view.columns]
        if index_name is not None and index_name in view.columns and index_name not in keep:
            keep = [index_name, *keep]
        view = view[keep]
    if limit is not None:
        view = view.head(limit)

    return [_json_safe(row) for row in view.to_dict("records")]


# --------------------------------------------------------------------------- #
#  Sections                                                                    #
# --------------------------------------------------------------------------- #
def _config_summary(cfg: AppConfig) -> dict[str, Any]:
    """
    The configuration a reader needs to interpret the numbers.

    Built field by field rather than from ``cfg.to_dict()`` so that absolute
    filesystem paths and model hyper-parameters never reach a file that is
    designed to be mailed around.
    """
    return _json_safe(
        {
            "forecast": {
                "horizons": list(cfg.forecast.horizons),
                "interval_level": cfg.forecast.interval_level,
                "n_simulations": cfg.forecast.n_simulations,
                "targets": list(cfg.forecast.targets),
            },
            "cv": {
                "horizon": cfg.cv.horizon,
                "step": cfg.cv.step,
                "initial_train_days": cfg.cv.initial_train_days,
                "min_folds": cfg.cv.min_folds,
                "selection_metric": cfg.cv.selection_metric,
                "selection_tiebreaker": cfg.cv.selection_tiebreaker,
            },
            "data": {
                "holiday_country": cfg.data.holiday_country,
                "holiday_subdiv": cfg.data.holiday_subdiv,
            },
            "business_hours": {
                "start_hour": cfg.business_hours.start_hour,
                "end_hour": cfg.business_hours.end_hour,
                "overnight_start_hour": cfg.business_hours.overnight_start_hour,
                "overnight_end_hour": cfg.business_hours.overnight_end_hour,
            },
            "anomalies": {
                "cost_overrun_pct": cfg.anomalies.cost_overrun_pct,
                "duration_sigma": cfg.anomalies.duration_sigma,
                "missed_spike_sigma": cfg.anomalies.missed_spike_sigma,
                "robust_z_threshold": cfg.anomalies.robust_z_threshold,
                "baseline_window_days": cfg.anomalies.baseline_window_days,
            },
            "scenarios": {
                "current_agents": cfg.scenarios.current_agents,
                "target_answer_seconds": cfg.scenarios.target_answer_seconds,
                "service_level_pct": cfg.scenarios.service_level_pct,
                "staffed_hours_per_day": cfg.scenarios.staffed_hours_per_day,
            },
            "models": {"enabled": list(cfg.models.enabled)},
        }
    )


def _aggregate_for(target: str) -> str:
    """
    Whether a target rolls up as a total or a daily average.

    Mirrors :func:`call_forecast.forecast.generate_forecast`: summing daily
    *averages* over a month would be meaningless, so duration aggregates as a
    mean and everything else as a sum.
    """
    return "mean" if target == "avg_duration_sec" else "sum"


def _horizon_rollup(result, horizons: Sequence[int]) -> list[dict[str, Any]]:
    """
    The 30/60/90 headline numbers, read off the simulated paths.

    These are the figures people quote, and they are *not* derivable from the
    daily rows in the payload: the bounds come from the distribution of
    simulated trajectory sums, not from summing daily bounds.
    """
    rows = []
    for days in horizons:
        if _aggregate_for(result.target) == "mean":
            stats = result.mean(days)
            rows.append(
                {
                    "days": int(days),
                    "measure": "daily average",
                    "forecast": stats["mean"],
                    "lower": stats["lower"],
                    "upper": stats["upper"],
                }
            )
        else:
            stats = result.total(days)
            rows.append(
                {
                    "days": int(days),
                    "measure": "total",
                    "forecast": stats["total"],
                    "lower": stats["lower"],
                    "upper": stats["upper"],
                }
            )
    return _json_safe(rows)


def _forecast_section(result, cfg: AppConfig) -> dict[str, Any]:
    """One target's forecast: daily rows, monthly roll-up, headline horizons."""
    return {
        "target": result.target,
        "model": result.model_name,
        "modelLabel": result.model_label,
        "intervalLevel": _scalar(result.interval_level),
        "calibrated": bool(result.calibrated),
        "aggregate": _aggregate_for(result.target),
        "notes": [str(n) for n in result.notes],
        "horizons": _horizon_rollup(result, cfg.forecast.horizons),
        "daily": _records(
            result.daily,
            index_name="date",
            columns=["yhat", "yhat_lower", "yhat_upper", "step", "horizon_bucket"],
        ),
        "monthly": _records(
            result.monthly,
            columns=[
                "month", "month_start", "days_forecast", "days_in_month",
                "partial_month", "yhat", "yhat_lower", "yhat_upper", "aggregate",
            ],
        ),
    }


def _evaluation_section(evaluation) -> dict[str, Any]:
    """One target's model leaderboard and the selection that came out of it."""
    leaderboard = evaluation.leaderboard
    if leaderboard is not None and not leaderboard.empty:
        leaderboard = leaderboard.copy()
        # Which row won is otherwise only recoverable by string-matching
        # bestModel against the model column on the client.
        leaderboard["selected"] = leaderboard["model"] == evaluation.best_model

    return {
        "target": evaluation.target,
        "bestModel": evaluation.best_model,
        "selectionMetric": evaluation.selection_metric,
        "nFolds": int(evaluation.n_folds),
        "horizon": int(evaluation.horizon),
        "notes": [str(n) for n in evaluation.notes],
        "leaderboard": _records(
            leaderboard,
            columns=[
                "model", "label", "status", "selected", "n_folds", "fit_seconds",
                "mae", "rmse", "r2", "mape", "mape_n", "smape", "mase", "bias",
                "beats_baseline", "note",
            ],
        ),
    }


def _explanation_section(explanation, top_n: int = 25) -> dict[str, Any]:
    """
    One target's driver ranking.

    ``topFeatures`` carries a superset of what any one view needs (the chart
    shows 10, the table 12) so the client can slice without a second request.
    Which of the ``shap`` / ``permutation`` / ``native`` columns are present
    depends on what was available at explain time — consumers must treat all
    three as optional.
    """
    top = explanation.top_features(top_n)
    return {
        "target": explanation.target,
        "model": explanation.model_name,
        "modelLabel": explanation.model_label,
        "method": explanation.method,
        "summary": explanation.summary_text(),
        "nTrainRows": int(explanation.n_train_rows),
        "expectedValue": _scalar(explanation.expected_value),
        "notes": [str(n) for n in explanation.notes],
        "topFeatures": _records(top),
    }


def _hourly_grid(calls: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Pre-aggregate the weekday x hour arrival grid.

    Aggregated server-side deliberately. The alternative — shipping every raw
    call row so the client can count them — costs thousands of records to
    produce 168 numbers, and grows with every export.

    All 168 cells are emitted including empty ones, so a consumer drawing the
    heatmap never has to fill gaps; a table view can filter zeros out.
    """
    grid = np.zeros((7, 24), dtype=int)
    if calls is not None and not calls.empty and "ts" in calls.columns:
        stamps = pd.DatetimeIndex(calls["ts"].dropna())
        np.add.at(grid, (stamps.dayofweek.to_numpy(), stamps.hour.to_numpy()), 1)

    return [
        {
            "weekday": weekday,
            "weekdayLabel": WEEKDAYS[weekday],
            "hour": hour,
            "calls": int(grid[weekday, hour]),
        }
        for weekday in range(7)
        for hour in range(24)
    ]


def _anomaly_section(anomaly_report) -> dict[str, Any]:
    """Flagged days, the per-rule tally, and any detector notes."""
    # Every severity key is always present and zeroed, in both branches. A
    # consumer reading counts.critical must never get undefined just because
    # nothing fired or the detector did not run.
    counts = {"critical": 0, "warning": 0, "info": 0}

    if anomaly_report is None:
        return {"items": [], "byRule": [], "notes": [], "counts": counts}

    frame = anomaly_report.to_frame()
    if not frame.empty:
        observed = frame["severity"].value_counts().to_dict()
        counts.update({str(k): int(v) for k, v in observed.items()})

    return {
        "items": _records(frame),
        "byRule": _records(anomaly_report.by_rule()),
        "notes": [str(n) for n in getattr(anomaly_report, "notes", [])],
        "counts": counts,
    }


# --------------------------------------------------------------------------- #
#  Assembly                                                                    #
# --------------------------------------------------------------------------- #
def build_payload(
    calls: pd.DataFrame,
    daily: pd.DataFrame,
    evaluations: Mapping[str, Any],
    forecasts: Mapping[str, Any],
    anomaly_report,
    explanations: Mapping[str, Any],
    scenario_table: pd.DataFrame,
    scenario_notes: Sequence[str],
    ingestion_report,
    cfg: AppConfig | None = None,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    """
    Assemble every artefact of a pipeline run into one JSON-safe dict.

    The parameters mirror
    :func:`call_forecast.dashboard.build_dashboard` exactly, so the two can be
    called from the same place with the same arguments.

    Every section degrades to an empty collection when its input is missing, on
    the same principle as the dashboard: a partial run still produces a usable
    payload rather than an exception.

    Parameters
    ----------
    generated_at:
        Overridable so tests can assert on a fixed timestamp.

    Returns
    -------
    dict
        Ready for :func:`dumps`. Contains no NaN, no numpy types and no
        ``Timestamp`` objects.
    """
    cfg = cfg or AppConfig.default()
    forecasts = dict(forecasts or {})
    evaluations = dict(evaluations or {})
    explanations = dict(explanations or {})

    # Configured order, restricted to targets that actually produced something.
    seen = set(forecasts) | set(evaluations) | set(explanations)
    targets = [t for t in cfg.forecast.targets if t in seen]
    targets += [t for t in sorted(seen) if t not in targets]

    payload: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": (generated_at or datetime.now()).isoformat(timespec="seconds"),
        "ingestion": _json_safe(ingestion_report.to_dict()),
        "config": _config_summary(cfg),
        "targets": targets,
        "targetMeta": {
            target: {
                "label": TARGET_LABELS.get(target, target),
                "units": TARGET_UNITS.get(target, ""),
                "aggregate": _aggregate_for(target),
            }
            for target in targets
        },
        "forecasts": {
            target: _forecast_section(result, cfg)
            for target, result in forecasts.items()
        },
        "evaluations": {
            target: _evaluation_section(evaluation)
            for target, evaluation in evaluations.items()
        },
        "explanations": {
            target: _explanation_section(explanation)
            for target, explanation in explanations.items()
        },
        "daily": _records(daily, index_name="date"),
        "hourly": _hourly_grid(calls),
        "anomalies": _anomaly_section(anomaly_report),
        "scenarios": {
            "rows": _records(scenario_table),
            "notes": [str(n) for n in (scenario_notes or [])],
        },
    }
    return payload


def dumps(payload: Mapping[str, Any], *, indent: int | None = None) -> str:
    """
    Serialise a payload to a string that is safe to inline into HTML.

    ``allow_nan=False`` is the guard rail: if a non-finite float survived
    :func:`build_payload`, this raises ``ValueError`` instead of emitting a bare
    ``NaN`` token that no JSON parser will accept.

    ``ensure_ascii=True`` (the default) is kept deliberately — it escapes
    U+2028 and U+2029, which are valid in JSON strings but terminate a
    JavaScript line, so an inlined payload containing one would be a syntax
    error.

    Raises
    ------
    ValueError
        If a NaN or Infinity is present anywhere in the payload.
    """
    text = json.dumps(payload, allow_nan=False, indent=indent, sort_keys=False)
    # Safe as a blind pass over the output: none of these characters carry
    # structural meaning in JSON, so every occurrence is inside a string.
    return text.translate(_HTML_ESCAPES)


def write_payload(
    output_path: Path | str, payload: Mapping[str, Any], *, indent: int | None = None
) -> Path:
    """
    Write a payload to disk as UTF-8 JSON. Returns the written path.

    Defaults to compact output: this file is a machine-readable artefact, and
    on the 210-day sample pretty-printing roughly doubles it for no benefit.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    text = dumps(payload, indent=indent)
    output_path.write_text(text, encoding="utf-8")
    log.info(
        "Dashboard payload written to %s (%.0f KB)",
        output_path, len(text.encode("utf-8")) / 1024,
    )
    return output_path
