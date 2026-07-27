"""
Tests for the dashboard payload contract.

The point of this module is the contract, not the numbers: a frontend is about
to be written against this shape, so the assertions are about what a consumer
can *rely on* — that the JSON parses strictly, that no NaN survives, that every
value the current HTML dashboard renders is reachable, and that the payload
degrades to something valid when a section is missing.
"""

from __future__ import annotations

import dataclasses
import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from call_forecast.config import AppConfig, CVConfig, PathsConfig
from call_forecast.serialize import (
    SCHEMA_VERSION,
    build_payload,
    dumps,
    write_payload,
)
from call_forecast.serialize import _iso, _json_safe, _records, _scalar


# --------------------------------------------------------------------------- #
#  Coercion primitives                                                         #
# --------------------------------------------------------------------------- #
class TestScalarCoercion:
    def test_non_finite_floats_become_null(self):
        for value in (float("nan"), float("inf"), float("-inf"),
                      np.float64("nan"), np.float64("inf")):
            assert _scalar(value) is None

    def test_finite_floats_survive(self):
        assert _scalar(np.float64(1.5)) == 1.5
        assert isinstance(_scalar(np.float64(1.5)), float)

    def test_numpy_integers_become_int(self):
        assert _scalar(np.int64(7)) == 7
        assert isinstance(_scalar(np.int64(7)), int)

    def test_bools_stay_bools_not_ints(self):
        """bool subclasses int; checked in the wrong order these become 0/1."""
        assert _scalar(True) is True
        assert _scalar(np.bool_(False)) is False

    def test_missing_sentinels_become_null(self):
        assert _scalar(None) is None
        assert _scalar(pd.NaT) is None
        assert _scalar(pd.NA) is None

    def test_nat_is_not_formatted_as_a_date(self):
        """NaT subclasses datetime, so date handling must not see it first."""
        assert _scalar(pd.NaT) is None

    def test_timestamps_render_as_iso(self):
        assert _scalar(pd.Timestamp("2026-07-28")) == "2026-07-28"
        assert _scalar(datetime(2026, 7, 28)) == "2026-07-28"

    def test_timestamps_with_a_time_keep_it(self):
        assert _iso(pd.Timestamp("2026-07-28 14:30")) == "2026-07-28T14:30:00"

    def test_paths_become_strings(self):
        assert _scalar(Path("a") / "b") == str(Path("a") / "b")

    def test_unknown_types_are_stringified_not_raised(self):
        class Odd:
            def __str__(self) -> str:
                return "odd"

        assert _scalar(Odd()) == "odd"


class TestContainerCoercion:
    def test_nested_structures_are_cleaned_throughout(self):
        payload = _json_safe(
            {"a": [np.float64("nan"), {"b": np.int64(2)}], "c": (True, pd.NaT)}
        )
        assert payload == {"a": [None, {"b": 2}], "c": [True, None]}

    def test_numpy_arrays_become_lists(self):
        assert _json_safe(np.array([1.0, np.nan])) == [1.0, None]

    def test_records_promotes_the_index(self):
        frame = pd.DataFrame(
            {"x": [1.0, 2.0]}, index=pd.to_datetime(["2026-01-01", "2026-01-02"])
        )
        rows = _records(frame, index_name="date")
        assert rows == [{"date": "2026-01-01", "x": 1.0}, {"date": "2026-01-02", "x": 2.0}]

    def test_records_on_empty_frame_is_an_empty_list(self):
        assert _records(pd.DataFrame()) == []
        assert _records(None) == []

    def test_records_skips_absent_optional_columns(self):
        frame = pd.DataFrame({"a": [1], "b": [2]})
        assert _records(frame, columns=["a", "missing"]) == [{"a": 1}]

    def test_categorical_columns_become_strings(self):
        """``horizon_bucket`` is a pandas Categorical from ``pd.cut``."""
        frame = pd.DataFrame(
            {"bucket": pd.cut([1, 45], bins=[0, 30, 60], labels=["30d", "60d"])}
        )
        assert _records(frame) == [{"bucket": "30d"}, {"bucket": "60d"}]


# --------------------------------------------------------------------------- #
#  Serialisation                                                               #
# --------------------------------------------------------------------------- #
def _strict_loads(text: str):
    """Parse rejecting the non-standard NaN/Infinity tokens json.dumps emits."""
    def reject(token: str):
        raise AssertionError(f"payload contains the invalid JSON token {token!r}")

    return json.loads(text, parse_constant=reject)


