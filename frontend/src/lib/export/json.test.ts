import { describe, expect, it } from 'vitest';
import { toJson } from './json';
import { TEST_PALETTE } from '../chart/testPalette';
import fixture from '../../data/fixtures/dashboard_data.json';
import type { DashboardPayload } from '../../data/types';
import type { AnalyticExport, ExportContext } from './types';
import { analyticById } from './types';

const payload = fixture as unknown as DashboardPayload;

function ctx(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    payload,
    selection: { target: null, horizon: 90 },
    analysisAvailable: true,
    palette: TEST_PALETTE,
    ...overrides,
  };
}

function fakeExport(id: 'forecasts' | 'anomalies'): AnalyticExport {
  return {
    id,
    descriptor: analyticById(id),
    table: { columns: ['a'], rows: [{ a: 1 }] },
    json: { hello: 'world' },
    figures: [],
  };
}

describe('toJson', () => {
  it('wraps analytics in a meta envelope with generatedAt, exportedAt, schemaVersion and selection', () => {
    const doc = JSON.parse(toJson([fakeExport('forecasts')], ctx()));
    expect(doc.meta.generatedAt).toBe(payload.generatedAt);
    expect(typeof doc.meta.exportedAt).toBe('string');
    expect(typeof doc.meta.schemaVersion).toBe('number');
    expect(doc.meta.selection).toEqual({ target: null, horizon: 90 });
    expect(doc.meta.analytics).toEqual(['forecasts']);
    expect(doc.analytics.forecasts).toEqual({ hello: 'world' });
  });

  it('is pretty-printed with 2-space indent', () => {
    const text = toJson([fakeExport('forecasts')], ctx());
    expect(text).toContain('\n  "meta"');
  });

  it('serializes an Infinity horizon (no configured horizons) as null', () => {
    const text = toJson([fakeExport('forecasts')], ctx({ selection: { target: null, horizon: Number.POSITIVE_INFINITY } }));
    const doc = JSON.parse(text);
    expect(doc.meta.selection.horizon).toBeNull();
  });

  it('carries one entry per requested analytic, in request order', () => {
    const doc = JSON.parse(toJson([fakeExport('anomalies'), fakeExport('forecasts')], ctx()));
    expect(doc.meta.analytics).toEqual(['anomalies', 'forecasts']);
    expect(Object.keys(doc.analytics)).toEqual(['anomalies', 'forecasts']);
  });
});
