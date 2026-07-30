import type { DocPage } from '../../lib/docs/types';

/**
 * Grounded in call_forecast/evaluation.py (metric definitions, METRICS,
 * leaderboard), call_forecast/forecast.py (HorizonRollup / intervals),
 * call_forecast/anomalies.py (rule set), call_forecast/explain.py (the three
 * importance methods), and frontend/src/data/types.ts (what the payload
 * actually carries onto the page, including `min_observations` skips
 * producing a null leaderboard/importance section).
 */
export const metrics: DocPage = {
  id: 'metrics',
  title: 'Reading the dashboard',
  summary: 'What each section of the report shows, and how to read the numbers in it.',
  blocks: [
    { kind: 'heading', text: 'Feature Importance' },
    {
      kind: 'paragraph',
      text:
        'Shows which engineered features the winning model relies on most, ranked by combining up to ' +
        'three methods: SHAP (attributes individual predictions to features, when available), permutation ' +
        'importance (what degrades when a feature is shuffled), and native importance (the model\'s own ' +
        'coefficients or tree impurity scores). Each is measured differently and can disagree; the ' +
        'consolidated ranking averages their ranks rather than picking one. With only a few dozen training ' +
        'rows, treat the top two or three features as robust and the rest of the list as provisional.',
    },
    { kind: 'heading', text: 'Monthly Cost' },
    {
      kind: 'paragraph',
      text:
        'A calendar-month rollup of the forecast for total cost, with a simulated interval rather than a ' +
        'sum of daily bounds — see the Forecasting page for why. A month the forecast only partially ' +
        'covers is flagged as a partial month, so it is never mistaken for a full month\'s total.',
    },
    { kind: 'heading', text: 'Arrivals Heatmap' },
    {
      kind: 'paragraph',
      text:
        'Observed call volume by day of week and hour of day, across the full history. This is purely ' +
        'descriptive of the past — it is not a forecast — and is the fastest way to see when calls actually arrive.',
    },
    { kind: 'heading', text: 'Model Leaderboard' },
    {
      kind: 'paragraph',
      text:
        'Every enabled model\'s cross-validated accuracy for one target, sorted by the selection metric ' +
        '(MASE by default). The winning row is the model whose forecast is shown elsewhere on the page. A ' +
        'model that could not be fitted — usually because it fell below its minimum-observations floor — ' +
        'appears with a status of skipped and a reason, sorted to the bottom regardless of any metric value.',
    },
    {
      kind: 'callout',
      tone: 'info',
      text:
        'When every learned model is skipped for a target, the leaderboard still shows the seasonal-naive ' +
        'row, but the ranked comparison and the feature-importance chart for that target are correctly ' +
        'absent rather than shown empty. This is expected behavior on short history, not a rendering failure.',
    },
    { kind: 'heading', text: 'Forecast Accuracy metrics' },
    {
      kind: 'table',
      caption: 'The seven accuracy metrics reported per model',
      columns: ['Metric', 'What it measures', 'How to read it'],
      rows: [
        ['MAE', 'Mean absolute error, in the target\'s own units', 'Lower is better; directly comparable to the target\'s scale.'],
        ['RMSE', 'Root mean squared error', 'Lower is better; penalizes large misses harder than MAE, so it separates usually-good-but-occasionally-wild models from consistently-mediocre ones.'],
        ['MAPE', 'Mean absolute percentage error, over non-zero actuals only', 'Lower is better, but only meaningful alongside mape_n — see below.'],
        ['sMAPE', 'Symmetric percentage error, defined even on zero-call days', 'Lower is better; the percentage figure that survives the zero-call days MAPE cannot handle.'],
        ['MASE', 'Mean absolute error scaled against a seasonal-naive benchmark', 'Below 1 beats the benchmark; at or above 1 it does not. The default model-selection metric.'],
        ['R²', 'Coefficient of determination', 'Higher is better, but routinely negative on short or intermittent series — that means the model tracks worse than a flat line at the period mean, not that something is broken.'],
        ['bias', 'Mean signed error (actual minus forecast)', 'Positive means the model under-forecasts on average; negative means it over-forecasts. Reported, never silently corrected.'],
      ],
    },
    {
      kind: 'paragraph',
      text:
        'Read MASE first. A value below 1 means the model beats "repeat recent same-weekday values"; a ' +
        'value at or above 1 means it does not — and in that case the seasonal-naive baseline is doing at ' +
        'least as well as the learned model, which is worth knowing before trusting the forecast.',
    },
    {
      kind: 'paragraph',
      text:
        'MAPE is always reported alongside mape_n, the count of days it was actually computed over — MAPE ' +
        'is undefined on a zero-call day and is excluded from those days entirely. A MAPE computed from ' +
        'four days is not the same kind of number as one computed from forty, and mape_n is what tells them apart.',
    },
    { kind: 'heading', text: 'Anomalies' },
    {
      kind: 'paragraph',
      text:
        'Flagged days from four standing rules — a cost overrun above the configured threshold, an ' +
        'average-duration spike, a missed-call-rate spike, and any call inside the overnight window — plus ' +
        'statistical outliers on volume, duration and cost. Each rule compares a day against a trailing, ' +
        'weekday-aware expectation built only from prior days, so a day never informs its own baseline. ' +
        'Severity (critical / warning / info) reflects how far the day deviated from that expectation, not ' +
        'how large the raw number was.',
    },
    { kind: 'heading', text: 'Forecast confidence and intervals' },
    {
      kind: 'paragraph',
      text:
        'Every forecast chart shows a shaded band around the point forecast — the calibrated interval ' +
        'described on the Forecasting page. A forecast card notes when it is not calibrated (no ' +
        'cross-validation residuals were available), which means the band shown is narrower than the ' +
        'model\'s true uncertainty and should be read with that caveat in mind.',
    },
  ],
};
