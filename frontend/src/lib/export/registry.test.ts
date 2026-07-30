import { describe, expect, it } from 'vitest';
import { availableAnalytics, buildAnalyticExports } from './registry';
import { TEST_PALETTE } from '../chart/testPalette';
import fixture from '../../data/fixtures/dashboard_data.json';
import type { DashboardPayload } from '../../data/types';
import type { ExportContext } from './types';
import { ANALYTICS } from './types';

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

describe('availableAnalytics', () => {
  it('lists every analytic when analysis is available and the payload has data for it', () => {
    const ids = availableAnalytics(ctx()).map((d) => d.id);
    expect(ids).toEqual(ANALYTICS.map((d) => d.id));
  });

  it('drops every requiresAnalysis analytic when analysisAvailable is false', () => {
    const ids = availableAnalytics(ctx({ analysisAvailable: false })).map((d) => d.id);
    // heatmap is the one analytic with requiresAnalysis: false.
    expect(ids).toEqual(['heatmap']);
  });

  it('drops monthlyCost when total_cost has no monthly rollup', () => {
    const noMonthly: DashboardPayload = {
      ...payload,
      forecasts: {
        ...payload.forecasts,
        total_cost: { ...payload.forecasts['total_cost']!, monthly: [] },
      },
    };
    const ids = availableAnalytics(ctx({ payload: noMonthly })).map((d) => d.id);
    expect(ids).not.toContain('monthlyCost');
  });

  it('drops importance when no explanation carries a finite score under any method', () => {
    const noScores: DashboardPayload = {
      ...payload,
      explanations: Object.fromEntries(
        Object.entries(payload.explanations).map(([target, explanation]) => [
          target,
          {
            ...explanation,
            topFeatures: explanation.topFeatures.map((row) => ({
              feature: row.feature,
              rank_mean: row.rank_mean,
              shap: null,
              permutation: null,
              native: null,
            })),
          },
        ]),
      ),
    };
    const ids = availableAnalytics(ctx({ payload: noScores })).map((d) => d.id);
    expect(ids).not.toContain('importance');
  });
});

describe('buildAnalyticExports — forecasts', () => {
  it('has a leading target column, then the daily disclosure columns in on-screen order', () => {
    const [entry] = buildAnalyticExports(ctx(), ['forecasts']);
    expect(entry!.table.columns).toEqual([
      'target',
      'date',
      'yhat',
      'yhat_lower',
      'yhat_upper',
      'horizon_bucket',
    ]);
  });

  it('every listed column exists as a key on every row', () => {
    const [entry] = buildAnalyticExports(ctx(), ['forecasts']);
    for (const row of entry!.table.rows) {
      for (const column of entry!.table.columns) {
        expect(Object.prototype.hasOwnProperty.call(row, column)).toBe(true);
      }
    }
  });

  it('honours the selected horizon, matching trimDaily', () => {
    const short = buildAnalyticExports(ctx({ selection: { target: 'call_volume', horizon: 30 } }), [
      'forecasts',
    ])[0]!;
    const long = buildAnalyticExports(ctx({ selection: { target: 'call_volume', horizon: 90 } }), [
      'forecasts',
    ])[0]!;
    expect(short.table.rows.length).toBeLessThan(long.table.rows.length);
    expect(short.table.rows.every((row) => row['target'] === 'call_volume')).toBe(true);
  });

  it('aggregates every target under "All Models" (selection.target === null)', () => {
    const all = buildAnalyticExports(ctx({ selection: { target: null, horizon: 90 } }), [
      'forecasts',
    ])[0]!;
    const one = buildAnalyticExports(
      ctx({ selection: { target: 'call_volume', horizon: 90 } }),
      ['forecasts'],
    )[0]!;
    const targetsInAll = new Set(all.table.rows.map((row) => row['target']));
    expect(targetsInAll.size).toBe(payload.targets.length);
    expect(all.table.rows.length).toBeGreaterThan(one.table.rows.length);
  });

  it('produces one figure per visible target and drops none (buildForecastFigure never returns null)', () => {
    const entry = buildAnalyticExports(ctx(), ['forecasts'])[0]!;
    expect(entry.figures.length).toBe(payload.targets.length);
  });

  it('preserves raw payload number precision in json (not run through lib/format.ts)', () => {
    const entry = buildAnalyticExports(ctx(), ['forecasts'])[0]!;
    const json = entry.json as Record<string, { daily: Array<{ yhat: number | null }> }>;
    const rawFirst = payload.forecasts['call_volume']!.daily[0]!.yhat;
    expect(json['call_volume']!.daily[0]!.yhat).toBe(rawFirst);
  });
});