class TestDumps:
    def test_nan_that_escaped_coercion_raises_rather_than_writing_bad_json(self):
        with pytest.raises(ValueError):
            dumps({"x": float("nan")})

    def test_script_tags_cannot_close_an_inlined_block(self):
        hostile = "</script><script>alert(1)</script>"
        text = dumps({"message": hostile})

        assert "</script>" not in text
        assert "<" not in text and ">" not in text and "&" not in text
        # ...and it still round-trips to the original string.
        assert _strict_loads(text)["message"] == hostile

    def test_escapes_are_valid_json_not_mangling(self):
        assert _strict_loads(dumps({"a": "1 < 2 && 3 > 2"}))["a"] == "1 < 2 && 3 > 2"

    def test_line_separators_are_escaped(self):
        """U+2028 is legal in a JSON string but breaks an inlined script."""
        text = dumps({"a": "x y"})
        assert " " not in text
        assert _strict_loads(text)["a"] == "x y"

    def test_write_payload_round_trips(self, tmp_path):
        path = write_payload(tmp_path / "nested" / "p.json", {"schemaVersion": 1})
        assert path.exists()
        assert _strict_loads(path.read_text(encoding="utf-8")) == {"schemaVersion": 1}


# --------------------------------------------------------------------------- #
#  End-to-end payload                                                          #
# --------------------------------------------------------------------------- #
@pytest.fixture(scope="module")
def run(tmp_path_factory):
    """
    One pipeline run, shared by every payload assertion.

    Trimmed the same way as the end-to-end fixture in
    ``test_anomalies_scenarios``: two models and 200 simulation paths, which is
    enough to exercise every payload section without a three-minute test.
    """
    from call_forecast.pipeline import run_pipeline
    from conftest import _synthetic_calls

    root = tmp_path_factory.mktemp("serialize")
    data_dir = root / "data"
    data_dir.mkdir()
    _synthetic_calls(np.random.default_rng(11), days=200).to_csv(
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
    return run_pipeline(cfg, force=True, build_report=False), cfg


@pytest.fixture(scope="module")
def payload(run):
    result, cfg = run
    return build_payload(
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


@pytest.fixture(scope="module")
def parsed(payload):
    """The payload as a consumer receives it: through strict JSON."""
    return _strict_loads(dumps(payload))


class TestPayloadIsValidJSON:
    def test_round_trips_through_strict_json(self, payload):
        """The headline guarantee. No NaN, no numpy, no Timestamps."""
        assert _strict_loads(dumps(payload)) is not None

    def test_nan_dense_columns_became_null_not_dropped(self, parsed):
        """
        ``avg_duration_sec`` is NaN on every zero-call day. The key must still
        be present with a null value — a consumer indexing rows by column
        cannot cope with a key that vanishes on some rows.
        """
        rows = parsed["daily"]
        assert any(r["avg_duration_sec"] is None for r in rows), "expected NaN days"
        assert all("avg_duration_sec" in r for r in rows)

    def test_no_float_in_the_payload_is_non_finite(self, parsed):
        def walk(node):
            if isinstance(node, dict):
                for v in node.values():
                    yield from walk(v)
            elif isinstance(node, list):
                for v in node:
                    yield from walk(v)
            elif isinstance(node, float):
                yield node

        assert all(math.isfinite(v) for v in walk(parsed))


class TestPayloadShape:
    def test_envelope(self, parsed):
        assert parsed["schemaVersion"] == SCHEMA_VERSION
        datetime.fromisoformat(parsed["generatedAt"])
        assert parsed["targets"] == [
            "call_volume", "avg_duration_sec", "total_cost"
        ]

    def test_target_meta_covers_every_target(self, parsed):
        for target in parsed["targets"]:
            meta = parsed["targetMeta"][target]
            assert meta["label"] and meta["aggregate"] in {"sum", "mean"}
        assert parsed["targetMeta"]["avg_duration_sec"]["aggregate"] == "mean"
        assert parsed["targetMeta"]["total_cost"]["aggregate"] == "sum"

    def test_ingestion_carries_what_the_header_renders(self, parsed):
        ingestion = parsed["ingestion"]
        for key in ("rows_kept", "active_days", "calendar_days",
                    "coverage_pct", "date_min", "date_max", "warnings"):
            assert key in ingestion
        assert ingestion["rows_kept"] > 0

    def test_config_carries_what_the_footer_renders(self, parsed):
        config = parsed["config"]
        assert config["forecast"]["interval_level"] == 0.80
        assert config["forecast"]["horizons"] == [30, 60, 90]
        assert config["cv"]["selection_metric"] == "mase"
        assert config["business_hours"]["start_hour"] == 8
        assert config["anomalies"]["cost_overrun_pct"] == 0.20

    def test_config_does_not_leak_filesystem_paths(self, parsed):
        """This payload is destined for a file that gets mailed around."""
        text = json.dumps(parsed["config"])
        assert "paths" not in parsed["config"]
        for leak in ("root", "data_dir", "output_dir", "report_dir", "model_dir"):
            assert leak not in text

    def test_daily_history_is_present_and_dated(self, parsed):
        rows = parsed["daily"]
        assert len(rows) > 100
        assert rows[0]["date"] == "2026-01-01"
        for column in ("call_volume", "avg_duration_sec", "total_cost"):
            assert column in rows[0]

    def test_engineered_features_are_not_shipped(self, parsed):
        """~100 model-input columns; the charts draw the base frame."""
        assert "call_volume_lag_7" not in parsed["daily"][0]


class TestForecastSection:
    def test_every_target_has_a_forecast(self, parsed):
        assert set(parsed["forecasts"]) == {
            "call_volume", "avg_duration_sec", "total_cost"
        }

    def test_daily_rows_carry_the_band_and_the_bucket(self, parsed):
        rows = parsed["forecasts"]["call_volume"]["daily"]
        assert len(rows) == 90
        first = rows[0]
        assert set(first) == {
            "date", "yhat", "yhat_lower", "yhat_upper", "step", "horizon_bucket"
        }
        assert first["step"] == 1
        assert first["horizon_bucket"] == "30d"
        assert rows[-1]["horizon_bucket"] == "90d"

    def test_horizon_rollup_matches_the_result_object(self, run, parsed):
        """
        The roll-up bounds are read off simulated paths and are *not* derivable
        from the daily rows, so they have to be carried explicitly and match.
        """
        result, cfg = run
        forecast = result.forecasts["call_volume"]
        rows = {r["days"]: r for r in parsed["forecasts"]["call_volume"]["horizons"]}

        assert set(rows) == set(cfg.forecast.horizons)
        for days in cfg.forecast.horizons:
            expected = forecast.total(days)
            assert rows[days]["measure"] == "total"
            assert rows[days]["forecast"] == pytest.approx(expected["total"])
            assert rows[days]["lower"] == pytest.approx(expected["lower"])
            assert rows[days]["upper"] == pytest.approx(expected["upper"])

    def test_duration_rolls_up_as_a_mean_not_a_total(self, run, parsed):
        result, _ = run
        rows = {r["days"]: r for r in parsed["forecasts"]["avg_duration_sec"]["horizons"]}
        assert rows[30]["measure"] == "daily average"
        assert rows[30]["forecast"] == pytest.approx(
            result.forecasts["avg_duration_sec"].mean(30)["mean"]
        )

    def test_monthly_keeps_the_partial_flag(self, parsed):
        monthly = parsed["forecasts"]["total_cost"]["monthly"]
        assert monthly
        assert all(isinstance(m["partial_month"], bool) for m in monthly)
        assert any(m["partial_month"] for m in monthly), "90 days must span a partial month"

    def test_model_identity_and_notes(self, run, parsed):
        result, _ = run
        section = parsed["forecasts"]["call_volume"]
        assert section["model"] == result.forecasts["call_volume"].model_name
        assert section["modelLabel"] == result.forecasts["call_volume"].model_label
        assert section["intervalLevel"] == 0.80
        assert isinstance(section["calibrated"], bool)
        assert isinstance(section["notes"], list)

    def test_simulated_paths_are_not_shipped(self, parsed):
        """(200, 90) here, (1000, 90) in production — quantiles are enough."""
        assert "paths" not in parsed["forecasts"]["call_volume"]


class TestEvaluationSection:
    def test_leaderboard_carries_every_reported_metric(self, parsed):
        board = parsed["evaluations"]["call_volume"]["leaderboard"]
        assert board
        for column in ("model", "label", "status", "selected", "n_folds",
                       "mae", "rmse", "r2", "mape", "mape_n", "smape",
                       "mase", "bias"):
            assert column in board[0], f"missing {column}"

    def test_exactly_one_row_is_marked_selected(self, parsed):
        for target, section in parsed["evaluations"].items():
            if section["bestModel"] is None:
                continue
            selected = [r for r in section["leaderboard"] if r["selected"]]
            assert len(selected) == 1, target
            assert selected[0]["model"] == section["bestModel"]

    def test_selection_context_is_present(self, parsed):
        section = parsed["evaluations"]["call_volume"]
        assert section["selectionMetric"] == "mase"
        assert section["nFolds"] >= 2
        assert section["horizon"] == 7


class TestExplanationSection:
    def test_top_features_are_ranked(self, parsed):
        for target, section in parsed["explanations"].items():
            assert section["summary"]
            for row in section["topFeatures"]:
                assert "feature" in row and "rank_mean" in row

    def test_importance_methods_are_optional(self, parsed):
        """shap/permutation/native depend on what was available at explain time."""
        for section in parsed["explanations"].values():
            if not section["topFeatures"]:
                continue
            present = set(section["topFeatures"][0]) & {"shap", "permutation", "native"}
            assert present, "at least one importance method must survive"


class TestHourlySection:
    def test_grid_is_complete(self, parsed):
        hourly = parsed["hourly"]
        assert len(hourly) == 7 * 24
        assert {(h["weekday"], h["hour"]) for h in hourly} == {
            (d, hr) for d in range(7) for hr in range(24)
        }

    def test_counts_total_to_every_ingested_call(self, parsed):
        assert sum(h["calls"] for h in parsed["hourly"]) == parsed["ingestion"]["rows_kept"]

    def test_weekday_labels_are_monday_first(self, parsed):
        labels = {h["weekday"]: h["weekdayLabel"] for h in parsed["hourly"]}
        assert labels[0] == "Mon" and labels[6] == "Sun"


class TestAnomalySection:
    def test_items_carry_the_full_row(self, parsed):
        items = parsed["anomalies"]["items"]
        assert items, "the synthetic data plants an anomaly at day 100"
        for column in ("date", "rule", "metric", "actual", "expected",
                       "deviation", "severity", "message"):
            assert column in items[0]

    def test_counts_match_the_items(self, parsed):
        section = parsed["anomalies"]
        for severity in ("critical", "warning", "info"):
            assert section["counts"][severity] == sum(
                1 for i in section["items"] if i["severity"] == severity
            )

    def test_by_rule_tallies(self, parsed):
        by_rule = parsed["anomalies"]["byRule"]
        assert by_rule
        assert sum(r["count"] for r in by_rule) == len(parsed["anomalies"]["items"])


class TestScenarioSection:
    def test_rows_and_notes(self, parsed):
        section = parsed["scenarios"]
        assert section["rows"]
        assert "scenario" in section["rows"][0]
        assert isinstance(section["notes"], list)


class TestPayloadBudget:
    def test_stays_small_enough_to_inline(self, payload):
        """
        A single-file dashboard inlines this. The current HTML is 5 MB and the
        migration is meant to shrink it, so a payload that quietly grows past a
        couple of MB should fail here rather than in a mailbox.
        """
        size_mb = len(dumps(payload).encode("utf-8")) / 1e6
        assert size_mb < 2.0, f"payload is {size_mb:.2f} MB"


# --------------------------------------------------------------------------- #
#  Degradation                                                                 #
# --------------------------------------------------------------------------- #
class TestPartialRuns:
    """A partial run must still produce a payload a frontend can render."""

    def _empty(self, run, **overrides):
        result, cfg = run
        kwargs = dict(
            calls=result.calls.frame,
            daily=result.daily,
            evaluations={},
            forecasts={},
            anomaly_report=None,
            explanations={},
            scenario_table=pd.DataFrame(),
            scenario_notes=[],
            ingestion_report=result.report,
            cfg=cfg,
        )
        kwargs.update(overrides)
        return _strict_loads(dumps(build_payload(**kwargs)))

    def test_everything_missing_still_serialises(self, run):
        parsed = self._empty(run)
        assert parsed["targets"] == []
        assert parsed["forecasts"] == {}
        assert parsed["evaluations"] == {}
        assert parsed["explanations"] == {}
        assert parsed["scenarios"] == {"rows": [], "notes": []}
        assert parsed["anomalies"]["items"] == []
        assert parsed["anomalies"]["counts"] == {"critical": 0, "warning": 0, "info": 0}
        # The sections that do not depend on modelling are still populated.
        assert parsed["daily"] and parsed["hourly"]

    def test_targets_reflect_only_what_was_produced(self, run):
        result, _ = run
        parsed = self._empty(
            run, forecasts={"total_cost": result.forecasts["total_cost"]}
        )
        assert parsed["targets"] == ["total_cost"]
        assert set(parsed["targetMeta"]) == {"total_cost"}

    def test_no_calls_still_produces_a_full_hourly_grid(self, run):
        parsed = self._empty(run, calls=pd.DataFrame())
        assert len(parsed["hourly"]) == 168
        assert sum(h["calls"] for h in parsed["hourly"]) == 0


# --------------------------------------------------------------------------- #
#  Pipeline integration                                                        #
# --------------------------------------------------------------------------- #
class TestPipelineWritesThePayload:
    def test_payload_is_written_and_recorded(self, run):
        result, _ = run
        assert "dashboard_data" in result.outputs
        path = result.outputs["dashboard_data"]
        assert path.exists() and path.name == "dashboard_data.json"

    def test_written_file_parses_strictly(self, run):
        result, _ = run
        parsed = _strict_loads(
            result.outputs["dashboard_data"].read_text(encoding="utf-8")
        )
        assert parsed["schemaVersion"] == SCHEMA_VERSION

    def test_written_without_the_html_report(self, run):
        """build_report=False on this fixture — the payload is not gated on it."""
        result, _ = run
        assert "dashboard" not in result.outputs
        assert "dashboard_data" in result.outputs
