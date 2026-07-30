import { describe, it, expect } from 'vitest';
import { buildFromPayloadJson } from './buildFromPayloadJson';
import { EXPECTED_SCHEMA_VERSION } from '../../data/types';

function minimalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    ingestion: {
      files: ['a.csv'],
      rows_read: 10,
      rows_kept: 10,
      dropped: {},
      warnings: [],
      missing_columns: [],
      date_min: '2026-01-01',
      date_max: '2026-01-05',
      active_days: 5,
      calendar_days: 5,
      coverage_pct: 100,
    },
    config: {},
    targets: ['call_volume'],
    targetMeta: {},
    forecasts: {},
    evaluations: {},
    explanations: {},
    daily: [{ date: '2026-01-01', call_volume: 3, avg_duration_sec: 90, total_cost: 1 }],
    hourly: [],
    anomalies: { items: [], byRule: [], notes: [], counts: { critical: 0, warning: 0, info: 0 } },
    scenarios: { rows: [], notes: [] },
    ...overrides,
  };
}

describe('buildFromPayloadJson', () => {
  it('rejects invalid JSON', () => {
    const result = buildFromPayloadJson('{not json', 'x.json', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/not valid json/i);
  });

  it('rejects a JSON array at the top level', () => {
    const result = buildFromPayloadJson('[]', 'x.json', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/not an object/i);
  });

  it('rejects JSON with no daily array', () => {
    const result = buildFromPayloadJson(JSON.stringify({ schemaVersion: 1 }), 'x.json', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/daily/i);
  });

  it('rejects JSON with no ingestion object', () => {
    const payload = minimalPayload();
    delete payload.ingestion;
    const result = buildFromPayloadJson(JSON.stringify(payload), 'x.json', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/ingestion/i);
  });

  it('accepts a well-formed payload', () => {
    const result = buildFromPayloadJson(JSON.stringify(minimalPayload()), 'dashboard_data.json', 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.kind).toBe('payload');
    expect(result.preview.rowsRead).toBe(10);
    expect(result.preview.warnings).toEqual([]);
  });

  it('warns, but does not fail, on a schema version mismatch', () => {
    const payload = minimalPayload({ schemaVersion: EXPECTED_SCHEMA_VERSION + 1 });
    const result = buildFromPayloadJson(JSON.stringify(payload), 'x.json', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.warnings.length).toBe(1);
    expect(result.preview.warnings[0]?.message).toMatch(/schema version/i);
  });
});