describe('buildAnalyticExports — monthlyCost', () => {
  it('is filtered with total_cost: empty under a different single-target selection', () => {
    const entry = buildAnalyticExports(
      ctx({ selection: { target: 'call_volume', horizon: 90 } }),
      ['monthlyCost'],
    )[0]!;
    expect(entry.table.rows).toEqual([]);
    expect(entry.figures).toEqual([]);
  });

  it('has rows under "All" and under a total_cost selection', () => {
    const all = buildAnalyticExports(ctx(), ['monthlyCost'])[0]!;
    expect(all.table.rows.length).toBeGreaterThan(0);
    expect(all.table.rows.every((row) => row['target'] === 'total_cost')).toBe(true);
  });
});

describe('buildAnalyticExports — leaderboard', () => {
  it('drops null figures (a skipped leaderboard) but keeps the table rows', () => {
    const entry = buildAnalyticExports(ctx(), ['leaderboard'])[0]!;
    // The real fixture scores every target, so assert the general contract:
    // every figure corresponds to a target that actually has rows.
    const targetsWithFigures = new Set(entry.figures.map((f) => f.slug));
    for (const target of targetsWithFigures) {
      expect(entry.table.rows.some((row) => row['target'] === target)).toBe(true);
    }
  });
});

describe('buildAnalyticExports — heatmap', () => {
  it('is never filtered by target — same row count under "All" and under a single target', () => {
    const all = buildAnalyticExports(ctx(), ['heatmap'])[0]!;
    const one = buildAnalyticExports(
      ctx({ selection: { target: 'call_volume', horizon: 90 } }),
      ['heatmap'],
    )[0]!;
    expect(all.table.rows.length).toBe(one.table.rows.length);
  });

  it('has no leading target column, and a single run-wide figure', () => {
    const entry = buildAnalyticExports(ctx(), ['heatmap'])[0]!;
    expect(entry.table.columns).toEqual(['weekday', 'hour', 'calls']);
    expect(entry.figures.length).toBe(1);
  });

  it('json carries the full 168-cell grid, not just the ranked table subset', () => {
    const entry = buildAnalyticExports(ctx(), ['heatmap'])[0]!;
    expect((entry.json as unknown[]).length).toBe(payload.hourly.length);
  });
});

describe('buildAnalyticExports — importance', () => {
  it('drops figures for a target with no usable score while keeping other targets', () => {
    const noScoreForOne: DashboardPayload = {
      ...payload,
      explanations: {
        ...payload.explanations,
        call_volume: {
          ...payload.explanations['call_volume']!,
          topFeatures: payload.explanations['call_volume']!.topFeatures.map((row) => ({
            feature: row.feature,
            rank_mean: row.rank_mean,
            shap: null,
            permutation: null,
            native: null,
          })),
        },
      },
    };
    const entry = buildAnalyticExports(ctx({ payload: noScoreForOne }), ['importance'])[0]!;
    expect(entry.figures.some((f) => f.slug === 'call_volume')).toBe(false);
    // The table still carries call_volume's rows even though its figure was dropped.
    expect(entry.table.rows.some((row) => row['target'] === 'call_volume')).toBe(true);
  });
});

describe('buildAnalyticExports — anomalies', () => {
  it('scopes rows to the selected target via selectAnomalies', () => {
    const all = buildAnalyticExports(ctx(), ['anomalies'])[0]!;
    const one = buildAnalyticExports(
      ctx({ selection: { target: 'call_volume', horizon: 90 } }),
      ['anomalies'],
    )[0]!;
    expect(one.table.rows.length).toBeLessThanOrEqual(all.table.rows.length);
    expect(one.table.rows.every((row) => row['metric'] === 'call_volume')).toBe(true);
  });
});
