// @vitest-environment jsdom

/**
 * `runExport` calls `toPng`, which touches `Plotly.toImage`, so this file
 * needs jsdom + the Plotly mock even for the csv/json branches — vitest
 * environment is per-file, not per-test.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('plotly.js-cartesian-dist-min', () => ({
  default: { react: vi.fn(), purge: vi.fn(), toImage: vi.fn() },
}));

import Plotly from 'plotly.js-cartesian-dist-min';
import { runExport } from './runExport';
import { TEST_PALETTE } from '../chart/testPalette';
import fixture from '../../data/fixtures/dashboard_data.json';
import type { DashboardPayload } from '../../data/types';
import type { ExportContext } from './types';

const payload = fixture as unknown as DashboardPayload;
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function ctx(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    payload,
    selection: { target: null, horizon: 90 },
    analysisAvailable: true,
    palette: TEST_PALETTE,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(Plotly.toImage).mockResolvedValue(TINY_PNG_DATA_URL);
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(
    () => 'blob:fake-url',
  );
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('runExport', () => {
  it('csv: writes one file per selected analytic', async () => {
    const outcome = await runExport(
      { analytics: ['forecasts', 'anomalies'], format: 'csv' },
      ctx(),
    );
    expect(outcome.artifacts.length).toBe(2);
    expect(outcome.problems).toEqual([]);
    expect(outcome.artifacts.every((a) => a.fileName.endsWith('.csv'))).toBe(true);
  });

  it('json: writes exactly one file for the whole request', async () => {
    const outcome = await runExport(
      { analytics: ['forecasts', 'anomalies', 'heatmap'], format: 'json' },
      ctx(),
    );
    expect(outcome.artifacts.length).toBe(1);
    expect(outcome.artifacts[0]!.fileName.endsWith('.json')).toBe(true);
  });

  it('png: writes one file per figure across all selected analytics', async () => {
    const outcome = await runExport({ analytics: ['forecasts'], format: 'png' }, ctx());
    // The fixture has 3 targets, so `forecasts` should yield 3 PNGs.
    expect(outcome.artifacts.length).toBe(payload.targets.length);
    expect(outcome.artifacts.every((a) => a.fileName.endsWith('.png'))).toBe(true);
  });

  it('accumulates a per-analytic problem for an empty slice while other analytics still download', async () => {
    const outcome = await runExport(
      { analytics: ['monthlyCost', 'forecasts'], format: 'csv' },
      ctx({ selection: { target: 'call_volume', horizon: 90 } }),
    );
    // monthlyCost has no rows under a call_volume-only selection.
    expect(outcome.problems.some((p) => p.analytic === 'monthlyCost')).toBe(true);
    expect(outcome.artifacts.some((a) => a.fileName.includes('forecasts'))).toBe(true);
  });

  it('never throws for a per-analytic failure — only a whole-run failure would propagate', async () => {
    await expect(
      runExport({ analytics: ['forecasts'], format: 'csv' }, ctx()),
    ).resolves.toBeDefined();
  });
});
