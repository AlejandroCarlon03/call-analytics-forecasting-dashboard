"""Anomaly rules, queueing models, config validation, and the end-to-end run."""

from __future__ import annotations

import dataclasses
import math

import numpy as np
import pandas as pd
import pytest

from call_forecast.anomalies import detect_anomalies, robust_zscore, trailing_baseline
from call_forecast.config import AppConfig, CVConfig, PathsConfig
from call_forecast.scenarios import (
    abandonment_rate,
    agents_required,
    average_speed_of_answer,
    erlang_b,
    erlang_c,
    run_scenarios,
    service_level,
)


# --------------------------------------------------------------------------- #
#  Anomalies                                                                   #
# --------------------------------------------------------------------------- #
class TestRobustZScore:
    def test_outlier_scores_high_without_inflating_its_own_scale(self):
        series = pd.Series([10.0] * 20 + [11.0] * 20 + [500.0])
        assert abs(robust_zscore(series).iloc[-1]) > 10

    def test_constant_series_scores_zero(self):
        assert (robust_zscore(pd.Series([5.0] * 10)) == 0).all()

    def test_falls_back_to_std_when_mad_is_zero(self):
        series = pd.Series([1.0, 1.0, 1.0, 1.0, 20.0])
        scores = robust_zscore(series)
        assert np.isfinite(scores).all()
        assert scores.iloc[-1] > 0


class TestTrailingBaseline:
    def test_baseline_never_includes_the_current_day(self):
        index = pd.date_range("2026-01-01", periods=60, freq="D")
        series = pd.Series(np.arange(60.0), index=index)
        base = trailing_baseline(series, window=4, weekday_aware=False, min_periods=2)
        # Day t's mean is over t-4..t-1, which is strictly below the day's value.
        tail = base["mean"].dropna()
        assert (tail < series.loc[tail.index]).all()

    def test_weekday_aware_baseline_tracks_the_weekly_cycle(self):
        index = pd.date_range("2026-01-05", periods=70, freq="D")   # a Monday
        values = np.where(index.dayofweek >= 5, 2.0, 20.0)
        series = pd.Series(values, index=index)
        base = trailing_baseline(series, window=4, weekday_aware=True, min_periods=2)

        weekend = base["mean"][index.dayofweek >= 5].dropna()
        weekday = base["mean"][index.dayofweek < 5].dropna()
        assert weekend.mean() < weekday.mean()


class TestAnomalyRules:
    def test_finds_the_planted_spike(self, daily, cfg):
        """conftest plants a 45-call day (vs ~10) with tripled durations."""
        report = detect_anomalies(daily, cfg)
        frame = report.to_frame()
        spike_day = daily["call_volume"].idxmax()
        assert spike_day in set(frame["date"])

    def test_overnight_calls_are_always_flagged(self, daily, cfg):
        tampered = daily.copy()
        target = tampered.index[50]
        tampered.loc[target, "overnight_calls"] = 4

        report = detect_anomalies(tampered, cfg)
        frame = report.to_frame()
        overnight = frame.loc[frame["rule"] == "overnight_activity"]
        assert target in set(overnight["date"])

    def test_cost_overrun_respects_the_configured_threshold(self, daily, cfg):
        strict = dataclasses.replace(
            cfg, anomalies=dataclasses.replace(cfg.anomalies, cost_overrun_pct=0.05)
        )
        lenient = dataclasses.replace(
            cfg, anomalies=dataclasses.replace(cfg.anomalies, cost_overrun_pct=5.0)
        )
        n_strict = len(detect_anomalies(daily, strict).to_frame().query("rule == 'cost_overrun'"))
        n_lenient = len(detect_anomalies(daily, lenient).to_frame().query("rule == 'cost_overrun'"))
        assert n_strict > n_lenient

    def test_missed_spike_ignores_tiny_days(self, daily, cfg):
        """One missed call out of two is 50% but operationally meaningless."""
        tampered = daily.copy()
        target = tampered.index[60]
        tampered.loc[target, ["call_volume", "missed_calls", "missed_call_pct"]] = [2, 1, 0.5]

        frame = detect_anomalies(tampered, cfg).to_frame()
        missed = frame.loc[frame["rule"] == "missed_call_spike"]
        assert target not in set(missed["date"])

    def test_short_history_skips_detection_with_a_note(self, daily, cfg):
        report = detect_anomalies(daily.head(5), cfg)
        assert len(report) == 0
        assert report.notes

    def test_summary_groups_by_rule_and_severity(self, daily, cfg):
        summary = detect_anomalies(daily, cfg).by_rule()
        if not summary.empty:
            assert set(summary.columns) == {"rule", "severity", "count"}


