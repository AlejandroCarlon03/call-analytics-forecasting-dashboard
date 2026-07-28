#!/usr/bin/env python3
"""
call_forecast.pipeline
======================
End-to-end orchestration: ingest → features → validate → forecast → explain →
detect → simulate → report.

Automatic retraining
--------------------
Every run writes a ``manifest.json`` recording a SHA-256 over the *contents* of
each input file, along with the row count, date range and headline metrics.
:func:`needs_retrain` compares the current inputs against that manifest, so
dropping a new export into the data directory triggers a retrain on the next
run while re-running against unchanged data is a no-op.

Content hashing rather than modification time is deliberate: OneDrive, Dropbox
and `git checkout` all rewrite mtimes on files whose bytes never changed, and
mtime-based detection would retrain on every sync.

Metrics from each run are appended to ``metrics_history.csv``. Model accuracy
drifting across runs is the signal that a re-tuning is due, and it is only
visible if the history is kept.
"""

from __future__ import annotations

import json
import logging
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

from .anomalies import AnomalyReport, detect_anomalies
from .config import AppConfig
from .evaluation import EvaluationResult, evaluate_models
from .explain import Explanation, explain_model
from .features import build_daily, engineer
from .forecast import ForecastResult, forecast_all_targets
from .ingest import CallRecords, ValidationReport, discover_files, fingerprint_files, load_call_files
from .scenarios import run_scenarios

log = logging.getLogger(__name__)

__all__ = ["RunResult", "run_pipeline", "needs_retrain", "read_manifest"]

MANIFEST_NAME = "manifest.json"
HISTORY_NAME = "metrics_history.csv"


# --------------------------------------------------------------------------- #
#  Result                                                                      #
# --------------------------------------------------------------------------- #
@dataclass
class RunResult:
    """Everything one pipeline run produced."""

    cfg: AppConfig
    calls: CallRecords
    daily: pd.DataFrame
    features: pd.DataFrame
    evaluations: dict[str, EvaluationResult] = field(default_factory=dict)
    forecasts: dict[str, ForecastResult] = field(default_factory=dict)
    explanations: dict[str, Explanation] = field(default_factory=dict)
    anomalies: AnomalyReport | None = None
    scenarios: pd.DataFrame = field(default_factory=pd.DataFrame)
    scenario_notes: list[str] = field(default_factory=list)
    outputs: dict[str, Path] = field(default_factory=dict)
    manifest: dict[str, Any] = field(default_factory=dict)
    elapsed_seconds: float = 0.0

    @property
    def report(self) -> ValidationReport:
        """The ingestion report for this run."""
        return self.calls.report

    def summary(self) -> str:
        """Human-readable run summary, printed by the CLI."""
        lines = [
            "",
            "=" * 68,
            "  CALL FORECAST — RUN SUMMARY",
            "=" * 68,
            self.report.summary(),
            "",
            "Model selection",
            "---------------",
        ]
        for target, evaluation in self.evaluations.items():
            if evaluation.best_model:
                metrics = evaluation.evaluations[evaluation.best_model].metrics
                lines.append(
                    f"  {target:<18} {evaluation.best_model:<18} "
                    f"MAE={metrics.get('mae', float('nan')):.3f}  "
                    f"MASE={metrics.get('mase', float('nan')):.3f}  "
                    f"({evaluation.n_folds} folds)"
                )
            else:
                lines.append(f"  {target:<18} (no model could be selected)")

        if self.forecasts:
            lines += ["", "Forecast totals", "---------------"]
            for target, result in self.forecasts.items():
                for days in self.cfg.forecast.horizons:
                    if target == "avg_duration_sec":
                        stats = result.mean(days)
                        lines.append(
                            f"  {target:<18} {days:>3}d avg  {stats['mean']:>10.2f}"
                            f"  [{stats['lower']:.2f} .. {stats['upper']:.2f}]"
                        )
                    else:
                        stats = result.total(days)
                        lines.append(
                            f"  {target:<18} {days:>3}d total{stats['total']:>10.2f}"
                            f"  [{stats['lower']:.2f} .. {stats['upper']:.2f}]"
                        )

        if self.anomalies is not None:
            frame = self.anomalies.to_frame()
            critical = int((frame["severity"] == "critical").sum()) if not frame.empty else 0
            lines += [
                "",
                f"Anomalies: {len(self.anomalies)} flagged ({critical} critical)",
            ]

        lines += ["", "Outputs", "-------"]
        for name, path in self.outputs.items():
            lines.append(f"  {name:<22} {path}")
        lines += ["", f"Completed in {self.elapsed_seconds:.1f}s", "=" * 68, ""]
        return "\n".join(lines)


