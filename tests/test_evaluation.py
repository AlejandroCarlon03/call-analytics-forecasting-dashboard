"""Metrics, walk-forward splitting, and model selection."""

from __future__ import annotations

import dataclasses
import math

import numpy as np
import pytest

from call_forecast.config import AppConfig, CVConfig
from call_forecast.evaluation import (
    bias,
    compute_metrics,
    evaluate_models,
    mae,
    mape,
    mase,
    r2,
    rmse,
    rolling_origin_splits,
    smape,
)


class TestMetrics:
    def test_perfect_forecast_scores_zero_error(self):
        y = [1.0, 2.0, 3.0, 4.0]
        assert mae(y, y) == 0.0
        assert rmse(y, y) == 0.0
        assert smape(y, y) == 0.0
        assert r2(y, y) == pytest.approx(1.0)

    def test_mae_and_rmse_known_values(self):
        y_true, y_pred = [0.0, 0.0, 0.0], [1.0, 2.0, 3.0]
        assert mae(y_true, y_pred) == pytest.approx(2.0)
        assert rmse(y_true, y_pred) == pytest.approx(math.sqrt(14 / 3))

    def test_rmse_penalises_a_single_large_miss_more_than_mae(self):
        y_true = [10.0] * 10
        spread = [11.0] * 10
        concentrated = [10.0] * 9 + [20.0]
        assert mae(y_true, spread) == pytest.approx(mae(y_true, concentrated))
        assert rmse(y_true, concentrated) > rmse(y_true, spread)

    def test_mape_excludes_zero_actuals_and_reports_the_count(self):
        value, n = mape([0.0, 100.0, 200.0], [10.0, 110.0, 180.0])
        assert n == 2
        assert value == pytest.approx(10.0)

    def test_mape_is_nan_when_every_actual_is_zero(self):
        value, n = mape([0.0, 0.0], [1.0, 2.0])
        assert math.isnan(value) and n == 0

    def test_smape_is_defined_at_zero(self):
        assert np.isfinite(smape([0.0, 10.0], [1.0, 9.0]))

    def test_smape_treats_zero_versus_zero_as_perfect(self):
        assert smape([0.0, 0.0], [0.0, 0.0]) == 0.0

    def test_mase_below_one_beats_the_seasonal_benchmark(self):
        # A training series alternating hard week to week makes the seasonal
        # naive benchmark bad, so an accurate forecast scores well below 1.
        insample = np.tile([0.0, 20.0], 20)
        assert mase([10.0] * 5, [10.0] * 5, insample, season=7) < 1.0

    def test_mase_is_nan_for_a_constant_training_series(self):
        assert math.isnan(mase([1.0, 2.0], [1.0, 2.0], np.ones(50), season=7))

    def test_r2_is_nan_for_constant_actuals(self):
        assert math.isnan(r2([5.0, 5.0, 5.0], [4.0, 5.0, 6.0]))

    def test_r2_goes_negative_when_worse_than_the_mean(self):
        assert r2([1.0, 2.0, 3.0], [100.0, 200.0, 300.0]) < 0

    def test_bias_sign_indicates_direction(self):
        assert bias([10.0, 10.0], [8.0, 8.0]) > 0     # under-forecast
        assert bias([10.0, 10.0], [12.0, 12.0]) < 0   # over-forecast

    def test_nan_positions_are_ignored_pairwise(self):
        assert mae([1.0, np.nan, 3.0], [1.0, 100.0, 3.0]) == 0.0

    def test_mismatched_lengths_raise(self):
        with pytest.raises(ValueError, match="Shape mismatch"):
            mae([1.0, 2.0], [1.0])

    def test_compute_metrics_returns_every_key(self):
        result = compute_metrics([1.0, 2.0, 3.0], [1.1, 2.1, 2.9], insample=np.arange(50.0))
        for key in ("mae", "rmse", "r2", "mape", "mape_n", "smape", "mase", "bias", "n"):
            assert key in result


