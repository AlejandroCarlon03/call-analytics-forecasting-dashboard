import type { DocPage } from '../../lib/docs/types';

/**
 * Grounded in call_forecast/ingest.py (ValidationReport, range checks,
 * de-duplication, coverage warnings), call_forecast/models/base.py
 * (min_observations as the honesty mechanism), call_forecast/anomalies.py,
 * and SESSION_CONTEXT.md §4 ("The headline caveat" — the real 71-day vs.
 * 210-day sample MASE comparison, quoted verbatim).
 */
export const dataQuality: DocPage = {
  id: 'data-quality',
  title: 'Data quality',
  summary: 'Why forecast accuracy is bounded by data volume and cleanliness, and how to read the warning signs.',
  blocks: [
    {
      kind: 'paragraph',
      text:
        'A forecasting model can only be as good as the history it learns from. This page covers the data ' +
        'problems the pipeline watches for, how they are surfaced rather than hidden, and why — on the ' +
        'data available right now — that matters more than which model was picked.',
    },
    {
      kind: 'callout',
      tone: 'warning',
      title: 'The headline result',
      text:
        'On a real 71-day export, no model meaningfully beat the seasonal-naive benchmark: MASE of 1.34 ' +
        'for call volume, 0.80 for average duration, and 1.36 for total cost (values at or above 1 do not ' +
        'beat the benchmark). The same pipeline, run on a 210-day sample, reached MASE 0.79 / 0.69 / 0.79 ' +
        'with three different models winning. This is a data-volume limit, not a defect in the code — the ' +
        'single most useful thing to do to improve forecast accuracy is to accumulate more history.',
    },
    { kind: 'heading', text: 'Insufficient history' },
    {
      kind: 'paragraph',
      text:
        'Every model has a configured minimum number of observations of a target before it is allowed to ' +
        'fit at all — 14 for the seasonal-naive baseline, 28 for SARIMA, 30 for the rest. A target below ' +
        'its model\'s floor is skipped, with the reason logged, rather than fitted on a handful of points ' +
        'and quietly trusted. This floor is a deliberate honesty mechanism: lowering it would make more ' +
        'models appear in the leaderboard, but it would not make their forecasts any more reliable, so it ' +
        'is not something to tune away when a chart looks sparse.',
    },
    { kind: 'heading', text: 'Data coverage: active vs. calendar days' },
    {
      kind: 'paragraph',
      text:
        'Coverage is the share of calendar days within the data\'s date range that actually contain a ' +
        'call. A dataset spanning 71 calendar days with calls on only 29 of them is 41% coverage, and that ' +
        'sparseness compounds: models are trained on far fewer effective examples than the date range ' +
        'suggests. When coverage drops below 60%, the pipeline flags the series as intermittent — the ' +
        'point at which MAPE becomes unreliable and MASE, which stays meaningful on intermittent series, ' +
        'is used for model selection instead.',
    },
    { kind: 'heading', text: 'Zero-call days' },
    {
      kind: 'paragraph',
      text:
        'A day with no calls is included in the daily series as a real zero, not dropped or treated as ' +
        'missing — an empty day is signal about the business, not a gap in the data. Average call duration ' +
        'is the one exception: it is genuinely undefined (not zero) on a day with no calls, so those rows ' +
        'are excluded from duration training and from duration averages rather than being filled with a ' +
        'misleading value.',
    },
    { kind: 'heading', text: 'Anomalies as a data-quality signal' },
    {
      kind: 'paragraph',
      text:
        'Not every flagged anomaly is an operational event — some are a sign the underlying data is odd. A ' +
        'cluster of statistical outliers right after a new export lands, for instance, is worth checking ' +
        'against the ingestion warnings before treating it as a real spike in call activity. The Metrics ' +
        'page covers how each anomaly rule works.',
    },
    { kind: 'heading', text: 'Common issues caught during ingestion' },
    {
      kind: 'table',
      caption: 'Data-quality problems checked during ingestion, and how each is handled',
      columns: ['Issue', 'How it is caught', 'What happens'],
      rows: [
        [
          'Duplicate rows',
          'Matched on call ID when present; otherwise on timestamp, duration and cost plus position within the file',
          'Later duplicates are dropped and counted, so overlapping exports can be reloaded safely.',
        ],
        [
          'Unparseable durations',
          'Every duration cell is parsed from its several possible shapes (MM:SS, HH:MM:SS, plain seconds, Excel time values)',
          'A cell that still cannot be parsed becomes a missing value rather than a guess.',
        ],
        [
          'Out-of-range values',
          'Duration and cost are checked against configured plausibility ceilings, and negative values are checked too',
          'Implausible or negative values are dropped and the drop is counted, rather than silently kept.',
        ],
        [
          'Unparseable timestamps',
          'Every timestamp cell is parsed; the share that fail is tracked',
          'Individual bad timestamps are dropped and counted; if too large a share of the file fails, ingestion raises rather than proceeding on a wrong file or column.',
        ],
      ],
    },
    {
      kind: 'paragraph',
      text:
        'Every one of these checks accumulates on a validation report shown in the Data Quality section of ' +
        'the dashboard — rows read, rows kept, and a breakdown of what was dropped and why. Ingestion only ' +
        'raises an error outright when the data cannot be used at all; short of that, problems are surfaced rather than hidden.',
    },
    { kind: 'heading', text: 'Why data quality bounds forecast accuracy' },
    {
      kind: 'paragraph',
      text:
        'A model can only learn a pattern it has seen enough examples of. Short history, low coverage and ' +
        'noisy rows all shrink the effective sample a model is trained and validated on — and cross-validation ' +
        'itself needs several complete folds to produce a trustworthy comparison, so a short series produces ' +
        'both a weaker model and a less certain measurement of how weak it is. No amount of model choice ' +
        'or tuning substitutes for that; it is why the recommended next step, ahead of anything else, is ' +
        'accumulating more history and re-checking the leaderboard once it does.',
    },
  ],
};
