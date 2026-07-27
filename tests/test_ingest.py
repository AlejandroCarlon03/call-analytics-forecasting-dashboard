"""Ingestion: value parsing, validation, de-duplication."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from call_forecast.ingest import (
    fingerprint_files,
    load_call_files,
    parse_currency,
    parse_duration_to_seconds,
)


class TestParseDuration:
    @pytest.mark.parametrize(
        "value, expected",
        [
            ("1:48", 108.0),
            ("0:00", 0.0),
            ("10:30", 630.0),
            ("1:02:03", 3723.0),
            (95, 95.0),
            ("95", 95.0),
            (dt.timedelta(minutes=2, seconds=5), 125.0),
        ],
    )
    def test_parses_known_shapes(self, value, expected):
        assert parse_duration_to_seconds(value) == pytest.approx(expected)

    @pytest.mark.parametrize("value", ["", None, np.nan, "abc", "-", "1:2:3:4"])
    def test_unparseable_becomes_nan(self, value):
        assert np.isnan(parse_duration_to_seconds(value))

    def test_excel_time_object_reads_as_minutes_seconds(self):
        """Excel widens "1:48" into a time value; minutes land in `hour`."""
        assert parse_duration_to_seconds(dt.time(1, 48)) == pytest.approx(108.0)


class TestParseCurrency:
    @pytest.mark.parametrize(
        "value, expected",
        [("$0.039", 0.039), ("1,234.50", 1234.5), ("$1,000", 1000.0), (2.5, 2.5), ("-0.5", -0.5)],
    )
    def test_parses_currency(self, value, expected):
        assert parse_currency(value) == pytest.approx(expected)

    @pytest.mark.parametrize("value", ["", None, "n/a"])
    def test_blank_becomes_nan(self, value):
        assert np.isnan(parse_currency(value))


class TestLoading:
    def test_canonical_columns_present(self, calls):
        expected = {
            "ts", "duration_sec", "cost", "disconnection_reason", "call_status",
            "sentiment", "successful", "latency_ms", "direction", "connected",
            "missed", "source_file",
        }
        assert expected <= set(calls.frame.columns)

    def test_sorted_by_timestamp(self, calls):
        assert calls.frame["ts"].is_monotonic_increasing

    def test_report_counts_reconcile(self, calls):
        report = calls.report
        assert report.rows_kept == len(calls.frame)
        assert report.rows_kept <= report.rows_read
        assert report.active_days <= report.calendar_days

    def test_missing_is_inverse_of_connected(self, calls):
        frame = calls.frame
        assert (frame["missed"] == ~frame["connected"]).all()

    def test_zero_duration_counts_as_missed(self, cfg, tmp_path):
        """A 0-second "ended" call is a caller who hung up during pickup."""
        path = tmp_path / "zero.csv"
        pd.DataFrame(
            {
                "Time": ["01/05/2026 09:00", "01/05/2026 09:05"],
                "Call Duration": ["0:00", "1:30"],
                "Cost": ["$0.003", "$0.270"],
                "Call Status": ["ended", "ended"],
            }
        ).to_csv(path, index=False)

        frame = load_call_files([path], cfg).frame
        assert frame["missed"].tolist() == [True, False]

    def test_blank_cost_becomes_zero_not_nan(self, cfg, tmp_path):
        """A blank cost on a real export means "no charge", not "unknown"."""
        path = tmp_path / "blank_cost.csv"
        pd.DataFrame(
            {"Time": ["01/05/2026 09:00"], "Call Duration": ["0:10"], "Cost": [""]}
        ).to_csv(path, index=False)

        assert load_call_files([path], cfg).frame["cost"].iloc[0] == 0.0

    def test_missing_timestamp_column_raises(self, cfg, tmp_path):
        path = tmp_path / "bad.csv"
        pd.DataFrame({"Duration": ["1:00"], "Cost": ["$1"]}).to_csv(path, index=False)

        with pytest.raises(ValueError, match="No timestamp column"):
            load_call_files([path], cfg)

    def test_implausible_values_are_dropped_not_kept(self, cfg, tmp_path):
        path = tmp_path / "outliers.csv"
        pd.DataFrame(
            {
                "Time": ["01/05/2026 09:00", "01/05/2026 10:00"],
                "Call Duration": ["99:00:00", "1:30"],   # 99h is not a real call
                "Cost": ["$0.10", "$0.27"],
                "Call Status": ["ended", "ended"],
            }
        ).to_csv(path, index=False)

        records = load_call_files([path], cfg)
        assert np.isnan(records.frame["duration_sec"].iloc[0])
        assert "implausible duration" in records.report.dropped


class TestDeduplication:
    def test_overlapping_exports_deduplicate(self, cfg, tmp_path):
        """The same call appearing in two exports is counted once."""
        rows = pd.DataFrame(
            {
                "Time": ["01/05/2026 09:00", "01/05/2026 09:05"],
                "Call Duration": ["0:30", "1:30"],
                "Cost": ["$0.09", "$0.27"],
                "Call Status": ["ended", "ended"],
            }
        )
        first, second = tmp_path / "a.csv", tmp_path / "b.csv"
        rows.to_csv(first, index=False)
        rows.to_csv(second, index=False)

        records = load_call_files([first, second], cfg)
        assert len(records.frame) == 2
        assert records.report.dropped.get("duplicate rows (overlapping exports)") == 2

    def test_distinct_calls_in_the_same_minute_are_kept(self, cfg, tmp_path):
        """
        Two failed attempts in one minute look identical at minute resolution.

        They are separate calls and must both survive; only cross-file repeats
        are duplicates.
        """
        path = tmp_path / "same_minute.csv"
        pd.DataFrame(
            {
                "Time": ["01/05/2026 07:52", "01/05/2026 07:52"],
                "Call Duration": ["", ""],
                "Cost": ["$0.000", "$0.000"],
                "Call Status": ["ended", "ended"],
            }
        ).to_csv(path, index=False)

        assert len(load_call_files([path], cfg).frame) == 2

    def test_same_minute_rows_still_dedupe_across_files(self, cfg, tmp_path):
        rows = pd.DataFrame(
            {
                "Time": ["01/05/2026 07:52", "01/05/2026 07:52"],
                "Call Duration": ["", ""],
                "Cost": ["$0.000", "$0.000"],
                "Call Status": ["ended", "ended"],
            }
        )
        first, second = tmp_path / "a.csv", tmp_path / "b.csv"
        rows.to_csv(first, index=False)
        rows.to_csv(second, index=False)

        assert len(load_call_files([first, second], cfg).frame) == 2


class TestFingerprint:
    def test_identical_content_hashes_equal(self, tmp_path):
        a, b = tmp_path / "a.csv", tmp_path / "b.csv"
        a.write_text("x,y\n1,2\n")
        b.write_text("x,y\n1,2\n")
        assert fingerprint_files([a]) == fingerprint_files([b])

    def test_changed_content_changes_hash(self, tmp_path):
        path = tmp_path / "a.csv"
        path.write_text("x,y\n1,2\n")
        before = fingerprint_files([path])
        path.write_text("x,y\n1,3\n")
        assert fingerprint_files([path]) != before

    def test_hash_is_order_independent(self, tmp_path):
        a, b = tmp_path / "a.csv", tmp_path / "b.csv"
        a.write_text("1")
        b.write_text("2")
        assert fingerprint_files([a, b]) == fingerprint_files([b, a])