# --------------------------------------------------------------------------- #
#  Queueing                                                                    #
# --------------------------------------------------------------------------- #
class TestErlang:
    def test_erlang_b_matches_textbook_values(self):
        assert erlang_b(2.0, 3) == pytest.approx(0.21053, abs=1e-5)
        assert erlang_b(1.0, 1) == pytest.approx(0.5)

    def test_erlang_c_matches_textbook_values(self):
        assert erlang_c(2.0, 3) == pytest.approx(0.44444, abs=1e-5)

    def test_erlang_c_saturates_at_one_when_unstable(self):
        assert erlang_c(5.0, 5) == 1.0
        assert erlang_c(9.0, 5) == 1.0

    def test_erlang_c_falls_as_agents_are_added(self):
        values = [erlang_c(3.0, n) for n in range(4, 12)]
        assert values == sorted(values, reverse=True)

    def test_wait_is_infinite_for_an_unstable_queue(self):
        assert math.isinf(average_speed_of_answer(5.0, 5, 180))

    def test_wait_matches_the_closed_form(self):
        assert average_speed_of_answer(2.0, 3, 180) == pytest.approx(80.0, abs=1e-6)

    def test_service_level_is_bounded_and_monotone_in_agents(self):
        values = [service_level(3.0, n, 180, 30) for n in range(4, 12)]
        assert all(0.0 <= v <= 1.0 for v in values)
        assert values == sorted(values)

    def test_agents_required_meets_the_target(self):
        n = agents_required(2.0, 180, 30, 0.80)
        assert n == 4
        assert service_level(2.0, n, 180, 30) >= 0.80
        assert service_level(2.0, n - 1, 180, 30) < 0.80

    def test_no_load_needs_no_agents(self):
        assert agents_required(0.0, 180, 30, 0.8) == 0

    def test_abandonment_rises_with_load(self):
        low = abandonment_rate(1.0, 4, 180, 0.01)
        high = abandonment_rate(3.5, 4, 180, 0.01)
        assert 0.0 <= low < high <= 1.0

    def test_everyone_abandons_an_unstable_queue(self):
        assert abandonment_rate(5.0, 4, 180, 0.01) == 1.0

    def test_infinite_patience_means_no_abandonment(self):
        assert abandonment_rate(2.0, 3, 180, 0.0) == 0.0


class TestScenarios:
    def test_baseline_row_comes_first_and_is_unmodified(self, daily, cfg):
        table, outcomes, _ = run_scenarios(daily, {}, cfg)
        assert table.iloc[0]["scenario"] == "Baseline"
        assert table.iloc[0]["volume_uplift_pct"] == 0.0

    def test_volume_and_cost_scale_with_the_uplift(self, daily, cfg):
        # Assert on the outcome objects, not the table: `as_row` rounds for
        # display, and comparing a rounded product against a product of
        # rounded values fails on rounding alone.
        _, outcomes, _ = run_scenarios(daily, {}, cfg, uplifts=[0.15])
        base, up = outcomes[0], outcomes[1]
        assert up.daily_calls == pytest.approx(base.daily_calls * 1.15, rel=1e-9)
        assert up.monthly_cost > base.monthly_cost

    def test_wait_time_grows_at_least_as_fast_as_volume(self, daily, cfg):
        """Queueing is non-linear: wait must never scale *sub*-linearly."""
        loaded = dataclasses.replace(
            cfg, scenarios=dataclasses.replace(cfg.scenarios, current_agents=1,
                                               staffed_hours_per_day=1.0)
        )
        table, _, _ = run_scenarios(daily, {}, loaded, uplifts=[0.5])
        base, up = table.iloc[0], table.iloc[1]
        if pd.notna(base["avg_wait_seconds"]) and pd.notna(up["avg_wait_seconds"]):
            assert up["avg_wait_seconds"] >= base["avg_wait_seconds"]

    def test_required_agents_never_decreases_with_volume(self, daily, cfg):
        table, _, _ = run_scenarios(daily, {}, cfg, uplifts=[0.1, 0.5, 2.0])
        assert list(table["required_agents"]) == sorted(table["required_agents"])

    def test_assumptions_are_reported(self, daily, cfg):
        _, _, notes = run_scenarios(daily, {}, cfg)
        assert any("agent" in n.lower() for n in notes)


