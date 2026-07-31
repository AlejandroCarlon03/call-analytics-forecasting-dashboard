import { describe, it, expect } from 'vitest';
import { buildPreviewFields } from './previewMetadata';
import type { PreviewField } from './previewMetadata';
import type { ImportPreview } from './types';
import type { DashboardPayload } from '../../data/types';
import { EXPECTED_SCHEMA_VERSION } from '../../data/types';

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    kind: 'payload',
    fileName: 'dashboard_data.json',
    fileSize: 275_235,
    rowsRead: 172,
    rowsKept: 172,
    dropped: {},
    dateMin: '2026-05-01',
    dateMax: '2026-07-13',
    columnMap: {},
    ignoredColumns: [],
    sampleDaily: [],
    warnings: [],
    ...overrides,
  };
}

function payload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    generatedAt: '2026-07-13T09:41:00',
    ingestion: {
      files: ['export.csv'],
      rows_read: 172,
      rows_kept: 172,
      dropped: {},
      warnings: [],
      missing_columns: [],
      date_min: '2026-05-01',
      date_max: '2026-07-13',
      active_days: 32,
      calendar_days: 74,
      coverage_pct: 43,
    },
    config: {
      forecast: { horizons: [30, 60, 90], interval_level: 0.8, n_simulations: 1000, targets: [] },
      cv: { horizon: 7, step: 1, initial_train_days: 30, min_folds: 3, selection_metric: 'mase', selection_tiebreaker: 'mae' },
      data: { holiday_country: 'US', holiday_subdiv: null },
      business_hours: { start_hour: 8, end_hour: 17, overnight_start_hour: 0, overnight_end_hour: 0 },
      anomalies: { cost_overrun_pct: 0, duration_sigma: 0, missed_spike_sigma: 0, robust_z_threshold: 0, baseline_window_days: 0 },
      scenarios: { current_agents: 1, target_answer_seconds: 30, service_level_pct: 80, staffed_hours_per_day: 9 },
      models: { enabled: ['seasonal_naive', 'random_forest'] },
    },
    targets: ['call_volume'],
    targetMeta: {},
    forecasts: {},
    evaluations: {
      call_volume: {
        target: 'call_volume',
        bestModel: 'random_forest',
        selectionMetric: 'mase',
        nFolds: 24,
        horizon: 7,
        notes: [],
        leaderboard: [
          { model: 'random_forest', label: 'Random Forest', status: 'ok', selected: true, n_folds: 24, fit_seconds: 1, mae: 3, rmse: 4, r2: 0.1, mape: null, mape_n: null, smape: null, mase: 0.8, bias: 0 },
          { model: 'ridge', label: 'Linear Regression (ridge)', status: 'ok', selected: false, n_folds: 24, fit_seconds: 1, mae: 4, rmse: 5, r2: 0, mape: null, mape_n: null, smape: null, mase: 0.9, bias: 0 },
        ],
      },
    },
    explanations: {},
    daily: [],
    hourly: [],
    anomalies: { items: [], byRule: [], notes: [], counts: { critical: 0, warning: 0, info: 0 } },
    scenarios: { rows: [], notes: [] },
    ...overrides,
  };
}

function field(fields: PreviewField[], label: string): PreviewField {
  const found = fields.find((f) => f.label === label);
  if (!found) throw new Error(`no field "${label}"`);
  return found;
}

