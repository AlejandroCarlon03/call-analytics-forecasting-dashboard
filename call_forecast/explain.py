#!/usr/bin/env python3
"""
call_forecast.explain
=====================
Why the model predicted what it predicted: SHAP values, permutation
importance, and native importances.

Three views, because each answers a different question
------------------------------------------------------
**Native importance** (``feature_importances_`` / coefficients) is free but
biased. Tree impurity importance systematically favours high-cardinality
continuous features over binary ones, so ``is_holiday`` looks unimportant next
to ``call_volume_roll7_mean`` partly because it only takes two values.

**Permutation importance** measures what actually degrades when a feature is
shuffled, so it is comparable across model families and answers "does the
model *need* this?". Its weakness is correlated features: with ``lag_1`` and
``roll7_mean`` both present, shuffling either alone barely hurts, because the
other still carries the signal — so both can look unimportant even though the
pair is essential.

**SHAP** attributes each individual prediction to its features, additively and
with a consistency guarantee. It is the only one of the three that answers
"why *this* Tuesday?" rather than "what matters on average", which is what
makes it the right tool for reviewing a specific forecast day.

Reading these on short history
------------------------------
With a few dozen training rows, importance rankings are unstable — refitting
on one more week can reorder the middle of the list. The top two or three
features are usually robust; the tail is not, and this module reports the
training-row count alongside the rankings so that caveat travels with them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np
import pandas as pd

from .config import AppConfig
from .models import Forecaster, TabularForecaster
from .models.prophet_model import ProphetForecaster
from .models.sarima import SarimaForecaster

log = logging.getLogger(__name__)

__all__ = ["Explanation", "explain_model", "explain_forecast_day"]

try:  # pragma: no cover - optional dependency
    import shap as _shap

    SHAP_AVAILABLE = True
except ImportError:  # pragma: no cover - optional dependency
    _shap = None
    SHAP_AVAILABLE = False


# --------------------------------------------------------------------------- #
#  Container                                                                   #
# --------------------------------------------------------------------------- #
@dataclass
class Explanation:
    """Importance rankings and SHAP output for one fitted model."""

    target: str
    model_name: str
    model_label: str
    method: str
    #: Ranked native importance (may be empty for non-feature models).
    native_importance: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    #: Ranked permutation importance with std, as a DataFrame.
    permutation_importance: pd.DataFrame = field(default_factory=pd.DataFrame)
    #: Mean absolute SHAP value per feature, ranked.
    shap_importance: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    #: Per-row SHAP values for the training window.
    shap_values: pd.DataFrame | None = None
    #: Per-row SHAP values for the forecast horizon.
    shap_future: pd.DataFrame | None = None
    #: Model's average prediction, the baseline SHAP contributions add to.
    expected_value: float = float("nan")
    #: Prophet's additive components, when the winner is Prophet.
    components: pd.DataFrame | None = None
    n_train_rows: int = 0
    notes: list[str] = field(default_factory=list)

    def top_features(self, n: int = 10) -> pd.DataFrame:
        """
        Consolidated ranking across whichever methods were available.

        Values are normalised to sum to 1 within each method so they can sit in
        one table; ``rank_mean`` is the average rank across available methods
        and is what the summary sorts on.
        """
        frames = {}
        if not self.shap_importance.empty:
            frames["shap"] = self.shap_importance
        if not self.permutation_importance.empty:
            frames["permutation"] = self.permutation_importance["importance_mean"]
        if not self.native_importance.empty:
            frames["native"] = self.native_importance

        if not frames:
            return pd.DataFrame(columns=["feature"])

        out = pd.DataFrame(frames)
        for col in out.columns:
            total = out[col].abs().sum()
            if total > 0:
                out[col] = out[col].abs() / total

        ranks = out.rank(ascending=False, na_option="bottom")
        out["rank_mean"] = ranks.mean(axis=1)
        out = out.sort_values("rank_mean").head(n)
        out.index.name = "feature"
        return out.reset_index()

    def summary_text(self, n: int = 5) -> str:
        """Plain-English summary of the drivers, for the report and dashboard."""
        top = self.top_features(n)
        if top.empty:
            return (
                f"No feature-level explanation is available for "
                f"{self.model_label} ({self.method})."
            )
        names = ", ".join(top["feature"].head(n))
        return (
            f"{self.model_label} predicts {self.target} mainly from: {names}. "
            f"Ranking derived from {self.method} over {self.n_train_rows} training rows."
        )


# --------------------------------------------------------------------------- #
#  Helpers                                                                     #
# --------------------------------------------------------------------------- #
def _permutation_importance(
    model: TabularForecaster, cfg: AppConfig, n_repeats: int = 20
) -> pd.DataFrame:
    """
    Permutation importance on the training matrix.

    Computed on training rows rather than a held-out split, because holding
    rows out of an already-short series would make the estimate noisier than
    the bias it removes. That makes this a measure of what the *fitted* model
    relies on, not of generalisation — stated in the returned notes.
    """
    from sklearn.inspection import permutation_importance as _pi

    X, y = model.train_matrix_, model.train_target_
    if X is None or y is None or X.empty:
        return pd.DataFrame()

    try:
        result = _pi(
            model.estimator_, X, y,
            n_repeats=n_repeats,
            random_state=cfg.models.random_state,
            scoring="neg_mean_absolute_error",
        )
    except Exception as exc:  # noqa: BLE001 - diagnostics must not break the run
        log.warning("Permutation importance failed: %s", exc)
        return pd.DataFrame()

    return (
        pd.DataFrame(
            {
                "importance_mean": result.importances_mean,
                "importance_std": result.importances_std,
            },
            index=X.columns,
        )
        .sort_values("importance_mean", ascending=False)
    )


def _shap_for_tabular(
    model: TabularForecaster,
) -> tuple[pd.DataFrame | None, pd.DataFrame | None, float, str, list[str]]:
    """
    Compute SHAP values for a tabular model.

    Returns ``(train_shap, future_shap, expected_value, method, notes)``.

    Tree models use the exact ``TreeExplainer``. Anything else falls back to
    the model-agnostic explainer over a small background sample — correct but
    slow, so it is capped and the cap is reported.
    """
    notes: list[str] = []
    if not SHAP_AVAILABLE:  # pragma: no cover - optional dependency
        return None, None, float("nan"), "unavailable", [
            "SHAP is not installed (`pip install shap`); "
            "falling back to permutation and native importance."
        ]

    X = model.train_matrix_
    if X is None or X.empty:
        return None, None, float("nan"), "unavailable", ["No training matrix retained."]

    estimator = model._final_estimator()
    # Pipelines transform (impute/scale) before the estimator; SHAP must see the
    # same transformed space the estimator was actually fitted on.
    transform = None
    if hasattr(model.estimator_, "steps") and len(model.estimator_.steps) > 1:
        from sklearn.pipeline import Pipeline

        transform = Pipeline(model.estimator_.steps[:-1])

    def prepare(frame: pd.DataFrame) -> np.ndarray:
        values = transform.transform(frame) if transform is not None else frame.to_numpy()
        return np.asarray(values, dtype=float)

    X_prepared = prepare(X)
    # An imputer with add_indicator appends columns; keep names aligned.
    names = list(X.columns)
    if X_prepared.shape[1] > len(names):
        extra = X_prepared.shape[1] - len(names)
        names = names + [f"_missing_indicator_{i}" for i in range(extra)]
        notes.append(
            f"{extra} missing-value indicator column(s) appear in the SHAP "
            "output; they flag where a feature had no value rather than a value."
        )

    try:
        if hasattr(estimator, "feature_importances_"):
            explainer = _shap.TreeExplainer(estimator)
            train_values = explainer.shap_values(X_prepared, check_additivity=False)
            method = "shap.TreeExplainer"
        else:
            background = _shap.utils.sample(
                X_prepared, min(50, len(X_prepared)), random_state=0
            )
            explainer = _shap.Explainer(estimator, background)
            train_values = explainer(X_prepared).values
            method = "shap.Explainer (model-agnostic)"
    except Exception as exc:  # noqa: BLE001 - explanation is best-effort
        log.warning("SHAP failed for %s: %s", model.name, exc)
        return None, None, float("nan"), "failed", [f"SHAP failed: {exc}"]

    train_values = np.asarray(train_values, dtype=float)
    if train_values.ndim == 3:  # (rows, features, outputs) for some versions
        train_values = train_values[..., 0]

    train_shap = pd.DataFrame(train_values, index=X.index, columns=names)

    expected = getattr(explainer, "expected_value", np.nan)
    expected = float(np.ravel(expected)[0]) if np.size(expected) else float("nan")

    # -- the forecast horizon ------------------------------------------------ #
    future_shap = None
    if model.future_matrix_ is not None and not model.future_matrix_.empty:
        try:
            future_prepared = prepare(model.future_matrix_)
            values = (
                explainer.shap_values(future_prepared, check_additivity=False)
                if method.startswith("shap.Tree")
                else explainer(future_prepared).values
            )
            values = np.asarray(values, dtype=float)
            if values.ndim == 3:
                values = values[..., 0]
            future_shap = pd.DataFrame(
                values, index=model.future_matrix_.index, columns=names
            )
        except Exception as exc:  # noqa: BLE001
            notes.append(f"SHAP for the forecast horizon failed: {exc}")

    return train_shap, future_shap, expected, method, notes


# --------------------------------------------------------------------------- #
#  Entry points                                                                #
# --------------------------------------------------------------------------- #
def explain_model(
    model: Forecaster, cfg: AppConfig | None = None, horizon: int = 30
) -> Explanation:
    """
    Produce every available explanation for a fitted model.

    Dispatches on model family: tabular models get SHAP + permutation + native
    importance; Prophet gets its additive component decomposition; SARIMA gets
    its fitted coefficients. Explanation failures are captured in
    ``Explanation.notes`` rather than raised, because a missing SHAP plot must
    never cost you the forecast.

    Parameters
    ----------
    model:
        A **fitted** forecaster.
    cfg:
        Configuration; defaults used when omitted.
    horizon:
        Days of forward explanation to request from Prophet.
    """
    cfg = cfg or AppConfig.default()

    if isinstance(model, TabularForecaster):
        return _explain_tabular(model, cfg)
    if isinstance(model, ProphetForecaster):
        return _explain_prophet(model, horizon)
    if isinstance(model, SarimaForecaster):
        return _explain_sarima(model)

    return Explanation(
        target=model.target, model_name=model.name, model_label=model.label,
        method="none",
        notes=[
            f"{model.label} has no feature-level structure to explain; its "
            "forecast is a direct function of recent same-weekday values."
        ],
    )


def _explain_tabular(model: TabularForecaster, cfg: AppConfig) -> Explanation:
    """SHAP + permutation + native importance for a feature-based model."""
    train_shap, future_shap, expected, method, notes = _shap_for_tabular(model)

    explanation = Explanation(
        target=model.target,
        model_name=model.name,
        model_label=model.label,
        method=method if train_shap is not None else "permutation + native importance",
        native_importance=model.feature_importance(),
        permutation_importance=_permutation_importance(model, cfg),
        shap_values=train_shap,
        shap_future=future_shap,
        expected_value=expected,
        n_train_rows=0 if model.train_target_ is None else len(model.train_target_),
        notes=notes,
    )

    if train_shap is not None:
        explanation.shap_importance = (
            train_shap.abs().mean().sort_values(ascending=False)
        )

    explanation.notes.append(
        "Permutation importance is measured on the training rows, so it "
        "describes what the fitted model relies on rather than how well it "
        "generalises."
    )
    if explanation.n_train_rows < 60:
        explanation.notes.append(
            f"Only {explanation.n_train_rows} training rows: treat the top two "
            "or three features as meaningful and the rest of the ranking as "
            "provisional."
        )
    return explanation


def _explain_prophet(model: ProphetForecaster, horizon: int) -> Explanation:
    """Prophet's additive decomposition is its explanation."""
    explanation = Explanation(
        target=model.target, model_name=model.name, model_label=model.label,
        method="prophet additive components",
        notes=[
            "Prophet is additive: each predicted day is the sum of a trend "
            "term, a weekly-seasonality term and any holiday effect. The "
            "components table shows how many calls (or dollars) each term "
            "contributes per day."
        ],
    )
    try:
        explanation.components = model.components(horizon)
        contribution = explanation.components.abs().mean().sort_values(ascending=False)
        explanation.native_importance = contribution
    except Exception as exc:  # noqa: BLE001
        explanation.notes.append(f"Component decomposition failed: {exc}")
    return explanation


