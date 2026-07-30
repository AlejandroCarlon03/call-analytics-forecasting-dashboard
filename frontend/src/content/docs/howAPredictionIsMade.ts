import type { DocPage } from '../../lib/docs/types';

/**
 * The shallow, end-to-end orientation page: one number's journey from a raw
 * call export row to a chart on this dashboard. Deliberately shallow — no
 * metric formulas, no model internals, no config keys. Those live on the
 * Models, Forecasting and Metrics pages; this page names them and points
 * there rather than repeating them.
 *
 * Grounded in: call_forecast/ingest.py (load_calls, de-duplication,
 * ValidationReport), call_forecast/features.py (build_daily, engineer,
 * FeatureSpec families), call_forecast/evaluation.py (evaluate_models,
 * rolling-origin CV, MASE selection), call_forecast/forecast.py
 * (generate_forecast, recursive multi-step, interval calibration, monthly
 * bootstrap), call_forecast/serialize.py and dashboard.py
 * (build_payload / build_dashboard_react), and SESSION_CONTEXT.md §2's
 * "Data flow" diagram.
 */
export const howAPredictionIsMade: DocPage = {
  id: 'how-a-prediction-is-made',
  title: 'How a prediction is made',
  navLabel: 'How a prediction is made',
  summary: 'Follow one number from a raw call-export row all the way to a chart on this page.',
  blocks: [
    {
      kind: 'diagram',
      caption: 'From a raw call record to a dashboard chart',
      steps: [
        {
          label: 'Historical Call Data',
          detail: 'RetellAI CSV/XLSX exports dropped into the data folder, one row per call.',
        },
        {
          label: 'Data Cleaning',
          detail: 'Parsed, range-checked and de-duplicated into one clean table of calls.',
        },
        {
          label: 'Feature Engineering',
          detail: 'Aggregated to one row per calendar day and expanded into calendar, autoregressive and exogenous features.',
        },
        {
          label: 'Model Training',
          detail: 'Six candidate models are walk-forward cross-validated per target and scored.',
        },
        {
          label: 'Forecast Generation',
          detail: 'The winning model is refit on all history and forecasts 90 days ahead, one day at a time.',
        },
        {
          label: 'Confidence Estimation',
          detail: 'Out-of-sample errors from cross-validation are turned into widening prediction bands.',
        },
        {
          label: 'Dashboard Visualizations',
          detail: 'Everything is packaged into one JSON payload and rendered as this self-contained page.',
        },
      ],
    },
    { kind: 'heading', text: '1. Historical Call Data' },
    {
      kind: 'paragraph',
      text:
        'The starting point is a RetellAI call-analytics export — a CSV or Excel file with one row per ' +
        'call, dropped into the data folder. The loader discovers every matching file and reads it in.',
    },
    { kind: 'heading', text: '2. Data Cleaning' },
    {
      kind: 'paragraph',
      text:
        'Every column is parsed, range-checked and validated: timestamps, durations, and costs outside a ' +
        'plausible range are dropped and counted rather than silently kept. Rows are de-duplicated across ' +
        'overlapping exports — matched on call ID when the export has one, or otherwise on the combination ' +
        'of timestamp, duration and cost plus its position within the file. The position matters because ' +
        'these timestamps only have minute resolution and there is no call ID to fall back on, so two ' +
        'genuinely separate calls placed in the same minute would otherwise look identical.',
    },
    {
      kind: 'paragraph',
      text:
        'Every problem found — dropped rows, missing columns, low data coverage — accumulates on a ' +
        'validation report and is surfaced to the reader rather than raising an error. Ingestion only ' +
        'fails outright when the data is unusable, such as no timestamp column at all.',
    },
    { kind: 'heading', text: '3. Feature Engineering' },
    {
      kind: 'paragraph',
      text:
        'The cleaned call-level rows are aggregated to one row per calendar day, including days with zero ' +
        'calls — an empty day is signal, not a gap to be skipped. That daily table is then expanded with ' +
        'engineered features grouped into three families: calendar features known for any future date ' +
        '(weekday, holiday), autoregressive features drawn from the target\'s own history (lags, rolling ' +
        'means), and exogenous features from other observed call properties. A target never sees another ' +
        'target\'s lagged values — tomorrow\'s cost is not known when forecasting tomorrow\'s volume.',
    },
    { kind: 'heading', text: '4. Model Training' },
    {
      kind: 'paragraph',
      text:
        'Every target is evaluated against all six registered models using walk-forward cross-validation: ' +
        'train on everything up to a cutoff date, forecast forward, score against what actually happened, ' +
        'advance the cutoff, and repeat. The model that performs best on MASE is selected as the winner. A ' +
        'model with fewer observations than its configured minimum is skipped, with the reason logged, ' +
        'rather than fitted on a handful of points and trusted. The Models and Forecasting pages cover the ' +
        'six models and the selection metric in full.',
    },
    { kind: 'heading', text: '5. Forecast Generation' },
    {
      kind: 'paragraph',
      text:
        'The winning model is refit one more time, on all available history, and asked for a 90-day ' +
        'forecast. Feature-based models predict recursively: one day is forecast, written back into the ' +
        'history, and every feature is rebuilt from scratch before the next day is predicted — the same ' +
        'code path used during training, so there is no separate, potentially inconsistent prediction-time ' +
        'feature logic.',
    },
    { kind: 'heading', text: '6. Confidence Estimation' },
    {
      kind: 'paragraph',
      text:
        'Prediction bands come from the errors the model actually made during cross-validation, grouped by ' +
        'how many days ahead each prediction was. A day-90 band is wider than a day-1 band because the ' +
        'model genuinely was worse at 90 days in validation, not because of an assumed formula. Monthly ' +
        'totals are not a sum of daily bands — they come from simulating whole 30-day trajectories and ' +
        'reading the spread off the simulated totals, which preserves how errors on nearby days move ' +
        'together. The Forecasting page explains both mechanisms in detail.',
    },
    { kind: 'heading', text: '7. Dashboard Visualizations' },
    {
      kind: 'paragraph',
      text:
        'Everything produced — forecasts, the leaderboard, feature importance, anomalies, staffing ' +
        'scenarios — is assembled into one JSON payload. That payload is substituted into a pre-built React ' +
        'application template to produce a single, self-contained HTML file — the page currently open. ' +
        'Nothing on this page is computed in the browser; it is all read straight out of that payload.',
    },
    {
      kind: 'callout',
      tone: 'info',
      title: 'This is a snapshot, not a live view',
      text:
        'The whole path above runs once, offline, as a batch process. What is on screen is only as current ' +
        'as the run that produced it. The header\'s "generated" timestamp is how to tell how old that snapshot is.',
    },
  ],
};
