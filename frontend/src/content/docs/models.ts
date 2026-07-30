import type { DocPage } from '../../lib/docs/types';

/**
 * One `modelCard` per name in `call_forecast/models/registry.py`'s `REGISTRY`
 * (six models, not the three the brief used as illustrative examples). Each
 * card is grounded in that model's own module docstring and implementation:
 * `models/baseline.py`, `models/tabular.py` (ridge / random forest / xgboost),
 * `models/prophet_model.py`, `models/sarima.py`, plus the shared machinery in
 * `models/base.py` and the defaults in `config.yaml`.
 */
export const models: DocPage = {
  id: 'models',
  title: 'Forecasting models',
  summary: 'The six models cross-validated on every target, what each one is good and bad at, and when it wins.',
  blocks: [
    {
      kind: 'paragraph',
      text:
        'Every model below is fit on the same daily history and forecasts the same three targets — call ' +
        'volume, average call duration and total cost. A model is skipped, rather than fitted on too ' +
        'little data, when the target has fewer observations than its configured minimum. On the current ' +
        'shipped defaults those floors are 14 days for seasonal naive, 28 for SARIMA, and 30 for the other four.',
    },
    {
      kind: 'callout',
      tone: 'info',
      title: 'Prophet is optional',
      text:
        'Prophet requires a working Stan toolchain and is not a required dependency. If it is not ' +
        'installed, it is filtered out of the comparison with a logged warning, and the run proceeds with ' +
        'the other five models. Nothing else about the run changes.',
    },
    {
      kind: 'modelCard',
      id: 'seasonal_naive',
      name: 'Seasonal Naive',
      purpose:
        'Repeats the recent seasonal pattern: each future day is forecast as the average of the last ' +
        'four observations that fell on the same weekday. It exists to keep the rest of the leaderboard ' +
        'honest and is the fixed denominator of the MASE metric used to select every other model.',
      strengths: [
        'Needs almost no history (14 observations) and never fails to fit.',
        'Hard to beat on short, noisy or intermittent series, where learned models tend to overfit.',
        'Fully transparent — the forecast for any day can be read off by hand.',
      ],
      weaknesses: [
        'Cannot represent a trend; a sustained rise or fall in volume is invisible to it.',
        'Uses only weekday, ignoring every other signal (holidays, cost drivers, exogenous features).',
        'Averaging the last four same-weekday values means a single freak week takes four weeks to fully wash out.',
      ],
      assumptions: [
        'The near future looks like the recent past on the same weekday.',
        'Weekly seasonality is the dominant pattern in the series.',
      ],
      idealUseCases: [
        'The benchmark every other model must beat before it is trusted.',
        'Short histories where there is not enough data to fit anything more complex responsibly.',
      ],
    },
    {
      kind: 'modelCard',
      id: 'linear_regression',
      name: 'Linear Regression (ridge)',
      purpose:
        'Ridge-regularized (RidgeCV) linear regression over the engineered feature set. With roughly as ' +
        'many features as training days, ordinary least squares would be numerically unstable, so this ' +
        'model shrinks its coefficients via cross-validated L2 regularization instead — it behaves like ' +
        'plain linear regression once there is comfortably more data than features.',
      strengths: [
        'Coefficients are interpretable and, because features are standardized first, directly comparable as importances.',
        'Regularization keeps it stable even when the feature count is close to the row count.',
        'Fast to fit and fast to explain.',
      ],
      weaknesses: [
        'Assumes additive, linear relationships between features and the target; cannot capture interactions on its own.',
        'Missing values are median-imputed with a companion missing-indicator column, which is a coarse treatment of genuinely absent history.',
        'Like every feature-based model here, needs at least 30 observed values of the target to fit.',
      ],
      assumptions: [
        'Features relate to the target roughly linearly.',
        'Standardized features share one common regularization penalty.',
      ],
      idealUseCases: [
        'A fast, explainable baseline once there is more history than the seasonal-naive benchmark can exploit.',
        'Situations where interpretable coefficients matter as much as raw accuracy.',
      ],
    },
    {
      kind: 'modelCard',
      id: 'random_forest',
      name: 'Random Forest',
      purpose:
        'A bagged ensemble of regression trees over the engineered feature set. It requires no scaling ' +
        'and, in this package, has missing values median-imputed with a companion indicator column before fitting.',
      strengths: [
        'Robust to the outlier days this data is full of; a single wild day does not distort the whole model.',
        'Captures non-linear interactions between features automatically, unlike ridge regression.',
        'No feature scaling or careful preprocessing needed.',
      ],
      weaknesses: [
        'Cannot extrapolate past the range of values seen in training — if call volume trends above ' +
          'anything historically observed, the forest flattens out rather than continuing the trend.',
        'Less interpretable than linear regression; importances are relative, not additive per prediction.',
        'Needs at least 30 observed values of the target to fit.',
      ],
      assumptions: [
        'Recent history contains examples representative of near-future conditions.',
        'The relationship between features and target does not require extrapolating beyond the observed range.',
      ],
      idealUseCases: [
        'Series with non-linear structure and no strong ongoing trend.',
        'Covered by Prophet or SARIMA in the same comparison specifically because this model and XGBoost cannot extrapolate a trend.',
      ],
    },
    {
      kind: 'modelCard',
      id: 'xgboost',
      name: 'XGBoost',
      purpose:
        'Gradient-boosted regression trees over the engineered feature set. Unlike the other tabular ' +
        'models, it handles missing values natively by learning a default split direction for them, so ' +
        'the feature matrix is passed through unimputed.',
      strengths: [
        'Often the most accurate of the tree-based models on tabular feature sets.',
        'Learns a native handling of missing values rather than relying on imputation.',
        'Automatically reduces its number of boosting rounds on very short training sets to avoid memorizing them outright.',
      ],
      weaknesses: [
        'Shares the random forest\'s inability to extrapolate a trend past the training range.',
        'More hyperparameters than the other models, all currently fixed in config rather than tuned.',
        'Needs at least 30 observed values of the target to fit.',
      ],
      assumptions: [
        'Recent history contains examples representative of near-future conditions.',
        'The relationship between features and target does not require extrapolating beyond the observed range.',
      ],
      idealUseCases: [
        'The strongest tree-based candidate once there is enough history to avoid overfitting.',
        'Series with complex, non-linear feature interactions and no need to extrapolate a trend.',
      ],
    },
    {
      kind: 'modelCard',
      id: 'prophet',
      name: 'Prophet',
      purpose:
        'Facebook/Meta\'s additive model: trend plus weekly seasonality plus holiday effects, fit ' +
        'directly on the raw daily series rather than the engineered feature matrix. It produces its own ' +
        'uncertainty intervals from its posterior rather than using the residual-bootstrap machinery the ' +
        'other models rely on.',
      strengths: [
        'The only model in the comparison designed to extrapolate a trend rather than flatten out.',
        'Models holidays explicitly, using the same configured holiday calendar the tabular features use.',
        'Its additive decomposition (trend / weekly / holiday) is a built-in, readable explanation of each forecast.',
      ],
      weaknesses: [
        'Optional dependency requiring a working Stan toolchain; skipped entirely if not installed.',
        'Yearly seasonality is disabled unless there are at least 730 days of history, since fitting an annual cycle to a year or less of data would invent a pattern from noise.',
        'Weekly seasonality is disabled below 14 days of history for the same reason.',
        'Slowest model to fit — it dominates the runtime of a full cross-validated run.',
      ],
      assumptions: [
        'The series is well described as trend plus seasonality plus holiday effects, added together.',
        'Needs at least 30 observed values of the target to fit at all.',
      ],
      idealUseCases: [
        'Series with a clear weekly rhythm and a trend that needs extrapolating — the case tree models structurally cannot handle.',
        'Runs where holiday effects on call volume or cost matter and enough history exists to estimate them.',
      ],
    },
    {
      kind: 'modelCard',
      id: 'sarima',
      name: 'SARIMA',
      purpose:
        'Seasonal ARIMA fit directly on the raw series via statsmodels\' SARIMAX, with a weekly (period-7) ' +
        'seasonal component when there is enough history to identify it. It derives its prediction ' +
        'intervals from the estimated state-space error variance rather than from resampled residuals.',
      strengths: [
        'A classical, well-understood counterweight to the machine-learning models; on short daily series with a weekly cycle it is often competitive with, and sometimes better than, the boosted trees.',
        'Handles gaps in the series natively through its Kalman filter — useful because average call duration is genuinely undefined, not zero, on zero-call days.',
        'Automatically demotes its seasonal order (and, if needed, its whole order) when history is too short to identify the configured specification, rather than fitting a seasonal term to three weeks of data and producing confident, meaningless forecasts.',
      ],
      weaknesses: [
        'Order demotion means the model actually fitted may be a simpler ARIMA than the one configured; the fitted specification is reported so this is never silent.',
        'Assumes a fixed autoregressive structure; does not use any of the exogenous or feature-engineered signals the tabular models see.',
        'Needs at least 28 observed values of the target to fit.',
      ],
      assumptions: [
        'The series\' autocorrelation structure is stable enough to be captured by a fixed-order ARIMA/SARIMA specification.',
        'Enough complete seasonal cycles exist to identify a seasonal term, or the model falls back to a non-seasonal one.',
      ],
      idealUseCases: [
        'Daily series with a stable weekly cycle and no exogenous drivers worth modeling separately.',
        'A classical cross-check against the machine-learning models on the same data.',
      ],
    },
  ],
};