def _explain_sarima(model: SarimaForecaster) -> Explanation:
    """SARIMA coefficients, with their significance."""
    explanation = Explanation(
        target=model.target, model_name=model.name, model_label=model.label,
        method="sarima coefficients",
        notes=[
            f"Fitted specification: {model.spec}. Coefficients describe how "
            "strongly each lagged value and lagged error feeds into the next "
            "prediction; there are no external features to attribute to."
        ],
    )
    try:
        params = model.result_.params
        explanation.native_importance = (
            pd.Series(params).abs().sort_values(ascending=False)
        )
        pvalues = pd.Series(model.result_.pvalues)
        significant = pvalues[pvalues < 0.05]
        if significant.empty:
            explanation.notes.append(
                "No coefficient reaches p < 0.05 - the fitted structure is not "
                "statistically distinguishable from noise on this much history."
            )
        else:
            explanation.notes.append(
                "Significant terms (p < 0.05): "
                + ", ".join(f"{k} ({v:.3f})" for k, v in significant.items())
            )
    except Exception as exc:  # noqa: BLE001
        explanation.notes.append(f"Could not extract coefficients: {exc}")
    return explanation


def explain_forecast_day(
    explanation: Explanation, date, top_n: int = 8
) -> pd.DataFrame:
    """
    Break one forecast day into its per-feature SHAP contributions.

    This is the "why did it predict 7 calls on 12 August?" view: contributions
    are additive and, together with ``Explanation.expected_value``, reconstruct
    the prediction.

    Parameters
    ----------
    explanation:
        Result of :func:`explain_model`, with ``shap_future`` populated.
    date:
        Date within the forecast horizon.
    top_n:
        Number of features to return, ranked by absolute contribution.

    Returns
    -------
    pandas.DataFrame
        Columns ``feature``, ``contribution``, ``direction``. Empty when no
        forward SHAP values are available.
    """
    if explanation.shap_future is None or explanation.shap_future.empty:
        return pd.DataFrame(columns=["feature", "contribution", "direction"])

    key = pd.Timestamp(date)
    if key not in explanation.shap_future.index:
        return pd.DataFrame(columns=["feature", "contribution", "direction"])

    row = explanation.shap_future.loc[key]
    out = (
        row.reindex(row.abs().sort_values(ascending=False).index)
        .head(top_n)
        .rename("contribution")
        .reset_index()
        .rename(columns={"index": "feature"})
    )
    out["direction"] = np.where(out["contribution"] >= 0, "increases", "decreases")
    return out