describe('buildPreviewFields', () => {
  it('returns the six fields in a fixed reading order', () => {
    const fields = buildPreviewFields(preview(), payload());
    expect(fields.map((f) => f.label)).toEqual([
      'Dashboard Name',
      'Generation Time',
      'Forecast Horizon',
      'Available Models',
      'Reporting Period',
      'Dataset Size',
    ]);
  });

  it('never emits an empty value', () => {
    const fields = buildPreviewFields(preview({ kind: 'csv' }), payload());
    for (const f of fields) expect(f.value.trim().length).toBeGreaterThan(0);
  });

  describe('payload import', () => {
    it('names the dashboard from the file name', () => {
      const fields = buildPreviewFields(preview({ fileName: 'run_july.json' }), payload());
      expect(field(fields, 'Dashboard Name').value).toBe('run_july.json');
    });

    it('formats the generation time from the payload', () => {
      const fields = buildPreviewFields(preview(), payload());
      const gen = field(fields, 'Generation Time');
      expect(gen.available).toBe(true);
      expect(gen.value).toMatch(/13 Jul 2026, 09:41/);
    });

    it('lists the forecast horizons with a unit', () => {
      const fields = buildPreviewFields(preview(), payload());
      expect(field(fields, 'Forecast Horizon').value).toBe('30, 60, 90 days');
    });

    it('prefers human leaderboard labels for the models, de-duplicated', () => {
      const fields = buildPreviewFields(preview(), payload());
      expect(field(fields, 'Available Models').value).toBe('Random Forest, Linear Regression (ridge)');
    });

    it('falls back to configured model keys when no evaluation ran', () => {
      const fields = buildPreviewFields(preview(), payload({ evaluations: {} }));
      expect(field(fields, 'Available Models').value).toBe('seasonal_naive, random_forest');
    });

    it('shows the reporting period as a formatted date range', () => {
      const fields = buildPreviewFields(preview(), payload());
      expect(field(fields, 'Reporting Period').value).toBe('01 May 2026 – 13 Jul 2026');
    });

    it('reports rows, calendar days and a human file size for the dataset', () => {
      const fields = buildPreviewFields(preview(), payload());
      expect(field(fields, 'Dataset Size').value).toBe('172 rows · 74 days · 268.8 KB');
    });
  });

  describe('csv import — honest placeholders, never fabricated zeros', () => {
    it('marks generation time, horizon and models unavailable', () => {
      const fields = buildPreviewFields(preview({ kind: 'csv' }), payload());
      for (const label of ['Generation Time', 'Forecast Horizon', 'Available Models']) {
        const f = field(fields, label);
        expect(f.available).toBe(false);
        expect(f.value).toMatch(/not applicable/i);
      }
    });

    it('never reads the placeholder config zeros as real values', () => {
      // A CSV payload carries config: placeholderConfig() (all zeros) and a
      // generatedAt of import time — the §19 footer trap. None of it may surface.
      const csvish = payload({
        generatedAt: '2026-07-31T12:00:00',
        config: { ...payload().config, forecast: { horizons: [], interval_level: 0, n_simulations: 0, targets: [] }, models: { enabled: [] } },
        evaluations: {},
      });
      const fields = buildPreviewFields(preview({ kind: 'csv' }), csvish);
      expect(field(fields, 'Forecast Horizon').value).not.toMatch(/0/);
      expect(field(fields, 'Generation Time').value).not.toMatch(/2026/);
    });

    it('still reports the reporting period and dataset size — a CSV has both', () => {
      const fields = buildPreviewFields(preview({ kind: 'csv', fileSize: 12_345 }), payload());
      expect(field(fields, 'Reporting Period').available).toBe(true);
      expect(field(fields, 'Reporting Period').value).toBe('01 May 2026 – 13 Jul 2026');
      expect(field(fields, 'Dataset Size').value).toContain('12.1 KB');
    });
  });

  describe('missing / malformed metadata degrades to a placeholder, never throws', () => {
    it('handles a payload-route import with no config or evaluations', () => {
      const bare = { generatedAt: '', ingestion: undefined } as unknown as DashboardPayload;
      const fields = buildPreviewFields(preview(), bare);
      expect(field(fields, 'Forecast Horizon').value).toBe('Unknown');
      expect(field(fields, 'Available Models').value).toBe('Unknown');
      expect(field(fields, 'Generation Time').available).toBe(false);
    });

    it('reports no reporting period when the span is missing', () => {
      const fields = buildPreviewFields(preview({ dateMin: null, dateMax: null }), payload());
      const rp = field(fields, 'Reporting Period');
      expect(rp.available).toBe(false);
      expect(rp.value).toMatch(/no dated rows/i);
    });

    it('omits the day count from Dataset Size when calendar_days is absent', () => {
      const noDays = payload();
      noDays.ingestion = { ...noDays.ingestion, calendar_days: 0 };
      const fields = buildPreviewFields(preview({ rowsKept: 1 }), noDays);
      expect(field(fields, 'Dataset Size').value).toBe('1 row · 268.8 KB');
    });
  });

  it('formats bytes across unit boundaries', () => {
    expect(field(buildPreviewFields(preview({ fileSize: 900 }), payload()), 'Dataset Size').value).toContain('900 B');
    expect(field(buildPreviewFields(preview({ fileSize: 2_500_000 }), payload()), 'Dataset Size').value).toContain('2.4 MB');
  });
});
