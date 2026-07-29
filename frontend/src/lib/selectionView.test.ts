/**
 * The selection-to-payload derivation, tested without a DOM.
 *
 * These are the rules the whole dashboard now agrees on — what a horizon trims,
 * which rollup a tile quotes, and which anomalies belong to a target. Pinning
 * them here is what lets each section be a thin caller rather than a fourth
 * copy of the filter.
 */

import { describe, expect, it } from 'vitest';
import {
  headlineRollup,
  isAnomalyVisible,
  selectAnomalies,
  trimDaily,
  trimHorizons,
} from './selectionView';
import type {
  AnomalyRow,
  AnomalySection,
  ForecastDayRow,
  ForecastSection,
  HorizonRollup,
} from '../data/types';

const ROLLUPS: HorizonRollup[] = [
  { days: 30, measure: 'total', forecast: 100, lower: 90, upper: 110 },
  { days: 60, measure: 'total', forecast: 200, lower: 180, upper: 220 },
  { days: 90, measure: 'total', forecast: 300, lower: 270, upper: 330 },
];

const DAILY: ForecastDayRow[] = [
  { date: '2026-01-01', yhat: 1, yhat_lower: 0, yhat_upper: 2, step: 30, horizon_bucket: '30d' },
  { date: '2026-02-01', yhat: 2, yhat_lower: 1, yhat_upper: 3, step: 60, horizon_bucket: '60d' },
  { date: '2026-03-01', yhat: 3, yhat_lower: 2, yhat_upper: 4, step: 90, horizon_bucket: '90d' },
];

function forecast(overrides: Partial<ForecastSection> = {}): ForecastSection {
  return {
    target: 'call_volume',
    model: 'random_forest',
    modelLabel: 'Random Forest',
    intervalLevel: 0.9,
    calibrated: true,
    aggregate: 'sum',
    notes: [],
    horizons: ROLLUPS,
    daily: DAILY,
    monthly: [],
    ...overrides,
  };
}

function anomaly(metric: string, rule: string, severity: AnomalyRow['severity']): AnomalyRow {
  return {
    date: '2026-01-01',
    rule,
    metric,
    actual: 1,
    expected: 2,
    deviation: -1,
    severity,
    message: `${rule} on ${metric}`,
  };
}

const ANOMALIES: AnomalySection = {
  items: [
    anomaly('total_cost', 'cost_overrun', 'critical'),
    anomaly('total_cost', 'cost_overrun', 'warning'),
    anomaly('call_volume', 'statistical_outlier', 'critical'),
    anomaly('avg_duration_sec', 'duration_spike', 'warning'),
    anomaly('overnight_calls', 'overnight_activity', 'info'),
  ],
  byRule: [
    { rule: 'cost_overrun', severity: 'critical', count: 1 },
    { rule: 'cost_overrun', severity: 'warning', count: 1 },
    { rule: 'statistical_outlier', severity: 'critical', count: 1 },
    { rule: 'duration_spike', severity: 'warning', count: 1 },
    { rule: 'overnight_activity', severity: 'info', count: 1 },
  ],
  notes: ['a note'],
  counts: { critical: 2, warning: 2, info: 1 },
};

describe('trimDaily / trimHorizons', () => {
  it('keeps rows at or under the horizon', () => {
    expect(trimDaily(DAILY, 60).map((row) => row.step)).toEqual([30, 60]);
    expect(trimHorizons(ROLLUPS, 60).map((row) => row.days)).toEqual([30, 60]);
  });

  it('keeps everything at an infinite horizon — a run with none configured', () => {
    expect(trimDaily(DAILY, Number.POSITIVE_INFINITY)).toHaveLength(3);
    expect(trimHorizons(ROLLUPS, Number.POSITIVE_INFINITY)).toHaveLength(3);
  });
});

describe('headlineRollup', () => {
  it('quotes the preferred 30-day row at the default horizon', () => {
    expect(headlineRollup(forecast(), 90, 30)?.days).toBe(30);
  });

  it('never quotes a period the forecast cards have trimmed away', () => {
    const trimmed = forecast({
      horizons: [{ days: 7, measure: 'total', forecast: 10, lower: 9, upper: 11 }, ...ROLLUPS],
    });
    // The reader asked for 7 days; a 30-day tile beside a 7-day card is the
    // stale number this whole change exists to remove.
    expect(headlineRollup(trimmed, 7, 30)?.days).toBe(7);
  });

  it('falls back to the longest eligible row when the preferred one is absent', () => {
    const noThirty = forecast({ horizons: ROLLUPS.slice(1) });
    expect(headlineRollup(noThirty, 90, 30)?.days).toBe(90);
  });

  it('is undefined for a target that produced no forecast', () => {
    expect(headlineRollup(undefined, 90, 30)).toBeUndefined();
  });

  it('is undefined when nothing survives the horizon', () => {
    expect(headlineRollup(forecast(), 7, 30)).toBeUndefined();
  });
});

describe('isAnomalyVisible', () => {
  it('matches on metric, and shows everything under All', () => {
    const item = anomaly('total_cost', 'cost_overrun', 'critical');
    expect(isAnomalyVisible(item, null)).toBe(true);
    expect(isAnomalyVisible(item, 'total_cost')).toBe(true);
    expect(isAnomalyVisible(item, 'call_volume')).toBe(false);
  });
});

describe('selectAnomalies', () => {
  it('returns the payload section unchanged under All', () => {
    expect(selectAnomalies(ANOMALIES, null)).toBe(ANOMALIES);
  });

  it('recomputes counts from the surviving items', () => {
    const scoped = selectAnomalies(ANOMALIES, 'total_cost');

    expect(scoped.items).toHaveLength(2);
    expect(scoped.counts).toEqual({ critical: 1, warning: 1, info: 0 });
  });

  it('drops rule tallies with no surviving items and keeps payload order', () => {
    const scoped = selectAnomalies(ANOMALIES, 'total_cost');

    expect(scoped.byRule.map((row) => `${row.rule}:${row.severity}`)).toEqual([
      'cost_overrun:critical',
      'cost_overrun:warning',
    ]);
  });

  it('drops overnight activity, which belongs to no target', () => {
    for (const target of ['call_volume', 'avg_duration_sec', 'total_cost']) {
      const scoped = selectAnomalies(ANOMALIES, target);
      expect(scoped.items.some((item) => item.metric === 'overnight_calls')).toBe(false);
    }
  });

  it('leaves the source section untouched', () => {
    selectAnomalies(ANOMALIES, 'total_cost');

    expect(ANOMALIES.items).toHaveLength(5);
    expect(ANOMALIES.counts).toEqual({ critical: 2, warning: 2, info: 1 });
  });

  it('zeroes out cleanly for a target with no anomalies', () => {
    const scoped = selectAnomalies(ANOMALIES, 'nothing_flagged');

    expect(scoped.items).toEqual([]);
    expect(scoped.byRule).toEqual([]);
    expect(scoped.counts).toEqual({ critical: 0, warning: 0, info: 0 });
    // Notes are the section's own commentary, not a per-item fact.
    expect(scoped.notes).toEqual(['a note']);
  });
});
