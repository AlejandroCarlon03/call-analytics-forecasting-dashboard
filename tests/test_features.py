"""
Feature engineering, with the leakage checks as the centrepiece.

A forecasting bug that leaks the future produces excellent backtest numbers and
useless forecasts, and it is invisible unless something asserts against it.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from call_forecast.features import build_daily, engineer, extend_calendar


class TestBuildDaily:
    def test_indexed_by_contiguous_days(self, daily):
        assert isinstance(daily.index, pd.DatetimeIndex)
        assert daily.index.is_monotonic_increasing
        gaps = daily.index.to_series().diff().dropna().unique()
        assert list(gaps) == [pd.Timedelta(days=1)]

    def test_zero_call_days_are_inserted_as_zero_volume(self, calls, cfg):
        frame = calls.frame
        # Remove a day from the middle, then confirm it comes back as a zero.
        victim = frame["ts"].dt.normalize().unique()[10]
        thinned = frame.loc[frame["ts"].dt.normalize() != victim]

        rebuilt = build_daily(thinned, cfg)
        assert victim in rebuilt.index
        assert rebuilt.loc[victim, "call_volume"] == 0

    def test_duration_is_nan_not_zero_on_zero_call_days(self, calls, cfg):
        """
        The average duration of zero calls is undefined, not zero.

        Recording it as 0 would drag every duration model toward zero on the
        43% of days that have no calls.
        """
        frame = calls.frame
        victim = frame["ts"].dt.normalize().unique()[10]
        thinned = frame.loc[frame["ts"].dt.normalize() != victim]

        rebuilt = build_daily(thinned, cfg)
        assert rebuilt.loc[victim, "call_volume"] == 0
        assert np.isnan(rebuilt.loc[victim, "avg_duration_sec"])
        assert rebuilt.loc[victim, "total_cost"] == 0

    def test_volume_matches_source_row_count(self, calls, daily):
        assert daily["call_volume"].sum() == len(calls.frame)

    def test_cost_matches_source_total(self, calls, daily):
        assert daily["total_cost"].sum() == pytest.approx(calls.frame["cost"].sum())

    def test_business_and_after_hours_partition_the_day(self, daily):
        combined = daily["business_hours_calls"] + daily["after_hours_calls"]
        assert (combined == daily["call_volume"]).all()

    def test_ratios_stay_within_bounds(self, daily):
        for column in ("missed_call_pct", "business_hours_share", "success_rate"):
            values = daily[column].dropna()
            assert values.between(0.0, 1.0).all(), f"{column} escaped [0, 1]"


class TestLeakage:
    """Every autoregressive feature must be blind to its own day."""

    def test_lag_1_equals_previous_days_actual(self, daily, cfg):
        frame, _ = engineer(daily, cfg)
        expected = daily["call_volume"].shift(1)
        pd.testing.assert_series_equal(
            frame["call_volume_lag_1"], expected, check_names=False
        )

    def test_rolling_mean_excludes_the_current_day(self, daily, cfg):
        frame, _ = engineer(daily, cfg)
        # A 7-day rolling mean on day t must equal the mean of days t-7..t-1.
        for position in (40, 80, 120):
            date = frame.index[position]
            window = daily["call_volume"].iloc[position - 7: position]
            assert frame.loc[date, "call_volume_roll7_mean"] == pytest.approx(window.mean())

    def test_spiking_one_day_does_not_change_that_days_features(self, daily, cfg):
        """
        The decisive leakage test.

        Multiply one day's target by 50. If any feature *for that same day*
        moves, the model can see its own answer.
        """
        base_frame, spec = engineer(daily, cfg)
        target_day = daily.index[100]

        tampered = daily.copy()
        tampered.loc[target_day, "call_volume"] *= 50
        tampered_frame, _ = engineer(tampered, cfg)

        features = spec.for_target("call_volume")
        before = base_frame.loc[target_day, features]
        after = tampered_frame.loc[target_day, features]

        pd.testing.assert_series_equal(before, after, check_names=False)

    def test_spiking_a_day_does_change_the_next_days_features(self, daily, cfg):
        """The mirror of the above: yesterday *should* be visible today."""
        base_frame, _ = engineer(daily, cfg)
        target_day = daily.index[100]
        next_day = daily.index[101]

        tampered = daily.copy()
        tampered.loc[target_day, "call_volume"] *= 50
        tampered_frame, _ = engineer(tampered, cfg)

        assert (
            tampered_frame.loc[next_day, "call_volume_lag_1"]
            != base_frame.loc[next_day, "call_volume_lag_1"]
        )

    def test_weekday_norm_uses_only_prior_weeks(self, daily, cfg):
        frame, _ = engineer(daily, cfg)
        column = "call_volume_weekday_norm"
        for position in (60, 90):
            date = frame.index[position]
            same_weekday = daily["call_volume"].iloc[:position]
            same_weekday = same_weekday[same_weekday.index.dayofweek == date.dayofweek]
            if same_weekday.empty:
                continue
            assert frame.loc[date, column] == pytest.approx(same_weekday.mean())

    def test_exogenous_features_are_shifted(self, daily, cfg):
        """
        Exogenous columns describe observed calls, so they cannot describe the
        day being predicted.
        """
        frame, spec = engineer(daily, cfg)
        assert all(name.endswith("_prev") for name in spec.exogenous)

        raw = daily["cost_per_minute"]
        engineered = frame["cost_per_minute_prev"]
        # Where both the shifted source and the feature are present, they match.
        overlap = raw.shift(1).notna() & engineered.notna()
        aligned = (raw.shift(1)[overlap] - engineered[overlap]).abs()
        assert (aligned < 1e-9).all()


class TestFeatureSpec:
    def test_requested_features_are_all_built(self, daily, cfg):
        frame, spec = engineer(daily, cfg)
        required = [
            "day_of_week", "week_of_year", "month", "is_holiday",
            "call_volume_lag_1", "call_volume_roll7_mean", "call_volume_roll30_mean",
            "cost_per_minute_prev", "missed_call_pct_prev",
            "avg_duration_sec_weekday_norm", "after_hours_share_prev",
        ]
        missing = [name for name in required if name not in frame.columns]
        assert not missing, f"missing engineered features: {missing}"

    def test_other_targets_lags_are_excluded_from_a_targets_features(self, daily, cfg):
        """
        Tomorrow's cost is not known when forecasting tomorrow's volume.

        Including another target's lag block would leak a value that is
        unavailable at any horizon beyond one day.
        """
        _, spec = engineer(daily, cfg)
        volume_features = spec.for_target("call_volume")
        assert not any(name.startswith("total_cost_lag") for name in volume_features)
        assert not any(name.startswith("avg_duration_sec_lag") for name in volume_features)

    def test_constant_columns_are_dropped(self, daily, cfg):
        constant = daily.copy()
        constant["cost_per_minute"] = 1.0
        _, spec = engineer(constant, cfg)
        assert "cost_per_minute_prev" in spec.dropped
        assert "cost_per_minute_prev" not in spec.exogenous

    def test_engineer_is_pure(self, daily, cfg):
        """Same input, same output — the recursive forecaster relies on this."""
        first, _ = engineer(daily, cfg)
        second, _ = engineer(daily, cfg)
        pd.testing.assert_frame_equal(first, second)

    def test_engineer_does_not_mutate_its_input(self, daily, cfg):
        snapshot = daily.copy()
        engineer(daily, cfg)
        pd.testing.assert_frame_equal(daily, snapshot)


class TestExtendCalendar:
    def test_appends_the_right_number_of_future_days(self, daily):
        extended = extend_calendar(daily, 30)
        assert len(extended) == len(daily) + 30
        assert extended.index[-1] == daily.index[-1] + pd.Timedelta(days=30)

    def test_future_targets_are_nan(self, daily):
        extended = extend_calendar(daily, 5)
        assert extended["call_volume"].tail(5).isna().all()

    def test_zero_horizon_is_a_copy(self, daily):
        pd.testing.assert_frame_equal(extend_calendar(daily, 0), daily)
