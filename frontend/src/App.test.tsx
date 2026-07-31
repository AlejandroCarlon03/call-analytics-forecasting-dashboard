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

vi.mock('plotly.js-cartesian-dist-min', () => ({
  default: {
    react: vi.fn(),
    purge: vi.fn(),
    // Export Center's PNG path (`lib/export/png.ts`) calls this directly, and
    // without it here an export run throws rather than producing nothing.
    toImage: vi.fn().mockResolvedValue(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
  },
}));

// The engine's own download primitive is stubbed so an export run in jsdom
// neither needs `URL.createObjectURL` (jsdom has none) nor actually clicks a
// synthesised anchor. Tests read what `App` handed the engine off this spy's
// calls, rather than off internal React state — the brief's own guidance.
const downloadBlobMock = vi.fn();
vi.mock('./lib/export/download', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/export/download')>();
  return { ...actual, downloadBlob: downloadBlobMock };
});

// Lets one test force a whole-run failure without the engine itself having a
// throwing code path — `runExport` is documented not to throw for per-analytic
// problems, so the only realistic way to exercise `App`'s catch block is to
// make the call itself reject.
let forceExportThrow: Error | null = null;
vi.mock('./lib/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/export')>();
  return {
    ...actual,
    runExport: async (
      request: Parameters<typeof actual.runExport>[0],
      ctx: Parameters<typeof actual.runExport>[1],
    ) => {
      if (forceExportThrow) throw forceExportThrow;
      return actual.runExport(request, ctx);
    },
  };
});

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
  // The application now opens on the landing page, so every test below that
  // wants the report enters through it first — the same click a reader makes.
  // A test with a fragment already set (a deep link) is past the landing page
  // on load and finds no such button, which is the behaviour those tests are
  // implicitly relying on.
  if (window.location.hash === '') {
    await userEvent.click(await screen.findByRole('button', { name: 'Open dashboard' }));
  }
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
  downloadBlobMock.mockClear();
  forceExportThrow = null;
});

/** A payload carrying two forecast-bearing targets, for selection tests. */
function twoTargetPayload(): DashboardPayload {
  const volumeForecast = fullPayload().forecasts['call_volume'];
  if (!volumeForecast) throw new Error('fixture missing call_volume forecast');
  return fullPayload({
    targets: ['call_volume', 'total_cost'],
    config: config({ targets: ['call_volume', 'total_cost'] }),
    targetMeta: {
      call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' },
      total_cost: { label: 'Daily cost', units: 'USD', aggregate: 'sum' },
    },
    forecasts: {
      call_volume: volumeForecast,
      total_cost: {
        ...volumeForecast,
        target: 'total_cost',
        modelLabel: 'Cost model',
        daily: [
          { date: '2026-01-11', yhat: 5, yhat_lower: 4, yhat_upper: 6, step: 1, horizon_bucket: '30d' },
        ],
      },
    },
  });
}

/** Opens the Export panel and returns the analytics fieldset's checkboxes. */
async function openExportPanel() {
  await userEvent.click(screen.getByRole('button', { name: 'Export…' }));
}

/** Checks the "Forecasts" analytic and clicks Export. */
async function exportForecastsCsv() {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Forecasts' }));
  await userEvent.click(screen.getByRole('button', { name: 'Export' }));
}

/** Every row across every CSV `downloadBlob` call so far, decoded and parsed. */
async function csvRowsWritten(): Promise<string[]> {
  const rows: string[] = [];
  for (const call of downloadBlobMock.mock.calls) {
    const blob = call[0] as Blob;
    const text = await blob.text();
    rows.push(...text.split('\n').slice(1).filter((line) => line.length > 0));
  }
  return rows;
}

