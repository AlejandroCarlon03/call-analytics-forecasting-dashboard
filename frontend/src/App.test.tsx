// @vitest-environment jsdom
/**
 * `App`'s import wiring.
 *
 * This is deliberately not a test of `ImportPanel` (mocked below, another
 * agent's file) or of the CSV parser (`lib/import/*`, also someone else's).
 * What belongs here is the contract `App` owns: an import replaces the one
 * payload slice through the same setter the initial load uses, the URL
 * fragment self-heals when it names something the new payload does not have,
 * filtering still works against the *new* payload, and every section still
 * renders — or still declines to — the way it did before this feature existed.
 *
 * Plotly cannot run in jsdom and is mocked, per the existing component tests.
 */

import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { DashboardPayload } from './data/types';
import type { ImportPreview } from './lib/import/types';

vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

// Testing `App`'s reaction to an import, not the panel that fires it. The
// stand-in fires `onImport` with whichever payload/preview the test staged
// via `nextImport`, so each test controls exactly what "importing" produces.
let nextImport: { payload: DashboardPayload; preview: ImportPreview } | null = null;
vi.mock('./components/import', () => ({
  ImportPanel: ({
    onImport,
    activeSourceLabel,
  }: {
    onImport: (payload: DashboardPayload, preview: ImportPreview) => void;
    activeSourceLabel: string;
  }) => (
    <div>
      <span>Active source: {activeSourceLabel}</span>
      <button
        onClick={() => {
          if (nextImport) onImport(nextImport.payload, nextImport.preview);
        }}
      >
        fire import
      </button>
    </div>
  ),
}));

let loadResult: { payload: DashboardPayload; source: 'inline' | 'fetch' | 'fixture' } | null =
  null;
vi.mock('./data/loadPayload', () => ({
  loadPayload: () => Promise.resolve(loadResult),
}));

function ingestion(overrides: Partial<DashboardPayload['ingestion']> = {}) {
  return {
    files: ['calls.csv'],
    rows_read: 10,
    rows_kept: 10,
    dropped: {},
    warnings: [],
    missing_columns: [],
    date_min: '2026-01-01',
    date_max: '2026-01-10',
    active_days: 10,
    calendar_days: 10,
    coverage_pct: 100,
    ...overrides,
  };
}

function config(overrides: Partial<DashboardPayload['config']['forecast']> = {}) {
  return {
    forecast: { horizons: [30, 60, 90], interval_level: 0.8, n_simulations: 100, targets: [], ...overrides },
    cv: {
      horizon: 30,
      step: 7,
      initial_train_days: 60,
      min_folds: 3,
      selection_metric: 'mase',
      selection_tiebreaker: 'mae',
    },
    data: { holiday_country: 'US', holiday_subdiv: null },
    business_hours: { start_hour: 8, end_hour: 18, overnight_start_hour: 22, overnight_end_hour: 6 },
    anomalies: {
      cost_overrun_pct: 0.25,
      duration_sigma: 3,
      missed_spike_sigma: 3,
      robust_z_threshold: 3.5,
      baseline_window_days: 28,
    },
    scenarios: {
      current_agents: 10,
      target_answer_seconds: 30,
      service_level_pct: 80,
      staffed_hours_per_day: 10,
    },
    models: { enabled: ['ridge'] },
  };
}

/** A full payload, with one target — `call_volume` — carrying a forecast. */
function fullPayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-10T00:00:00',
    ingestion: ingestion(),
    config: config({ targets: ['call_volume'] }),
    targets: ['call_volume'],
    targetMeta: { call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' } },
    forecasts: {
      call_volume: {
        target: 'call_volume',
        model: 'ridge',
        modelLabel: 'Linear Regression (ridge)',
        intervalLevel: 0.8,
        calibrated: true,
        aggregate: 'sum',
        notes: [],
        horizons: [{ days: 30, measure: 'total', forecast: 300, lower: 250, upper: 350 }],
        daily: [{ date: '2026-01-11', yhat: 10, yhat_lower: 8, yhat_upper: 12, step: 1, horizon_bucket: '30d' }],
        monthly: [],
      },
    },
    evaluations: {},
    explanations: {},
    daily: [{ date: '2026-01-01', call_volume: 10, avg_duration_sec: 100, total_cost: 5 }],
    hourly: [{ weekday: 0, weekdayLabel: 'Mon', hour: 9, calls: 5 }],
    anomalies: { items: [], byRule: [], notes: [], counts: { critical: 0, warning: 0, info: 0 } },
    scenarios: { rows: [{ scenario: 'baseline', current_agents: 10 }], notes: [] },
    ...overrides,
  };
}

