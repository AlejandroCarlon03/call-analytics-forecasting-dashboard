#!/usr/bin/env python3
"""
call_forecast.models.tabular
============================
Feature-based regressors: linear regression, random forest, gradient boosting.

All three share :class:`~call_forecast.models.base.TabularForecaster`, so they
see identical features and identical recursive multi-step logic; the only
difference between them is the estimator. That is what makes the leaderboard a
fair comparison rather than a comparison of feature pipelines.

Missing-value policy
--------------------
The feature matrix legitimately contains NaN — a 30-day rolling mean has no
value on day 3, and a zero-call day has no average duration. Each model deals
with that in the way appropriate to its family:

* linear regression and random forest impute with the training **median** and
  add a companion missing-indicator column, so "no history yet" stays
  distinguishable from "history happened to equal the median";
* XGBoost keeps the NaNs and learns a default split direction for them, which
  is strictly more expressive, so no imputation is applied.
"""

from __future__ import annotations

import logging

import numpy as np

from ..config import AppConfig
from .base import TabularForecaster

log = logging.getLogger(__name__)

__all__ = [
    "LinearRegressionForecaster",
    "RandomForestForecaster",
    "XGBoostForecaster",
]


def _imputer():
    """Median imputer that also flags which values were missing."""
    from sklearn.impute import SimpleImputer

    return SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True)


# --------------------------------------------------------------------------- #
#  Linear                                                                      #
# --------------------------------------------------------------------------- #
class LinearRegressionForecaster(TabularForecaster):
    """
    Least-squares regression on the engineered features, L2-regularised.

    A note on "linear regression": with roughly as many engineered features as
    there are training days, plain OLS is not merely imprecise — the normal
    equations are near-singular and the fitted coefficients are numerically
    arbitrary. This model therefore uses :class:`~sklearn.linear_model.RidgeCV`,
    which is still a linear model with interpretable coefficients but selects
    its shrinkage by cross-validation. With ``alpha -> 0`` it reduces exactly to
    OLS, so on a comfortably large dataset it behaves the way you would expect
    plain linear regression to behave.

    Features are standardised first so that the single shared penalty is
    applied on a common scale, and so the coefficients are directly comparable
    as importances.
    """

    name = "linear_regression"
    label = "Linear Regression (ridge)"

    def _build_estimator(self):
        from sklearn.linear_model import RidgeCV
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        alphas = np.logspace(-3, 3, 25)
        n_rows = 0 if self.train_target_ is None else len(self.train_target_)
        # RidgeCV's efficient leave-one-out path needs a few rows to be stable.
        cv = None if n_rows >= 20 else 3

        return Pipeline(
            [
                ("impute", _imputer()),
                ("scale", StandardScaler()),
                ("model", RidgeCV(alphas=alphas, cv=cv)),
            ]
        )

    def feature_importance(self):
        """
        Absolute standardised coefficients.

        Because the pipeline scales inputs, coefficient magnitude is directly
        comparable across features. The imputer's missing-indicator columns are
        appended after the named features, so they are trimmed off here to keep
        the index aligned with ``feature_names_``.
        """
        import pandas as pd

        self._check_fitted()
        model = self.estimator_.named_steps["model"]
        coefs = np.abs(np.ravel(model.coef_)).astype(float)
        n = len(self.feature_names_)
        if coefs.size < n:  # pragma: no cover - defensive
            return pd.Series(dtype=float)
        return pd.Series(coefs[:n], index=self.feature_names_).sort_values(ascending=False)


# --------------------------------------------------------------------------- #
#  Random forest                                                               #
# --------------------------------------------------------------------------- #
class RandomForestForecaster(TabularForecaster):
    """
    Bagged regression trees.

    Robust to the outlier days this data is full of, and needs no scaling.
    Its main weakness for forecasting is that trees cannot extrapolate beyond
    the range of the training target — if call volume trends upward past
    anything seen historically, the forest will flatten out. Prophet and SARIMA
    are in the comparison partly to cover that case.
    """

    name = "random_forest"
    label = "Random Forest"

    def _build_estimator(self):
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.pipeline import Pipeline

        params = dict(self.cfg.models.random_forest)
        params.setdefault("random_state", self.cfg.models.random_state)
        return Pipeline(
            [
                ("impute", _imputer()),
                ("model", RandomForestRegressor(**params)),
            ]
        )

    def feature_importance(self):
        import pandas as pd

        self._check_fitted()
        model = self.estimator_.named_steps["model"]
        values = np.asarray(model.feature_importances_, dtype=float)
        n = len(self.feature_names_)
        if values.size < n:  # pragma: no cover - defensive
            return pd.Series(dtype=float)
        return pd.Series(values[:n], index=self.feature_names_).sort_values(ascending=False)


# --------------------------------------------------------------------------- #
#  XGBoost                                                                     #
# --------------------------------------------------------------------------- #
class XGBoostForecaster(TabularForecaster):
    """
    Gradient-boosted trees.

    Handles NaN natively (learning a default branch per split), so the feature
    matrix is passed through unimputed. Shares the forest's inability to
    extrapolate a trend.
    """

    name = "xgboost"
    label = "XGBoost"
    handles_nan = True

    def _build_estimator(self):
        from xgboost import XGBRegressor

        params = dict(self.cfg.models.xgboost)
        params.setdefault("random_state", self.cfg.models.random_state)
        params.setdefault("objective", "reg:squarederror")

        n_rows = 0 if self.train_target_ is None else len(self.train_target_)
        if n_rows < 60 and params.get("n_estimators", 0) > 200:
            # Fewer rounds on very short history; the default 400 rounds at
            # depth 4 will memorise a 40-row training set outright.
            params["n_estimators"] = 200
            log.info(
                "XGBoost: reduced n_estimators to 200 for a %d-row training set.",
                n_rows,
            )
        return XGBRegressor(**params)