describe('App export wiring', () => {
  it('renders the Export Center and its analytics list reflects the payload', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();
    await openExportPanel();

    // `fullPayload()` has a `call_volume` forecast and non-empty `hourly`, so
    // these are offered; it has no evaluations, no monthly rows and no
    // explanations, so those analytics are not.
    expect(screen.getByRole('checkbox', { name: 'Forecasts' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Arrivals heatmap' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Anomalies' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Monthly cost' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Model comparison' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Feature importance' })).not.toBeInTheDocument();
  });

  it('respects the current model selection: #model=total_cost covers only that target', async () => {
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    window.location.hash = '#model=total_cost';
    await renderApp();
    await openExportPanel();
    await exportForecastsCsv();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const rows = await csvRowsWritten();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.startsWith('total_cost,'))).toBe(true);
  });

  it('respects "All Models": no fragment covers every target', async () => {
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    await renderApp();
    await openExportPanel();
    await exportForecastsCsv();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const rows = await csvRowsWritten();
    expect(rows.some((row) => row.startsWith('call_volume,'))).toBe(true);
    expect(rows.some((row) => row.startsWith('total_cost,'))).toBe(true);
  });

  it('exports after switching models: the second export reflects the second selection', async () => {
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    await renderApp();

    // First export, under `call_volume`.
    const volumeTab = await screen.findByRole('button', { name: /Call volume/ });
    await userEvent.click(volumeTab);
    await waitFor(() => expect(window.location.hash).toBe('#model=call_volume'));
    await openExportPanel();
    await exportForecastsCsv();
    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const firstRows = await csvRowsWritten();
    expect(firstRows.every((row) => row.startsWith('call_volume,'))).toBe(true);

    // Dismiss the notification, switch targets, and export again. If the
    // export handler had closed over the first render's `selection`, this
    // second call would still produce `call_volume` rows.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    const costTab = await screen.findByRole('button', { name: /Daily cost/ });
    await userEvent.click(costTab);
    await waitFor(() => expect(window.location.hash).toBe('#model=total_cost'));
    // "Forecasts" is already checked from the first export — click Export
    // directly rather than toggling it off.
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(2));
    const secondCallBlob = downloadBlobMock.mock.calls[1]![0] as Blob;
    const secondText = await secondCallBlob.text();
    const secondRows = secondText.split('\n').slice(1).filter((line) => line.length > 0);
    expect(secondRows.every((row) => row.startsWith('total_cost,'))).toBe(true);
  });

  it('respects the horizon: #horizon=30 trims what an export contains', async () => {
    const wide = fullPayload({
      forecasts: {
        call_volume: {
          ...fullPayload().forecasts['call_volume']!,
          horizons: [
            { days: 30, measure: 'total', forecast: 300, lower: 250, upper: 350 },
            { days: 90, measure: 'total', forecast: 900, lower: 800, upper: 1000 },
          ],
          daily: [
            { date: '2026-01-11', yhat: 10, yhat_lower: 8, yhat_upper: 12, step: 1, horizon_bucket: '30d' },
            { date: '2026-03-11', yhat: 11, yhat_lower: 9, yhat_upper: 13, step: 60, horizon_bucket: '90d' },
          ],
        },
      },
      config: config({ targets: ['call_volume'], horizons: [30, 90] }),
    });
    loadResult = { payload: wide, source: 'fixture' };
    window.location.hash = '#horizon=30';
    await renderApp();
    await openExportPanel();
    await exportForecastsCsv();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    const rows = await csvRowsWritten();
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain('2026-01-11');
  });

  it('never writes to the hash when exporting, and leaves navigation working afterwards', async () => {
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    window.location.hash = '#model=call_volume';
    await renderApp();
    await openExportPanel();
    await exportForecastsCsv();

    await waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe('#model=call_volume');

    // The rail still works after an export.
    const costTab = await screen.findByRole('button', { name: /Daily cost/ });
    await userEvent.click(costTab);
    await waitFor(() => expect(window.location.hash).toBe('#model=total_cost'));
  });

  it('narrows the offered analytics after a CSV import sets analysisAvailable: false', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();
    await openExportPanel();
    expect(screen.getByRole('checkbox', { name: 'Forecasts' })).toBeInTheDocument();

    await fireImport(csvPayload(), preview('raw_calls.csv'));

    await waitFor(() =>
      expect(screen.getByText('Active source: raw_calls.csv')).toBeInTheDocument(),
    );

    /*
     * The panel is still open, and it must not need reopening.
     *
     * This test used to reopen it here, under a comment explaining that dropping
     * the rail "changes `AppShell`'s layout structurally and remounts the report
     * subtree". That remount was a bug being accommodated, not a property worth
     * keeping: PR 19 made the layout wrapper unconditional so `main` holds its
     * position in the tree, and the report now survives the rail coming and
     * going. Asserting the panel stayed open is what holds that — if the
     * remount ever returns, this fails instead of being worked around again.
     */
    // The trigger relabels to "Close export panel" while open, so its presence
    // under that name *is* the assertion that the panel survived the import.
    expect(screen.getByRole('button', { name: 'Close export panel' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // `forecasts` `requiresAnalysis`, so it drops out once the import is a
    // raw CSV; `Arrivals heatmap` does not require analysis and, since the
    // CSV fixture still carries `hourly` rows, stays offered.
    expect(screen.queryByRole('checkbox', { name: 'Forecasts' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Arrivals heatmap' })).toBeInTheDocument();
  });

  it('clears a stale outcome when the selection changes', async () => {
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    await renderApp();
    await openExportPanel();
    await exportForecastsCsv();

    // The outcome renders twice by design (announced in the live region, shown
    // in the Callout), so this asserts on the live region specifically.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Exported 1 file/));

    const costTab = await screen.findByRole('button', { name: /Daily cost/ });
    await userEvent.click(costTab);

    await waitFor(() => {
      expect(screen.getByRole('status')).not.toHaveTextContent(/Exported 1 file/);
    });
  });

  it('surfaces a whole-run export failure to the reader', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderApp();
    forceExportThrow = new Error('disk is full');
    await openExportPanel();
    await exportForecastsCsv();

    expect(await screen.findByText('disk is full')).toBeInTheDocument();
  });
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

/**
 * The landing experience.
 *
 * The application opens on a welcome screen and the report mounts only once
 * the reader chooses to enter — except for a link that already names a view,
 * which must arrive where it points. Nothing here may write the fragment.
 */
describe('App landing experience', () => {
  /** Render without entering, unlike the shared `renderApp()` helper above. */
  async function renderRaw() {
    const { App } = await import('./App');
    const { ThemeProvider } = await import('./theme/ThemeProvider');
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  }

  it('opens on the landing page rather than the dashboard', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    expect(await screen.findByRole('heading', { level: 1, name: 'Call Analytics Forecast' }))
      .toBeInTheDocument();
    // The report's own furniture is absent, not merely hidden.
    expect(screen.queryByRole('button', { name: 'fire import' })).not.toBeInTheDocument();
    expect(screen.queryByText(/at a glance/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Models' })).not.toBeInTheDocument();
  });

  it('renders the dashboard once the reader enters', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    await userEvent.click(await screen.findByRole('button', { name: 'Open dashboard' }));

    expect(await screen.findByRole('button', { name: 'fire import' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Models' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import Dashboard' })).not.toBeInTheDocument();
  });

  it('enters and takes the reader to the import panel on the primary action', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    await userEvent.click(await screen.findByRole('button', { name: 'Import Dashboard' }));

    const section = document.getElementById('data-source');
    expect(section).not.toBeNull();
    // Focus lands on the panel's first control, not at the top of the page.
    expect(section?.querySelector('button')).toHaveFocus();
  });

  it('never writes to the fragment when entering', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    await userEvent.click(await screen.findByRole('button', { name: 'Open dashboard' }));

    expect(window.location.hash).toBe('');
  });

  it('lets a selection deep link past the landing page', async () => {
    window.location.hash = '#model=call_volume';
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    expect(await screen.findByRole('button', { name: 'fire import' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open dashboard' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#model=call_volume');
  });

  it('lets a documentation deep link past the landing page', async () => {
    window.location.hash = '#view=docs';
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    expect(await screen.findByRole('button', { name: /back to report/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open dashboard' })).not.toBeInTheDocument();
  });

  it('opening the docs from the landing page lands on the report when leaving them', async () => {
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    await userEvent.click(await screen.findByRole('button', { name: /Documentation & about/i }));
    expect(window.location.hash).toBe('#view=docs');

    await userEvent.click(await screen.findByRole('button', { name: /back to report/i }));

    // Not back to the welcome screen: the reader has already answered the
    // question it asks, and the control they pressed says "report".
    expect(await screen.findByRole('button', { name: 'fire import' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});

/**
 * The landing gate is one-directional.
 *
 * `deepLink` describes the *current* fragment and the fragment is cleared in
 * ordinary use — "All" on the rail drops `model=`, leaving the docs drops
 * `view=`. A reader who has entered must never be ejected by either.
 */
describe('App landing gate is one-directional', () => {
  async function renderRaw() {
    const { App } = await import('./App');
    const { ThemeProvider } = await import('./theme/ThemeProvider');
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );
  }

  it('keeps a deep-linked reader in the report when they clear the selection', async () => {
    window.location.hash = '#model=call_volume';
    loadResult = { payload: twoTargetPayload(), source: 'fixture' };
    await renderRaw();

    await screen.findByRole('button', { name: 'fire import' });
    await userEvent.click(screen.getByRole('button', { name: 'All' }));

    // The fragment is empty again — and the reader is still in the report.
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(screen.getByRole('button', { name: 'fire import' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open dashboard' })).not.toBeInTheDocument();
  });

  it('keeps a deep-linked docs reader in the report when they leave the docs', async () => {
    window.location.hash = '#view=docs';
    loadResult = { payload: fullPayload(), source: 'fixture' };
    await renderRaw();

    await userEvent.click(await screen.findByRole('button', { name: /back to report/i }));

    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await screen.findByRole('button', { name: 'fire import' })).toBeInTheDocument();
  });
});