class TestRollingOriginSplits:
    def test_splits_are_expanding_and_forward_only(self):
        import pandas as pd

        cfg = dataclasses.replace(
            AppConfig.default(),
            cv=CVConfig(initial_train_days=10, horizon=5, step=5, min_folds=1),
        )
        index = pd.date_range("2026-01-01", periods=25, freq="D")
        splits = rolling_origin_splits(index, cfg)

        assert splits == [(10, 15), (15, 20), (20, 25)]
        for train_end, test_end in splits:
            assert test_end > train_end                 # test is strictly after train
            assert test_end - train_end == 5            # horizon respected

    def test_shrinks_the_initial_window_to_reach_min_folds(self):
        import pandas as pd

        cfg = dataclasses.replace(
            AppConfig.default(),
            cv=CVConfig(initial_train_days=60, horizon=7, step=7, min_folds=2),
        )
        index = pd.date_range("2026-01-01", periods=45, freq="D")
        splits = rolling_origin_splits(index, cfg)
        assert len(splits) >= 2

    def test_returns_empty_when_history_is_too_short(self):
        import pandas as pd

        cfg = dataclasses.replace(
            AppConfig.default(),
            cv=CVConfig(initial_train_days=30, horizon=7, step=7, min_folds=1),
        )
        assert rolling_origin_splits(pd.date_range("2026-01-01", periods=10), cfg) == []


@pytest.fixture(scope="module")
def fast_cfg():
    """Only the cheap models, so the suite stays quick."""
    base = AppConfig.default()
    return dataclasses.replace(
        base,
        models=dataclasses.replace(
            base.models,
            enabled=("seasonal_naive", "linear_regression", "random_forest"),
        ),
        cv=CVConfig(initial_train_days=120, horizon=7, step=21, min_folds=2),
    )


class TestEvaluateModels:
    def test_produces_a_leaderboard_and_picks_a_winner(self, daily, fast_cfg):
        result = evaluate_models(daily, "call_volume", fast_cfg)
        assert not result.leaderboard.empty
        assert result.best_model in result.evaluations
        assert result.n_folds >= 2

    def test_leaderboard_is_sorted_by_the_selection_metric(self, daily, fast_cfg):
        result = evaluate_models(daily, "call_volume", fast_cfg)
        ok = result.leaderboard.loc[result.leaderboard["status"] == "ok"]
        values = ok[result.selection_metric].dropna()
        assert list(values) == sorted(values)

    def test_winner_is_the_top_scoring_usable_row(self, daily, fast_cfg):
        result = evaluate_models(daily, "call_volume", fast_cfg)
        ok = result.leaderboard.loc[result.leaderboard["status"] == "ok"]
        assert result.best_model == ok.iloc[0]["model"]

    def test_residuals_are_grouped_by_horizon_step(self, daily, fast_cfg):
        result = evaluate_models(daily, "call_volume", fast_cfg)
        evaluation = result.evaluations[result.best_model]
        assert set(evaluation.residuals_by_step) <= set(range(1, fast_cfg.cv.horizon + 1))
        assert all(v.size > 0 for v in evaluation.residuals_by_step.values())

    def test_a_model_that_cannot_fit_is_skipped_not_fatal(self, daily, fast_cfg):
        """One broken model must not take the whole comparison down."""
        cfg = dataclasses.replace(
            fast_cfg,
            models=dataclasses.replace(
                fast_cfg.models,
                enabled=("seasonal_naive", "random_forest"),
                # Impossible requirement: random_forest can never satisfy it.
                min_observations={"seasonal_naive": 14, "random_forest": 10_000},
            ),
        )
        result = evaluate_models(daily, "call_volume", cfg)
        statuses = dict(zip(result.leaderboard["model"], result.leaderboard["status"]))
        assert statuses["random_forest"] == "skipped"
        assert statuses["seasonal_naive"] == "ok"
        assert result.best_model == "seasonal_naive"

    def test_short_history_yields_no_folds_and_no_winner(self, daily, fast_cfg):
        result = evaluate_models(daily.head(12), "call_volume", fast_cfg)
        assert result.best_model is None
        assert result.notes
