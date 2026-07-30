import type { DocPage } from '../../lib/docs/types';

/**
 * Grounded in SESSION_CONTEXT.md §1 (Project Overview), §2 (Current
 * Architecture, "Data flow"), and §8 ("Frontend architecture", "Payload
 * loading"). Also call_forecast/cli.py's command list and pipeline.py's
 * `_write_outputs` for what actually lands on disk.
 */
export const about: DocPage = {
  id: 'about',
  title: 'About this dashboard',
  summary: 'What this application does, who it is for, and how a single CSV export becomes this page.',
  blocks: [
    {
      kind: 'paragraph',
      text:
        'This dashboard reports on RetellAI phone-agent call volume, duration and cost for Diamond ' +
        'Kitchen and Bath. It answers four questions: how many calls should we expect next month, what ' +
        'will they cost, when do we need another person on the phones, and did anything unusual happen ' +
        'recently. It forecasts forward, which complements the existing tools that report on the past.',
    },
    {
      kind: 'callout',
      tone: 'info',
      title: 'A batch tool, not a service',
      text:
        'There is no server and no database behind this page. A Python command-line tool reads call ' +
        'export files, does all of the analysis, and writes a single self-contained HTML file — this one. ' +
        'Opening it makes no network request. It can be emailed as an attachment and will render identically.',
    },
    { kind: 'heading', text: 'What the Python backend does' },
    {
      kind: 'paragraph',
      text:
        'A command-line package, call_forecast, does all of the work before this page ever exists. It ' +
        'reads CSV or Excel exports, validates and cleans them, aggregates calls to one row per day, ' +
        'engineers features, cross-validates six forecasting models per target, selects a winner, produces ' +
        '30/60/90-day forecasts with calibrated intervals, flags anomalies, computes feature importance, ' +
        'runs staffing scenarios, and writes it all out — CSV files for every table, one JSON payload, and ' +
        'this HTML report.',
    },
    { kind: 'heading', text: 'What the browser does' },
    {
      kind: 'paragraph',
      text:
        'Everything you see here is a React application that reads the JSON payload inlined into this ' +
        'file and renders it. Filtering by model, changing the forecast horizon, and switching the theme ' +
        'all happen locally in the browser — none of it re-runs the analysis or contacts a server. The ' +
        'numbers on the page were fixed the moment the Python tool wrote this file.',
    },
    {
      kind: 'diagram',
      caption: 'From a call export to this dashboard',
      steps: [
        { label: 'Call export files', detail: 'CSV or Excel files dropped into a data folder, one row per call.' },
        { label: 'Ingest', detail: 'Parse, validate, range-check and de-duplicate into one clean daily-call table.' },
        { label: 'Aggregate to daily', detail: 'One row per calendar day, including days with zero calls, plus engineered features.' },
        { label: 'Cross-validate models', detail: 'Six forecasting models are walk-forward validated per target and scored.' },
        { label: 'Forecast', detail: 'The winning model is refit on all history and forecasts 90 days with calibrated intervals.' },
        { label: 'Explain and detect', detail: 'Feature importance, anomaly rules and staffing scenarios are computed.' },
        { label: 'Write outputs', detail: 'CSV deliverables, a JSON payload, and this dashboard HTML file are written to disk.' },
        { label: 'This page', detail: 'The browser reads the inlined JSON payload and renders it — no further computation.' },
      ],
    },
    { kind: 'heading', text: 'The dashboard workflow' },
    {
      kind: 'list',
      ordered: true,
      items: [
        'Drop call export files (CSV or Excel) into the data folder.',
        'Run the command-line tool once. It ingests the data, evaluates every model on every target, generates forecasts, and writes this HTML file.',
        'Open the file. The Data Quality and At a Glance sections summarize what was ingested.',
        'Use the model rail to filter the page to one target, and the horizon selector on each forecast card to view 30, 60 or 90 days.',
        'Read the Model Leaderboard and Feature Importance sections to see which model won and why.',
        'Check Anomalies for anything that deviated from the expected pattern.',
        'Re-run the tool as new export data arrives; the report regenerates from scratch each time.',
      ],
    },
    {
      kind: 'callout',
      tone: 'warning',
      title: 'Point forecasts are not yet production-reliable',
      text:
        'On the real (currently short) export, the learned models generally do not beat the seasonal-naive ' +
        'baseline. See the Data Quality page for the actual comparison. The tool is feature-complete and ' +
        'correct; it is simply working with too little history so far.',
    },
    {
      kind: 'faq',
      items: [
        {
          question: 'Does opening this file send any data anywhere?',
          answer:
            'No. The file is fully self-contained — its JavaScript, styling and data are all inlined. ' +
            'Opening it, even from a local disk with no network connection, renders the full report.',
        },
        {
          question: 'Why does the page look different each time it is regenerated?',
          answer:
            'Each run re-ingests the current export files, re-validates and re-fits every model, and can ' +
            'select a different winning model per target as more history accumulates. The report always ' +
            'reflects the data available at the moment it was generated.',
        },
        {
          question: 'Can I interact with old data while new calls keep coming in?',
          answer:
            'Yes. This file is a snapshot of one run. Filtering, sorting and the horizon selector only ' +
            'change what is displayed from that snapshot; re-running the tool produces a new file with ' +
            'updated numbers.',
        },
      ],
    },
  ],
};