/** What a raw CSV import produces: descriptive sections only, no forecasts. */
function csvPayload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return fullPayload({
    config: config({ targets: [] }),
    targets: [],
    targetMeta: {},
    forecasts: {},
    evaluations: {},
    explanations: {},
    scenarios: { rows: [], notes: [] },
    ...overrides,
  });
}

function preview(fileName: string): ImportPreview {
  return {
    kind: 'csv',
    fileName,
    fileSize: 1024,
    rowsRead: 10,
    rowsKept: 10,
    dropped: {},
    dateMin: '2026-01-01',
    dateMax: '2026-01-10',
    columnMap: {},
    ignoredColumns: [],
    sampleDaily: [],
    warnings: [],
  };
}

/** A preview describing an imported `dashboard_data.json`, not a raw CSV. */
function payloadPreview(fileName: string): ImportPreview {
  return { ...preview(fileName), kind: 'payload' };
}

async function renderApp() {
  // Dynamically imported alongside `App` (rather than statically at the top of
  // this file) so both come out of the *same* module graph. `vi.resetModules()`
  // in `afterEach` clears the registry between tests; a statically-imported
  // `ThemeProvider` would keep using the previous test's `ThemeContext`
  // instance while a freshly re-imported `App` -> `ThemeToggle` reads the new
  // one, and `useTheme` throws "must be used inside a <ThemeProvider>" even
  // though one is rendered.
  const { App } = await import('./App');
  const { ThemeProvider } = await import('./theme/ThemeProvider');
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
  // Wait for the async loadPayload() to resolve and the ready view to mount.
  await screen.findByRole('button', { name: 'fire import' });
}

async function fireImport(payload: DashboardPayload, filePreview: ImportPreview) {
  nextImport = { payload, preview: filePreview };
  await userEvent.click(screen.getByRole('button', { name: 'fire import' }));
}

afterEach(() => {
  vi.resetModules();
  nextImport = null;
  loadResult = null;
  window.location.hash = '';
});

