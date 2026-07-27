"""Model fitting, recursive multi-step forecasting, and interval coherence."""

from __future__ import annotations

import dataclasses

import numpy as np
import pandas as pd
import pytest

from call_forecast.config import AppConfig, CVConfig, ForecastConfig
from call_forecast.evaluation import evaluate_models
from call_forecast.forecast import generate_forecast, monthly_summary
from call_forecast.models import (
    NotEnoughDataError,
    RandomForestForecaster,
    SeasonalNaiveForecaster,
    build_models,
)


@pytest.fixture
def fast_cfg():
    base = AppConfig.default()
    return dataclasses.replace(
        base,
        models=dataclasses.replace(
            base.models, enabled=("seasonal_naive", "linear_regression", "random_forest")
        ),
        cv=CVConfig(initial_train_days=120, horizon=7, step=21, min_folds=2),
        forecast=dataclasses.replace(base.forecast, n_simulations=300),
    )


class TestForecasterContract:
    @pytest.mark.parametrize(
        "name", ["seasonal_naive", "linear_regression", "random_forest", "xgboost"]
    )
    def test_every_model_fits_and_predicts_the_right_shape(self, daily, name):
        model = build_models("call_volume", names=[name])[name]
        model.fit(daily)
        forecast = model.predict(30)

        assert list(forecast.columns) == ["yhat", "yhat_lower", "yhat_upper"]
        assert len(forecast) == 30
        assert forecast.index[0] == daily.index.max() + pd.Timedelta(days=1)
        assert forecast["yhat"].notna().all()

    @pytest.mark.parametrize("name", ["seasonal_naive", "random_forest"])
    def test_interval_contains_the_point_forecast(self, daily, name):
        model = build_models("call_volume", names=[name])[name]
        model.fit(daily)
        forecast = model.predict(30)

        assert (forecast["yhat_lower"] <= forecast["yhat"]).all()
        assert (forecast["yhat"] <= forecast["yhat_upper"]).all()

    def test_non_negative_targets_never_go_negative(self, daily):
        model = RandomForestForecaster("call_volume")
        model.fit(daily)
        forecast = model.predict(60)
        assert (forecast[["yhat", "yhat_lower", "yhat_upper"]] >= 0).all().all()

    def test_call_volume_is_rounded_to_whole_calls(self, daily):
        model = RandomForestForecaster("call_volume")
        model.fit(daily)
        yhat = model.predict(10)["yhat"]
        assert np.allclose(yhat, yhat.round())

    def test_predicting_before_fitting_raises(self, daily):
        with pytest.raises(RuntimeError, match="must be fitted"):
            RandomForestForecaster("call_volume").predict(10)

    def test_too_little_history_raises_not_enough_data(self, daily):
        with pytest.raises(NotEnoughDataError):
            RandomForestForecaster("call_volume").fit(daily.head(5))

    def test_unknown_target_raises(self, daily):
        with pytest.raises(ValueError, match="not present"):
            RandomForestForecaster("nonexistent").fit(daily)


class TestRecursiveForecasting:
    def test_horizons_are_nested_slices_of_one_forecast(self, daily):
        """The first 30 days of a 90-day forecast must *be* the 30-day forecast."""
        model = RandomForestForecaster("call_volume")
        model.fit(daily)
        short = model.predict(30)
        long = model.predict(90)
        pd.testing.assert_frame_equal(short, long.head(30))

    def test_forecast_is_deterministic(self, daily):
        first = RandomForestForecaster("call_volume").fit(daily).predict(30)
        second = RandomForestForecaster("call_volume").fit(daily).predict(30)
        pd.testing.assert_frame_equal(first, second)

    def test_future_feature_matrix_is_retained_for_explanation(self, daily):
        model = RandomForestForecaster("call_volume")
        model.fit(daily)
        model.predict(30)
        assert model.future_matrix_ is not None
        assert len(model.future_matrix_) == 30
        assert list(model.future_matrix_.columns) == model.feature_names_

    def test_intervals_widen_with_horizon(self, daily, fast_cfg):
        """A day-90 forecast is less certain than a day-1 forecast."""
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(daily, "call_volume", evaluation, fast_cfg)
        width = result.daily["yhat_upper"] - result.daily["yhat_lower"]
        assert width.tail(30).mean() > width.head(30).mean()


class TestSeasonalNaive:
    def test_repeats_the_weekly_profile(self, daily):
        model = SeasonalNaiveForecaster("call_volume")
        model.fit(daily)
        forecast = model.predict(14)
        # Two consecutive weeks of a weekly-seasonal forecast are identical.
        np.testing.assert_allclose(
            forecast["yhat"].to_numpy()[:7], forecast["yhat"].to_numpy()[7:14]
        )

    def test_weekend_forecast_is_below_weekday_forecast(self, daily):
        """The synthetic data has ~10 weekday calls and ~2 at weekends."""
        model = SeasonalNaiveForecaster("call_volume")
        model.fit(daily)
        forecast = model.predict(14)
        weekend = forecast.loc[forecast.index.dayofweek >= 5, "yhat"].mean()
        weekday = forecast.loc[forecast.index.dayofweek < 5, "yhat"].mean()
        assert weekend < weekday