# --------------------------------------------------------------------------- #
#  Manifest / retrain detection                                                #
# --------------------------------------------------------------------------- #
def read_manifest(cfg: AppConfig) -> dict[str, Any] | None:
    """Load the previous run's manifest, or ``None`` if there isn't one."""
    path = cfg.paths.resolved().model_dir / MANIFEST_NAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read manifest %s: %s", path, exc)
        return None


def needs_retrain(cfg: AppConfig) -> tuple[bool, str]:
    """
    Decide whether the inputs have changed since the last run.

    Returns
    -------
    (needed, reason)
        ``reason`` is always populated, so the caller can log *why* it is or is
        not retraining rather than reporting a bare boolean.
    """
    paths = discover_files(cfg)
    if not paths:
        return False, "no input files found"

    manifest = read_manifest(cfg)
    if manifest is None:
        return True, "no previous run recorded"

    current = fingerprint_files(paths)
    previous = manifest.get("input_fingerprint")
    if previous != current:
        old_files = set(manifest.get("input_files", []))
        new_files = {p.name for p in paths} - old_files
        if new_files:
            return True, f"new input file(s): {', '.join(sorted(new_files))}"
        return True, "input file contents changed"

    return False, f"inputs unchanged since {manifest.get('generated_at', 'last run')}"


def _write_manifest(cfg: AppConfig, result: RunResult, paths: Sequence[Path]) -> dict[str, Any]:
    """Record this run so the next one can detect new data."""
    report = result.report
    manifest = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "input_files": [p.name for p in paths],
        "input_fingerprint": fingerprint_files(paths),
        "rows_kept": report.rows_kept,
        "date_min": None if report.date_min is None else str(report.date_min.date()),
        "date_max": None if report.date_max is None else str(report.date_max.date()),
        "active_days": report.active_days,
        "calendar_days": report.calendar_days,
        "coverage_pct": round(report.coverage_pct, 2),
        "selected_models": {
            target: evaluation.best_model
            for target, evaluation in result.evaluations.items()
        },
        "metrics": {
            target: {
                k: (None if not np.isfinite(v) else round(float(v), 6))
                for k, v in evaluation.evaluations[evaluation.best_model].metrics.items()
            }
            for target, evaluation in result.evaluations.items()
            if evaluation.best_model
        },
        "ingestion": report.to_dict(),
        "config": cfg.to_dict(),
    }

    path = cfg.paths.resolved().model_dir / MANIFEST_NAME
    path.write_text(json.dumps(manifest, indent=2, default=str), encoding="utf-8")
    log.info("Manifest written to %s", path)
    return manifest


def _append_history(cfg: AppConfig, manifest: Mapping[str, Any]) -> Path:
    """
    Append this run's headline metrics to the rolling history CSV.

    Tracking accuracy across runs is how model decay becomes visible: a MASE
    that climbs over successive retrains says the world changed, not that one
    forecast was unlucky.
    """
    rows = []
    for target, metrics in (manifest.get("metrics") or {}).items():
        row = {
            "run_at": manifest["generated_at"],
            "target": target,
            "model": (manifest.get("selected_models") or {}).get(target),
            "rows_kept": manifest.get("rows_kept"),
            "date_max": manifest.get("date_max"),
        }
        row.update(metrics)
        rows.append(row)

    path = cfg.paths.resolved().model_dir / HISTORY_NAME
    if not rows:
        return path

    frame = pd.DataFrame(rows)
    if path.exists():
        try:
            frame = pd.concat([pd.read_csv(path), frame], ignore_index=True)
        except (OSError, pd.errors.ParserError) as exc:
            log.warning("Could not read metrics history (%s); starting a new file.", exc)
    frame.to_csv(path, index=False)
    return path


