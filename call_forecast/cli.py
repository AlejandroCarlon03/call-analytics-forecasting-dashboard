#!/usr/bin/env python3
"""
call_forecast.cli
=================
Command-line entry point.

Commands
--------
``run``
    Full pipeline: ingest, validate, forecast, explain, detect, report.
``check``
    Report whether new data has arrived, without training anything. Cheap
    enough to run from a scheduler every few minutes.
``watch``
    Poll the data directory and retrain whenever the inputs change.
``forecast``
    Print the headline numbers for one target without writing the dashboard.
``inspect``
    Data-quality report only — what was loaded, what was dropped, and why.

Run ``python -m call_forecast --help`` for the full option list.
"""

from __future__ import annotations

import argparse
import dataclasses
import logging
import sys
import time
from pathlib import Path

from .config import AppConfig, PathsConfig

log = logging.getLogger("call_forecast")

__all__ = ["main", "build_parser"]


# --------------------------------------------------------------------------- #
#  Setup                                                                       #
# --------------------------------------------------------------------------- #
def _configure_logging(verbosity: int) -> None:
    """Map -v/-q onto logging levels with a compact format."""
    level = {0: logging.WARNING, 1: logging.INFO}.get(verbosity, logging.DEBUG)
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    # These libraries are conversational at INFO and drown out our own output.
    for noisy in ("cmdstanpy", "prophet", "matplotlib", "numexpr", "shap"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _load_config(args: argparse.Namespace) -> AppConfig:
    """Build the config from --config and/or --root, with --root winning."""
    cfg = AppConfig.from_yaml(args.config) if args.config else AppConfig.default()

    if args.root:
        cfg = dataclasses.replace(
            cfg, paths=dataclasses.replace(cfg.paths, root=Path(args.root))
        )
    elif not args.config:
        # No config and no explicit root: work relative to the current directory.
        cfg = dataclasses.replace(
            cfg, paths=dataclasses.replace(cfg.paths, root=Path.cwd())
        )

    if getattr(args, "data_dir", None):
        cfg = dataclasses.replace(
            cfg, paths=dataclasses.replace(cfg.paths, data_dir=Path(args.data_dir))
        )
    return cfg


# --------------------------------------------------------------------------- #
#  Commands                                                                    #
# --------------------------------------------------------------------------- #
def cmd_run(args: argparse.Namespace) -> int:
    """Run the full pipeline."""
    from .pipeline import run_pipeline

    cfg = _load_config(args)
    result = run_pipeline(
        cfg,
        force=not args.only_if_changed,
        build_report=not args.no_report,
        react_dashboard=args.react_dashboard,
    )

    if result is None:
        print("Inputs unchanged since the last run — nothing to do.")
        print("Use `run` without --only-if-changed to force a retrain.")
        return 0

    print(result.summary())
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """Report whether a retrain is warranted. Exit code 1 means 'yes'."""
    from .pipeline import needs_retrain, read_manifest

    cfg = _load_config(args)
    needed, reason = needs_retrain(cfg)
    manifest = read_manifest(cfg)

    print(f"Data directory : {cfg.paths.resolved().data_dir}")
    if manifest:
        print(f"Last run       : {manifest.get('generated_at')}")
        print(f"Rows then      : {manifest.get('rows_kept')} "
              f"through {manifest.get('date_max')}")
        selected = manifest.get("selected_models") or {}
        if selected:
            print("Models         : " + ", ".join(f"{k}={v}" for k, v in selected.items()))
    else:
        print("Last run       : never")

    print(f"Retrain needed : {'YES' if needed else 'no'} ({reason})")
    # Non-zero when work is pending, so shell scripts can branch on it.
    return 1 if needed else 0


def cmd_watch(args: argparse.Namespace) -> int:
    """Poll the data directory and retrain on change."""
    from .pipeline import run_pipeline

    cfg = _load_config(args)
    interval = max(args.interval, 5)
    print(f"Watching {cfg.paths.resolved().data_dir} every {interval}s. Ctrl-C to stop.")

    try:
        while True:
            try:
                result = run_pipeline(
                    cfg,
                    force=False,
                    build_report=not args.no_report,
                    react_dashboard=args.react_dashboard,
                )
                if result is not None:
                    print(result.summary())
                    print(f"Waiting for further changes ({interval}s poll)...")
            except Exception as exc:  # noqa: BLE001 - a watcher must survive a bad file
                log.error("Run failed, will retry on the next poll: %s", exc, exc_info=True)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    return 0


def cmd_forecast(args: argparse.Namespace) -> int:
    """Forecast a single target and print the headline numbers."""
    from .evaluation import evaluate_models
    from .features import build_daily
    from .forecast import generate_forecast
    from .ingest import load_calls

    cfg = _load_config(args)
    daily = build_daily(load_calls(cfg).frame, cfg)

    evaluation = evaluate_models(daily, args.target, cfg)
    if evaluation.best_model is None:
        print(f"No model could be validated for {args.target}.")
        for note in evaluation.notes:
            print(f"  - {note}")
        return 2

    result = generate_forecast(daily, args.target, evaluation, cfg, model_name=args.model)

    print(f"\nTarget : {args.target}")
    print(f"Model  : {result.model_label} ({result.model_name})")
    print(f"Level  : {int(result.interval_level * 100)}% interval\n")

    for days in cfg.forecast.horizons:
        if args.target == "avg_duration_sec":
            stats = result.mean(days)
            print(f"  {days:>3}d  daily average  {stats['mean']:>10.2f}  "
                  f"[{stats['lower']:.2f} .. {stats['upper']:.2f}]")
        else:
            stats = result.total(days)
            print(f"  {days:>3}d  total          {stats['total']:>10.2f}  "
                  f"[{stats['lower']:.2f} .. {stats['upper']:.2f}]")

    if not result.monthly.empty:
        print("\n  Monthly:")
        for _, row in result.monthly.iterrows():
            flag = " (partial)" if row["partial_month"] else ""
            print(f"    {row['month']}{flag:<10} {row['yhat']:>10.2f}  "
                  f"[{row['yhat_lower']:.2f} .. {row['yhat_upper']:.2f}]")

    for note in result.notes:
        print(f"\n  Note: {note}")
    print()
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    """Load the data and print the quality report, without modelling."""
    from .features import build_daily
    from .ingest import load_calls

    cfg = _load_config(args)
    calls = load_calls(cfg)
    print(calls.report.summary())

    daily = build_daily(calls.frame, cfg)
    print("\nDaily metrics")
    print("-------------")
    describe = daily[["call_volume", "avg_duration_sec", "total_cost", "missed_call_pct"]]
    print(describe.describe().round(3).to_string())

    zero_days = int((daily["call_volume"] == 0).sum())
    print(f"\n  Zero-call days   : {zero_days} of {len(daily)}")
    print(f"  Busiest day      : {daily['call_volume'].idxmax():%Y-%m-%d} "
          f"({daily['call_volume'].max():.0f} calls)")
    print(f"  Total cost       : ${daily['total_cost'].sum():,.2f}")
    return 0


# --------------------------------------------------------------------------- #
#  Parser                                                                      #
# --------------------------------------------------------------------------- #
def build_parser() -> argparse.ArgumentParser:
    """Construct the argument parser (kept separate so tests can inspect it)."""
    # Shared options live on a parent parser attached to both the root parser
    # and every subcommand, so `run -v` and `-v run` both work. argparse
    # otherwise only accepts global flags *before* the subcommand, which is a
    # reliable source of "unrecognized arguments" for anyone typing naturally.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-c", "--config", help="path to a YAML config file")
    common.add_argument("--root", help="project root (data/, outputs/, reports/ live here)")
    common.add_argument("--data-dir", help="override the input directory")
    common.add_argument("-v", "--verbose", action="count", default=0,
                        help="-v for progress, -vv for debug")

    parser = argparse.ArgumentParser(
        prog="call_forecast",
        parents=[common],
        description="Forecast call volume, duration and cost from call-analytics exports.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  python -m call_forecast run -v\n"
            "  python -m call_forecast run --only-if-changed\n"
            "  python -m call_forecast forecast call_volume\n"
            "  python -m call_forecast watch --interval 300\n"
        ),
    )

    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", parents=[common], help="run the full pipeline")
    run.add_argument("--only-if-changed", action="store_true",
                     help="skip the run when the inputs are unchanged")
    run.add_argument("--no-report", action="store_true",
                     help="write CSVs but skip the HTML dashboard")
    run.add_argument("--react-dashboard", action="store_true",
                     help="render the React dashboard instead of the classic one "
                          "(same file, much smaller; opt-in while it is proven)")
    run.set_defaults(func=cmd_run)

    check = sub.add_parser("check", parents=[common],
                           help="report whether new data has arrived")
    check.set_defaults(func=cmd_check)

    watch = sub.add_parser("watch", parents=[common],
                           help="poll for new data and retrain")
    watch.add_argument("--interval", type=int, default=300,
                       help="seconds between polls (default 300)")
    watch.add_argument("--no-report", action="store_true",
                       help="write CSVs but skip the HTML dashboard")
    watch.add_argument("--react-dashboard", action="store_true",
                       help="render the React dashboard instead of the classic one")
    watch.set_defaults(func=cmd_watch)

    forecast = sub.add_parser("forecast", parents=[common],
                              help="forecast one target to stdout")
    forecast.add_argument("target", choices=["call_volume", "avg_duration_sec", "total_cost"])
    forecast.add_argument("--model", help="force a specific model instead of auto-selecting")
    forecast.set_defaults(func=cmd_forecast)

    inspect = sub.add_parser("inspect", parents=[common],
                             help="data-quality report only")
    inspect.set_defaults(func=cmd_inspect)

    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Returns a process exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args.verbose)

    try:
        return int(args.func(args))
    except ValueError as exc:
        # Expected, actionable problems (missing data, bad column) get a clean
        # one-line message; unexpected ones keep their traceback.
        print(f"\nError: {exc}\n", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
