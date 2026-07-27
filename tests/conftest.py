"""
Shared fixtures.

Tests run against **synthetic** call data with a known structure rather than a
real export, so they assert on properties we control (a planted weekly cycle, a
planted anomaly) and keep passing when the real file changes.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from call_forecast.config import AppConfig, CVConfig, PathsConfig
from call_forecast.features import build_daily
from call_forecast.ingest import load_call_files


@pytest.fixture
def rng() -> np.random.Generator:
    """Seeded generator, so a failing test fails the same way twice."""
    return np.random.default_rng(20260727)


def _synthetic_calls(rng: np.random.Generator, days: int = 180) -> pd.DataFrame:
    """
    Build a call-level frame with a planted weekly cycle.

    Weekdays average ~10 calls, weekends ~2. Durations centre on 90s. One
    deliberate spike day is planted at day 100 so anomaly tests have a known
    target.
    """
    start = pd.Timestamp("2026-01-01")
    rows: list[dict] = []

    for offset in range(days):
        date = start + pd.Timedelta(days=offset)
        base = 2 if date.dayofweek >= 5 else 10
        if offset == 100:
            base = 45                      # the planted anomaly
        count = max(0, int(rng.poisson(base)))

        for _ in range(count):
            hour = int(np.clip(rng.normal(11, 3), 0, 23))
            minute = int(rng.integers(0, 60))
            duration = float(max(0.0, rng.normal(90, 40)))
            if offset == 100:
                duration *= 3.0            # the planted duration spike
            ts = date + pd.Timedelta(hours=hour, minutes=minute)
            rows.append(
                {
                    "Time": ts.strftime("%m/%d/%Y %H:%M"),
                    "Call Duration": f"{int(duration // 60)}:{int(duration % 60):02d}",
                    "Cost": f"${duration * 0.0033:.3f}",
                    "Disconnection Reason": rng.choice(["user_hangup", "agent_hangup"]),
                    "Call Status": "ended" if duration > 0 else "not_connected",
                    "User Sentiment": rng.choice(["Neutral", "Positive", "Negative"],
                                                 p=[0.8, 0.15, 0.05]),
                    "Call Successful": rng.choice(["Successful", "Unsuccessful"]),
                    "End to End Latency": f"{rng.normal(2500, 400):.1f}",
                }
            )
    return pd.DataFrame(rows)


@pytest.fixture
def synthetic_csv(tmp_path: Path, rng: np.random.Generator) -> Path:
    """A synthetic export written to a temp data directory."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = data_dir / "synthetic_export.csv"
    _synthetic_calls(rng).to_csv(path, index=False)
    return path


@pytest.fixture
def cfg(tmp_path: Path) -> AppConfig:
    """Config rooted in a temp directory, with a CV budget suited to tests."""
    return dataclasses.replace(
        AppConfig.default(),
        paths=PathsConfig(root=tmp_path),
        cv=CVConfig(initial_train_days=90, horizon=7, step=14, min_folds=2),
    )


@pytest.fixture
def calls(synthetic_csv: Path, cfg: AppConfig):
    """Loaded synthetic call records."""
    return load_call_files([synthetic_csv], cfg)


@pytest.fixture
def daily(calls, cfg: AppConfig) -> pd.DataFrame:
    """Daily aggregated frame from the synthetic data."""
    return build_daily(calls.frame, cfg)