# --------------------------------------------------------------------------- #
#  Output writing                                                              #
# --------------------------------------------------------------------------- #
def _write_outputs(cfg: AppConfig, result: RunResult) -> dict[str, Path]:
    """Write every CSV deliverable. Returns ``{name: path}``."""
    out_dir = cfg.paths.resolved().output_dir
    written: dict[str, Path] = {}

    def save(name: str, frame: pd.DataFrame, index: bool = False) -> None:
        if frame is None or frame.empty:
            return
        path = out_dir / f"{name}.csv"
        frame.to_csv(path, index=index)
        written[name] = path

    # -- daily forecasts, one combined file plus per-horizon slices ---------- #
    if result.forecasts:
        combined = []
        for target, forecast in result.forecasts.items():
            frame = forecast.daily.copy()
            frame.insert(0, "date", frame.index)
            frame = frame.reset_index(drop=True)
            frame["model_label"] = forecast.model_label
            frame["interval_level"] = forecast.interval_level
            combined.append(frame)
        all_forecasts = pd.concat(combined, ignore_index=True)
        save("forecast_daily", all_forecasts)

        for days in cfg.forecast.horizons:
            subset = all_forecasts.loc[all_forecasts["step"] <= days]
            save(f"forecast_{days}d", subset)

        save(
            "forecast_monthly",
            pd.concat([f.monthly for f in result.forecasts.values()], ignore_index=True),
        )

        # Horizon roll-ups: the numbers most people actually quote.
        rollup = []
        for target, forecast in result.forecasts.items():
            for days in cfg.forecast.horizons:
                stats = (
                    forecast.mean(days) if target == "avg_duration_sec"
                    else forecast.total(days)
                )
                key = "mean" if target == "avg_duration_sec" else "total"
                rollup.append(
                    {
                        "target": target,
                        "model": forecast.model_name,
                        "horizon_days": days,
                        "measure": "daily average" if key == "mean" else "total",
                        "forecast": stats[key],
                        "lower": stats["lower"],
                        "upper": stats["upper"],
                        "interval_level": forecast.interval_level,
                    }
                )
        save("forecast_summary", pd.DataFrame(rollup))

    # -- evaluation ---------------------------------------------------------- #
    if result.evaluations:
        boards = []
        cv_frames = []
        for target, evaluation in result.evaluations.items():
            if not evaluation.leaderboard.empty:
                board = evaluation.leaderboard.copy()
                board.insert(0, "target", target)
                board["selected"] = board["model"] == evaluation.best_model
                boards.append(board)
            cv = evaluation.cv_predictions()
            if not cv.empty:
                cv_frames.append(cv)
        if boards:
            save("model_leaderboard", pd.concat(boards, ignore_index=True))
        if cv_frames:
            save("cv_predictions", pd.concat(cv_frames, ignore_index=True))

    # -- anomalies ----------------------------------------------------------- #
    if result.anomalies is not None:
        frame = result.anomalies.to_frame()
        save("anomalies", frame)
        save("alert_summary", result.anomalies.by_rule())
        if not frame.empty:
            save("alerts_critical", frame.loc[frame["severity"] == "critical"])

    # -- explainability ------------------------------------------------------ #
    if result.explanations:
        importance = []
        for target, explanation in result.explanations.items():
            top = explanation.top_features(50)
            if top.empty:
                continue
            top.insert(0, "target", target)
            top.insert(1, "model", explanation.model_name)
            importance.append(top)
        if importance:
            save("feature_importance", pd.concat(importance, ignore_index=True))

        shap_frames = []
        for target, explanation in result.explanations.items():
            if explanation.shap_future is None or explanation.shap_future.empty:
                continue
            frame = explanation.shap_future.copy()
            frame.insert(0, "date", frame.index)
            frame.insert(1, "target", target)
            shap_frames.append(frame.reset_index(drop=True))
        if shap_frames:
            save("shap_forecast_contributions", pd.concat(shap_frames, ignore_index=True))

    # -- dashboard payload ---------------------------------------------------- #
    # The JSON view of the whole run: what a frontend consumes instead of
    # re-reading seventeen CSVs. Written unconditionally rather than behind the
    # report flag, because unlike the HTML it costs nothing (no Plotly import)
    # and it is the artefact an API would serve.
    #
    # Wrapped, on the same principle as the dashboard: the CSVs are the
    # load-bearing deliverable and a report artefact must never take the run
    # down with it.
    try:
        from .serialize import build_payload, write_payload

        payload = build_payload(
            calls=result.calls.frame,
            daily=result.daily,
            evaluations=result.evaluations,
            forecasts=result.forecasts,
            anomaly_report=result.anomalies,
            explanations=result.explanations,
            scenario_table=result.scenarios,
            scenario_notes=result.scenario_notes,
            ingestion_report=result.report,
            cfg=cfg,
        )
        written["dashboard_data"] = write_payload(
            out_dir / "dashboard_data.json", payload
        )
    except Exception as exc:  # noqa: BLE001 - CSVs must survive a payload failure
        log.error("Dashboard payload serialisation failed: %s", exc, exc_info=True)

    # -- scenarios & features ------------------------------------------------ #
    save("scenarios", result.scenarios)

    daily = result.daily.copy()
    daily.insert(0, "date", daily.index)
    save("daily_metrics", daily.reset_index(drop=True))

    features = result.features.copy()
    features.insert(0, "date", features.index)
    save("daily_features", features.reset_index(drop=True))

    return written