describe('App import wiring', () => {
  it('swaps the rendered dashboard on import', async () => {
    loadResult = {
      payload: fullPayload({
        scenarios: { rows: [{ scenario: 'baseline', current_agents: 10 }], notes: ['old-run-note'] },
      }),
      source: 'fixture',
    };
    await renderApp();

    expect(screen.getByText('old-run-note')).toBeInTheDocument();

    const next = fullPayload({
      targetMeta: { call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' } },
      scenarios: { rows: [{ scenario: 'baseline', current_agents: 10 }], notes: ['new-run-note'] },
    });
    await fireImport(next, preview('calls_2026.csv'));

    await waitFor(() => expect(screen.getByText('new-run-note')).toBeInTheDocument());
    expect(screen.queryByText('old-run-note')).not.toBeInTheDocument();
  });

  it('degrades a stale #model=… fragment to "All" across a swap', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    window.location.hash = '#model=call_volume';
    await renderApp();

    // Sanity: the fragment did select the target before the import.
    expect(screen.getByRole('button', { name: /Call volume/, current: 'page' })).toBeInTheDocument();

    // The next payload does not carry `call_volume` at all — a CSV import.
    const next = csvPayload();
    await fireImport(next, preview('raw_calls.csv'));

    await waitFor(() => {
      // A target that no longer exists in the payload must not survive the
      // swap: no rail tab is selected, and the forecast/model-comparison/
      // explainability sections — which only exist for a real target — are
      // gone rather than rendering against a target the payload no longer has.
      expect(screen.queryByRole('button', { name: /Call volume/ })).not.toBeInTheDocument();
    });
  });

  it('filters against the new payload after an import', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();

    const volumeForecast = fullPayload().forecasts['call_volume'];
    if (!volumeForecast) throw new Error('fixture missing call_volume forecast');

    const next = fullPayload({
      targets: ['call_volume', 'total_cost'],
      config: config({ targets: ['call_volume', 'total_cost'] }),
      targetMeta: {
        call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' },
        total_cost: { label: 'Daily cost', units: 'USD', aggregate: 'sum' },
      },
      forecasts: {
        call_volume: volumeForecast,
        total_cost: { ...volumeForecast, target: 'total_cost', modelLabel: 'Cost model' },
      },
    });
    await fireImport(next, preview('two_targets.csv'));

    const costTab = await screen.findByRole('button', { name: /Daily cost/ });
    await userEvent.click(costTab);

    await waitFor(() => {
      expect(window.location.hash).toBe('#model=total_cost');
    });
    // The volume tab's own forecast card should no longer be on the page —
    // the rail still lists both tabs, so this checks card headings, not any
    // text, or the volume tab's own label would produce a false negative.
    expect(
      screen.queryByRole('heading', { level: 3, name: /Linear Regression \(ridge\)/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /Cost model/ })).toBeInTheDocument();
  });

  it('renders descriptive sections and omits forecast-bearing ones for a CSV-style payload, without crashing', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();

    const next = csvPayload({ ingestion: ingestion({ files: ['raw_export.csv'] }) });
    await fireImport(next, preview('raw_export.csv'));

    await waitFor(() =>
      expect(screen.getByText('Active source: raw_export.csv')).toBeInTheDocument(),
    );

    // Data Quality, At a Glance and Arrivals describe the whole run and have
    // no forecast dependency, so they must still render.
    expect(screen.getByRole('heading', { name: /data quality/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /at a glance/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /when calls arrive/i })).toBeInTheDocument();

    // Forecasts, model comparison and explainability have nothing to show
    // for an empty `forecasts`/`evaluations`/`explanations`/`targets` and
    // must not render a heading for an empty section.
    expect(screen.queryByRole('heading', { name: /^forecasts$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /model comparison/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /what drives the forecast/i })).not.toBeInTheDocument();
  });

  it('lands on the second payload when importing twice in a row (no duplicate state)', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();

    const scenarioRow = { scenario: 'baseline', current_agents: 10 };
    const second = fullPayload({ scenarios: { rows: [scenarioRow], notes: ['second-note'] } });
    const third = fullPayload({ scenarios: { rows: [scenarioRow], notes: ['third-note'] } });

    await fireImport(second, preview('second.csv'));
    await waitFor(() => expect(screen.getByText('second-note')).toBeInTheDocument());

    await fireImport(third, preview('third.csv'));

    await waitFor(() => expect(screen.getByText('third-note')).toBeInTheDocument());
    expect(screen.queryByText('second-note')).not.toBeInTheDocument();
    expect(screen.getByText('Active source: third.csv')).toBeInTheDocument();
  });
  /*
   * Added by the lead during review of the three agents' work.
   *
   * `AnomaliesSection` has no empty guard, so before this it rendered a clean
   * volume line and a zero tally after a CSV import — indistinguishable from a
   * pipeline run that genuinely found nothing. One is a finding; the other is
   * a section reporting on an analysis that never happened. The distinction
   * cannot come from the payload (both have zero rows), so `App` carries it.
   */
  describe('analysis provenance', () => {
    it('omits the anomalies section after a CSV import, rather than showing an empty one', async () => {
      loadResult = { payload: fullPayload(), source: 'fixture' };
      await renderApp();
      expect(await screen.findByText(/anomalies and alerts/i)).toBeInTheDocument();

      await fireImport(csvPayload(), preview('raw_calls.csv'));

      await waitFor(() => {
        expect(screen.queryByText(/anomalies and alerts/i)).not.toBeInTheDocument();
      });
    });

    it('says why the analysis sections are missing instead of leaving it to be inferred', async () => {
      loadResult = { payload: fullPayload(), source: 'fixture' };
      await renderApp();

      await fireImport(csvPayload(), preview('raw_calls.csv'));

      const note = await screen.findByText(/produced by the Python pipeline/i);
      expect(note).toBeInTheDocument();
      expect(note).toHaveTextContent('raw_calls.csv');
    });

    it('keeps the anomalies section when the import is a pipeline payload', async () => {
      loadResult = { payload: fullPayload(), source: 'fixture' };
      await renderApp();

      await fireImport(fullPayload(), payloadPreview('dashboard_data.json'));

      expect(await screen.findByText(/anomalies and alerts/i)).toBeInTheDocument();
      expect(screen.queryByText(/produced by the Python pipeline/i)).not.toBeInTheDocument();
    });

    it('shows no provenance note on a freshly loaded pipeline run', async () => {
      loadResult = { payload: fullPayload(), source: 'inline' };
      await renderApp();

      expect(await screen.findByText(/anomalies and alerts/i)).toBeInTheDocument();
      expect(screen.queryByText(/produced by the Python pipeline/i)).not.toBeInTheDocument();
    });
  });
});
