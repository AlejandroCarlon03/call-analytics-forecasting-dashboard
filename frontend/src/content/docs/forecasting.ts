import type { DocPage } from '../../lib/docs/types';

/**
 * Grounded in call_forecast/forecast.py (generate_forecast, monthly_summary),
 * call_forecast/evaluation.py (rolling_origin_splits, evaluate_models,
 * MASE selection), call_forecast/models/base.py (recursive prediction,
 * _residual_interval, _step_scale, sample_paths, _enforce_non_negative), and
 * SESSION_CONTEXT.md §3's "Design decisions that constrain future changes".
 */
export const forecasting: DocPage = {
  id: 'forecasting',
  title: 'How forecasting works',
  summary: 'The cross-validation, selection, recursive prediction and interval machinery behind every forecast.',
  blocks: [
    { kind: 'heading', text: 'The pipeline' },
    {
      kind: 'paragraph',
      text:
        'For each of the three targets — call volume, average duration, total cost — the pipeline does ' +
        'the same three things: cross-validate every enabled model, select a winner, then refit that ' +
        'winner on all history and produce the forecast shown on this page. The How a Prediction Is Made ' +
        'page has the full pipeline from raw export to chart; this page focuses on the forecasting stage itself.',
    },
    {
      kind: 'diagram',
      caption: 'From cross-validation to a calibrated forecast',
      steps: [
        { label: 'Rolling-origin CV', detail: 'Every enabled model is trained and tested on a sequence of expanding-window folds.' },
        { label: 'Score and select', detail: 'Models are ranked by MASE; the best-scoring model is chosen as the winner.' },
        { label: 'Refit on all history', detail: 'The winning model is fit one more time using every available day.' },
        { label: 'Calibrate', detail: 'Out-of-sample residuals from CV, grouped by horizon step, are handed to the model.' },
        { label: 'Recursive forecast', detail: 'The model predicts 90 days ahead, one day at a time, rebuilding features each step.' },
        { label: 'Simulate paths', detail: 'A moving-block bootstrap draws whole trajectories for monthly totals.' },
      ],
    },
    { kind: 'heading', text: 'Forecast horizons' },
    {
      kind: 'paragraph',
      text:
        'Forecasts are produced at 30, 60 and 90 days, but these are not three separate runs. A single ' +
        '90-day recursive forecast is generated, and the 30- and 60-day views are slices of the front of ' +
        'it. This guarantees the three views are mutually consistent: the first 30 days of the 90-day ' +
        'forecast are exactly the 30-day forecast.',
    },
    { kind: 'heading', text: 'How models are compared and selected' },
    {
      kind: 'paragraph',
      text:
        'A model is evaluated with walk-forward (rolling-origin) cross-validation: train on history up to ' +
        'a cutoff date, forecast the next several days, score against what actually happened, advance the ' +
        'cutoff, and repeat. This is deliberate — a random train/test split would leak future information ' +
        'into the past and report excellent accuracy for a model that would be useless in production. ' +
        'Averaging scores over several such folds is what makes the resulting comparison trustworthy.',
    },
    {
      kind: 'paragraph',
      text:
        'Selection is on MASE (mean absolute scaled error) rather than MAPE or R². MAPE is undefined on ' +
        'zero-call days, which make up a large share of the real data, and R² is routinely negative on an ' +
        'intermittent series. MASE compares a model against a seasonal-naive benchmark and stays meaningful ' +
        'in both situations. See the Metrics page for how to read a MASE value and the Models page for ' +
        'each model\'s own strengths and weaknesses.',
    },
    {
      kind: 'callout',
      tone: 'info',
      text:
        'When a fixed number of validation folds is not achievable with the configured settings, the ' +
        'initial training window shrinks (never below two weeks) so a short dataset still produces some ' +
        'honest out-of-sample estimate — and the number of folds actually used is always reported, so a ' +
        'two-fold result is never mistaken for a twenty-fold one.',
    },
    { kind: 'heading', text: 'Recursive multi-step forecasting' },
    {
      kind: 'paragraph',
      text:
        'The feature-based models (linear regression, random forest, XGBoost) cannot jump straight to day ' +
        '90 — many of their features are lags and rolling means of the target\'s own recent history, which ' +
        'do not exist yet for a day that has not been predicted. So they forecast recursively: predict day ' +
        't+1, write that prediction into the history, rebuild every feature, predict day t+2, and so on.',
    },
    {
      kind: 'paragraph',
      text:
        'Feature rebuilding uses the exact same feature-engineering function used during training, re-run at ' +
        'every step. That is a deliberate design choice: it avoids maintaining a second, prediction-time ' +
        'feature-building code path that could quietly drift out of step with the training path — a common ' +
        'source of bugs known as train/serve skew. The cost is a small amount of repeated computation per ' +
        'step, which is cheap next to the correctness it buys.',
    },
    { kind: 'heading', text: 'How confidence intervals are produced' },
    {
      kind: 'paragraph',
      text:
        'Intervals come from residuals the winning model actually produced during cross-validation — the ' +
        'difference between what it predicted and what really happened — grouped by horizon step (1-based: ' +
        'how many days ahead that prediction was). A day-90 interval is wider than a day-1 interval because ' +
        'the model genuinely scored worse at 90 days during validation, not because of an assumed widening formula.',
    },
    {
      kind: 'paragraph',
      text:
        'Two corrections keep those intervals coherent. Residuals are mean-centred before being used for ' +
        'interval width, so a systematically biased model does not shift every simulated path in the ' +
        'direction of its own bias — the measured bias itself is reported separately rather than silently ' +
        'subtracted from the forecast. And for non-negative targets (calls, cost), clipping simulated paths ' +
        'at zero would push the average upward — clipping moves probability mass up, and that effect ' +
        'compounds with horizon — so clipped paths are rescaled back to be centred on the point forecast.',
    },
    {
      kind: 'callout',
      tone: 'warning',
      text:
        'The residual calibration only covers the cross-validation horizon (7 days by default). Widening ' +
        'beyond that point, out to day 90, is extrapolated rather than directly observed, and the dashboard ' +
        'notes this explicitly whenever it applies to a forecast.',
    },
    { kind: 'heading', text: 'Why monthly totals are simulated, not summed' },
    {
      kind: 'paragraph',
      text:
        'Adding up 30 daily upper bounds would describe a month in which every single day independently ' +
        'lands at its worst case — an outcome far less likely than the stated interval level implies, ' +
        'because day-to-day errors are correlated rather than independent. Instead, whole 30- or 60-day ' +
        'trajectories are simulated using a moving-block bootstrap (7-day blocks), which preserves that ' +
        'day-to-day correlation. Each simulated trajectory is summed, and the monthly interval is read off ' +
        'the distribution of those sums.',
    },
    { kind: 'heading', text: 'Sources of uncertainty' },
    {
      kind: 'list',
      items: [
        'Model error itself, measured directly through cross-validation and the primary driver of interval width.',
        'Error accumulation through the recursive forecast — later days are built on earlier predicted days, not on observed ones.',
        'Extrapolation past the cross-validation horizon for late-horizon days (beyond day 7 by default).',
        'Exogenous features (observed call properties that are not known in advance) held at a trailing 28-day average across the whole horizon, rather than genuinely forecast.',
        'Whatever the model itself cannot represent — a tree-based model\'s inability to extrapolate a trend past its training range, for instance.',
      ],
    },
  ],
};