# --------------------------------------------------------------------------- #
#  Pipeline                                                                    #
# --------------------------------------------------------------------------- #
def run_pipeline(
    cfg: AppConfig | None = None,
    force: bool = True,
    build_report: bool = True,
    legacy_dashboard: bool = False,
    react_dashboard: bool | None = None,
) -> RunResult | None:
    """
    Run the full analysis and write every deliverable.

    Parameters
    ----------
    cfg:
        Configuration; defaults used when omitted.
    force:
        When ``False``, the run is skipped (returning ``None``) if the inputs
        are unchanged since the last run. This is the flag the scheduled
        "retrain when new data arrives" job uses.
    build_report:
        Whether to render the HTML dashboard. Turning it off makes CSV-only
        runs noticeably faster, since Plotly is only imported when needed.
    legacy_dashboard:
        Render the classic Python-assembled dashboard instead of the React
        one. As of PR 8, React is the default renderer; this flag is the
        opt-out, kept for one release cycle while the React renderer is
        proven in the field.
    react_dashboard:
        Deprecated back-compat keyword, retained for one release cycle so
        pre-PR-8 call sites keep working unchanged. When passed (not
        ``None``), it decides the renderer outright (``True`` -> React,
        ``False`` -> legacy) and emits a ``DeprecationWarning`` pointing
        callers at ``legacy_dashboard`` instead. Passing both
        ``legacy_dashboard=True`` and ``react_dashboard=True`` is an
        incoherent request and raises ``ValueError`` rather than being
        silently resolved.

    Returns
    -------
    RunResult or None
        ``None`` only when ``force=False`` and nothing changed.

    Raises
    ------
    ValueError
        If no input files are found, or none of them yield usable rows. Also
        raised if ``legacy_dashboard=True`` and ``react_dashboard=True`` are
        passed together.
    """
    # -- resolve the renderer choice up front, before any expensive work ----- #
    # A contradictory call (asking for both legacy and React at once) must
    # fail fast here, not after a multi-minute run has already happened.
    if legacy_dashboard and react_dashboard is True:
        raise ValueError(
            "run_pipeline() received both legacy_dashboard=True and "
            "react_dashboard=True, which is a contradictory request. Pass "
            "only legacy_dashboard to choose the renderer."
        )

    if react_dashboard is None:
        use_legacy = legacy_dashboard
    else:
        warnings.warn(
            "run_pipeline(react_dashboard=...) is deprecated and will be "
            "removed after this release cycle; use legacy_dashboard=True to "
            "request the classic Python-assembled dashboard instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        log.warning(
            "run_pipeline() called with the deprecated react_dashboard=%r "
            "keyword; use legacy_dashboard=True instead.",
            react_dashboard,
        )
        use_legacy = not react_dashboard

    cfg = cfg or AppConfig.default()
    cfg_paths = cfg.paths.ensure()
    started = time.perf_counter()

    if not force:
        needed, reason = needs_retrain(cfg)
        if not needed:
            log.info("Skipping run: %s.", reason)
            return None
        log.info("Retraining: %s.", reason)

    # -- ingest -------------------------------------------------------------- #
    paths = discover_files(cfg)
    if not paths:
        raise ValueError(
            f"No exports matching {list(cfg.data.patterns)} in {cfg_paths.data_dir}. "
            "Drop a call export (.csv or .xlsx) there and re-run."
        )
    log.info("Loading %d file(s) from %s", len(paths), cfg_paths.data_dir)
    calls = load_call_files(paths, cfg)

    # -- features ------------------------------------------------------------ #
    daily = build_daily(calls.frame, cfg)
    features, spec = engineer(daily, cfg)
    log.info(
        "Built %d daily rows with %d engineered feature(s).",
        len(daily), len(spec.all_features),
    )

    result = RunResult(cfg=cfg, calls=calls, daily=daily, features=features)

    # -- evaluate & forecast ------------------------------------------------- #
    for target in cfg.forecast.targets:
        if target not in daily.columns:
            log.warning("Target %s is not in the daily frame; skipping.", target)
            continue
        result.evaluations[target] = evaluate_models(daily, target, cfg)

    result.forecasts = forecast_all_targets(daily, result.evaluations, cfg)

    # -- explain -------------------------------------------------------------- #
    for target, forecast in result.forecasts.items():
        if forecast.model is None:
            continue
        try:
            result.explanations[target] = explain_model(forecast.model, cfg)
        except Exception as exc:  # noqa: BLE001 - explanation is never load-bearing
            log.warning("Explanation failed for %s: %s", target, exc)

    # -- anomalies ------------------------------------------------------------ #
    # The cost forecast covers the future, not the history being audited, so the
    # detector uses its own trailing baseline here rather than a model curve.
    result.anomalies = detect_anomalies(daily, cfg)

    # -- scenarios ------------------------------------------------------------ #
    try:
        table, _, notes = run_scenarios(daily, result.forecasts, cfg)
        result.scenarios, result.scenario_notes = table, notes
    except Exception as exc:  # noqa: BLE001
        log.warning("Scenario analysis failed: %s", exc)

    # -- outputs --------------------------------------------------------------- #
    result.outputs = _write_outputs(cfg, result)

    if build_report:
        try:
            # Both renderers take the same arguments and write the same file,
            # so the choice is one name. The import stays inside the branch, as
            # it always has been, so a --no-report run loads neither. React is
            # the default as of PR 8; the legacy renderer is the opt-out via
            # --legacy-dashboard. The React renderer never imports Plotly at
            # all — the charts are drawn in the browser, not here.
            if use_legacy:
                from .dashboard import build_dashboard
            else:
                from .dashboard import build_dashboard_react as build_dashboard

            path = build_dashboard(
                output_path=cfg_paths.report_dir / "dashboard.html",
                calls=calls.frame,
                daily=daily,
                evaluations=result.evaluations,
                forecasts=result.forecasts,
                anomaly_report=result.anomalies,
                explanations=result.explanations,
                scenario_table=result.scenarios,
                scenario_notes=result.scenario_notes,
                ingestion_report=calls.report,
                cfg=cfg,
            )
            result.outputs["dashboard"] = path
        except Exception as exc:  # noqa: BLE001 - CSVs are already safely on disk
            renderer_name = "Legacy" if use_legacy else "React"
            suggestion = (
                " Re-run with --legacy-dashboard to fall back to the classic renderer."
                if not use_legacy else ""
            )
            log.error(
                "%s dashboard rendering failed: %s. CSV/data outputs are unaffected "
                "and have already been written.%s",
                renderer_name, exc, suggestion, exc_info=True,
            )

    result.manifest = _write_manifest(cfg, result, paths)
    result.outputs["metrics_history"] = _append_history(cfg, result.manifest)
    result.outputs["manifest"] = cfg_paths.model_dir / MANIFEST_NAME

    result.elapsed_seconds = time.perf_counter() - started
    log.info("Pipeline finished in %.1fs.", result.elapsed_seconds)
    return result