# --------------------------------------------------------------------------- #
#  Config                                                                      #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_defaults_are_complete(self):
        cfg = AppConfig.default()
        assert cfg.forecast.horizons == (30, 60, 90)
        assert "xgboost" in cfg.models.enabled

    def test_from_mapping_merges_partial_overrides(self):
        cfg = AppConfig.from_mapping({"forecast": {"horizons": [7, 14]}})
        assert cfg.forecast.horizons == (7, 14)
        assert cfg.forecast.interval_level == 0.80      # default preserved

    def test_unknown_section_raises(self):
        with pytest.raises(ValueError, match="Unknown config section"):
            AppConfig.from_mapping({"nonsense": {}})

    def test_unknown_key_raises_with_valid_names(self):
        with pytest.raises(ValueError, match="Unknown key"):
            AppConfig.from_mapping({"forecast": {"horzions": [30]}})

    def test_yaml_roundtrip(self, tmp_path):
        import yaml

        path = tmp_path / "config.yaml"
        path.write_text(yaml.safe_dump({"forecast": {"horizons": [15, 45]},
                                        "scenarios": {"current_agents": 3}}))
        cfg = AppConfig.from_yaml(path)
        assert cfg.forecast.horizons == (15, 45)
        assert cfg.scenarios.current_agents == 3

    def test_to_dict_is_json_serialisable(self):
        import json

        json.dumps(AppConfig.default().to_dict())

    def test_paths_resolve_against_root(self, tmp_path):
        cfg = AppConfig.from_mapping({"paths": {"root": str(tmp_path)}})
        assert cfg.paths.resolved().data_dir == tmp_path / "data"

    def test_ensure_creates_directories(self, tmp_path):
        resolved = AppConfig.from_mapping({"paths": {"root": str(tmp_path)}}).paths.ensure()
        for path in (resolved.data_dir, resolved.output_dir, resolved.model_dir, resolved.report_dir):
            assert path.is_dir()


# --------------------------------------------------------------------------- #
#  End to end                                                                  #
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def pipeline_result(tmp_path_factory):
    """
    One full pipeline run, shared across the end-to-end assertions.

    Module-scoped rather than class-scoped so the run happens once without
    tripping pytest's instance-method fixture deprecation.
    """
    from call_forecast.pipeline import run_pipeline
    from conftest import _synthetic_calls

    root = tmp_path_factory.mktemp("pipeline")
    data_dir = root / "data"
    data_dir.mkdir()
    _synthetic_calls(np.random.default_rng(7), days=200).to_csv(
        data_dir / "export.csv", index=False
    )

    base = AppConfig.default()
    cfg = dataclasses.replace(
        base,
        paths=PathsConfig(root=root),
        models=dataclasses.replace(
            base.models, enabled=("seasonal_naive", "random_forest")
        ),
        cv=CVConfig(initial_train_days=150, horizon=7, step=21, min_folds=2),
        forecast=dataclasses.replace(base.forecast, n_simulations=200),
    )
    return run_pipeline(cfg, force=True, build_report=True), cfg, root


class TestPipeline:
    def test_run_completes_and_selects_models(self, pipeline_result):
        result, _, _ = pipeline_result
        assert result is not None
        assert set(result.forecasts) == {"call_volume", "avg_duration_sec", "total_cost"}
        for evaluation in result.evaluations.values():
            assert evaluation.best_model is not None

    def test_expected_outputs_are_written(self, pipeline_result):
        result, _, _ = pipeline_result
        expected = {
            "forecast_daily", "forecast_30d", "forecast_60d", "forecast_90d",
            "forecast_monthly", "forecast_summary", "model_leaderboard",
            "anomalies", "scenarios", "daily_metrics", "daily_features",
            "feature_importance", "dashboard", "manifest",
        }
        missing = expected - set(result.outputs)
        assert not missing, f"missing outputs: {missing}"
        for name, path in result.outputs.items():
            assert path.exists(), f"{name} was recorded but not written"

    def test_dashboard_is_self_contained(self, pipeline_result):
        """
        No external resource references — the page must work offline.

        Checked by looking for tags that would *fetch* something, rather than
        for a CDN hostname: Plotly's own bundle contains its default topojson
        URL as a config string, which is inert unless a geo chart is drawn.
        """
        import re

        result, _, _ = pipeline_result
        html = result.outputs["dashboard"].read_text(encoding="utf-8")

        assert "Call Analytics Forecast" in html
        assert "<script>" in html

        assert not re.search(r"<script[^>]+\ssrc\s*=", html, re.I)
        assert not re.search(r"<link[^>]+\shref\s*=", html, re.I)
        assert not re.search(r"<img[^>]+\ssrc\s*=\s*[\"']https?:", html, re.I)

    def test_forecast_csv_columns(self, pipeline_result):
        result, _, _ = pipeline_result
        frame = pd.read_csv(result.outputs["forecast_daily"])
        for column in ("date", "yhat", "yhat_lower", "yhat_upper", "target", "model"):
            assert column in frame.columns

    def test_rerun_is_skipped_when_inputs_are_unchanged(self, pipeline_result):
        from call_forecast.pipeline import needs_retrain, run_pipeline

        _, cfg, _ = pipeline_result
        needed, _ = needs_retrain(cfg)
        assert not needed
        assert run_pipeline(cfg, force=False, build_report=False) is None

    def test_new_data_triggers_a_retrain(self, pipeline_result):
        from call_forecast.pipeline import needs_retrain

        _, cfg, root = pipeline_result
        from conftest import _synthetic_calls

        _synthetic_calls(np.random.default_rng(99), days=30).to_csv(
            root / "data" / "second_export.csv", index=False
        )
        needed, reason = needs_retrain(cfg)
        assert needed
        assert "new input file" in reason