class TestGenerateForecast:
    def test_produces_daily_and_monthly_views(self, daily, fast_cfg):
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(daily, "call_volume", evaluation, fast_cfg)

        assert len(result.daily) == max(fast_cfg.forecast.horizons)
        assert not result.monthly.empty
        assert result.model_name == evaluation.best_model
        assert result.calibrated

    def test_horizon_buckets_label_every_row(self, daily, fast_cfg):
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(daily, "call_volume", evaluation, fast_cfg)
        assert result.daily["horizon_bucket"].notna().all()
        assert set(result.daily["horizon_bucket"].unique()) <= {"30d", "60d", "90d"}

    def test_aggregate_interval_contains_the_aggregate_point(self, daily, fast_cfg):
        """
        The bug this guards against: bootstrapping *uncentred* residuals from a
        biased model shifts every simulated path, and over a 30-day sum the
        interval drifts clear of its own point forecast.
        """
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(daily, "call_volume", evaluation, fast_cfg)

        for days in (30, 60, 90):
            totals = result.total(days)
            assert totals["lower"] <= totals["total"] <= totals["upper"], (
                f"{days}d interval {totals} does not contain its point forecast"
            )

    def test_monthly_interval_contains_the_monthly_point(self, daily, fast_cfg):
        evaluation = evaluate_models(daily, "total_cost", fast_cfg)
        result = generate_forecast(daily, "total_cost", evaluation, fast_cfg)
        monthly = result.monthly
        assert (monthly["yhat_lower"] <= monthly["yhat"]).all()
        assert (monthly["yhat"] <= monthly["yhat_upper"]).all()

    def test_simulated_paths_have_the_configured_shape(self, daily, fast_cfg):
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(daily, "call_volume", evaluation, fast_cfg)
        assert result.paths.shape == (
            fast_cfg.forecast.n_simulations, max(fast_cfg.forecast.horizons)
        )

    def test_simulated_paths_are_non_negative_and_unbiased(self, daily, fast_cfg):
        """
        Guards the zero-clipping bias.

        Truncating a symmetric residual distribution at zero moves mass upward.
        The effect grows with the residual scale, and the scale grows with
        horizon, so left unrepaired the far end of a 90-day simulation drifts
        well above its own point forecast.
        """
        evaluation = evaluate_models(daily, "total_cost", fast_cfg)
        result = generate_forecast(daily, "total_cost", evaluation, fast_cfg)

        assert (result.paths >= 0).all(), "non-negative target produced negative paths"

        point = result.daily["yhat"].to_numpy(dtype=float)
        simulated_mean = result.paths.mean(axis=0)
        # Compare the far end of the horizon, where the bias concentrates.
        np.testing.assert_allclose(simulated_mean[-30:], point[-30:], rtol=0.02)

    def test_forcing_a_model_overrides_selection(self, daily, fast_cfg):
        evaluation = evaluate_models(daily, "call_volume", fast_cfg)
        result = generate_forecast(
            daily, "call_volume", evaluation, fast_cfg, model_name="seasonal_naive"
        )
        assert result.model_name == "seasonal_naive"


class TestMonthlySummary:
    def test_sums_additive_targets_and_averages_rate_targets(self):
        index = pd.date_range("2026-03-01", periods=62, freq="D", name="date")
        frame = pd.DataFrame(
            {"yhat": 2.0, "yhat_lower": 1.0, "yhat_upper": 3.0}, index=index
        )

        summed = monthly_summary(frame, None, "total_cost", 0.8, "sum")
        march = summed.loc[summed["month"] == "2026-03"].iloc[0]
        assert march["yhat"] == pytest.approx(62.0)      # 31 days x 2.0

        averaged = monthly_summary(frame, None, "avg_duration_sec", 0.8, "mean")
        assert averaged.iloc[0]["yhat"] == pytest.approx(2.0)

    def test_flags_partial_months(self):
        index = pd.date_range("2026-03-15", periods=20, freq="D", name="date")
        frame = pd.DataFrame(
            {"yhat": 1.0, "yhat_lower": 0.0, "yhat_upper": 2.0}, index=index
        )
        result = monthly_summary(frame, None, "total_cost", 0.8, "sum")
        assert result.iloc[0]["partial_month"]
        assert result.iloc[0]["days_forecast"] == 17     # 15th-31st March

    def test_rejects_an_unknown_aggregate(self):
        index = pd.date_range("2026-03-01", periods=5, freq="D")
        frame = pd.DataFrame({"yhat": 1.0, "yhat_lower": 0.0, "yhat_upper": 2.0}, index=index)
        with pytest.raises(ValueError, match="sum.*mean"):
            monthly_summary(frame, None, "total_cost", 0.8, "median")
