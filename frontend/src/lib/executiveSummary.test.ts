/**
 * The executive summary's derivations.
 *
 * These are the assertions that matter most in this PR, and they are pure —
 * no DOM, no React. The section component only arranges what this module
 * returns, so "does the cost card follow the rail" and "does an absent
 * duration forecast produce a reason rather than a zero" are both questions
 * about this file.
 */

import { describe, expect, it } from 'vitest';
import { executiveMetrics, type ExecutiveMetric } from './executiveSummary';
import type {
  DailyRow,
  DashboardPayload,
  EvaluationSection,
  ForecastDayRow,
  ForecastSection,
  HorizonRollup,
  LeaderboardRow,
} from '../data/types';

// ---------------------------------------------------------------- builders --

function rollups(perDay: number, measure: 'total' | 'daily average' = 'total'): HorizonRollup[] {
  return [30, 60, 90].map((days) => {
    const forecast = measure === 'total' ? perDay * days : perDay;
    return { days, measure, forecast, lower: forecast * 0.9, upper: forecast * 1.1 };
  });
}

function dailyRows(perDay: number, peakAt: number, peakValue: number): ForecastDayRow[] {
  return Array.from({ length: 90 }, (_, index) => {
    const step = index + 1;
    const day = String(step).padStart(2, '0');
    return {
      // 90 sequential days starting 2026-03-01; only the first month is used by
      // the horizon-30 assertions, which is the point.
      date: `2026-03-${day <= '31' && step <= 31 ? day : '31'}`,
      yhat: step === peakAt ? peakValue : perDay,
      yhat_lower: null,
      yhat_upper: null,
      step,
      horizon_bucket: null,
    };
  });
}

function forecast(
  target: string,
  perDay: number,
  overrides: Partial<ForecastSection> = {},
): ForecastSection {
  return {
    target,
    model: 'random_forest',
    modelLabel: 'Random Forest',
    intervalLevel: 0.9,
    calibrated: true,
    aggregate: 'sum',
    notes: [],
    horizons: rollups(perDay),
    daily: dailyRows(perDay, 5, perDay * 3),
    monthly: [],
    ...overrides,
  };
}

function row(model: string, label: string, mase: number | null): LeaderboardRow {
  return {
    model,
    label,
    status: 'ok',
    selected: true,
    n_folds: 12,
    fit_seconds: 1,
    mae: 1,
    rmse: 1,
    r2: 0.5,
    mape: null,
    mape_n: null,
    smape: null,
    mase,
    bias: 0,
  };
}

function evaluation(target: string, best: string, rows: LeaderboardRow[]): EvaluationSection {
  return {
    target,
    bestModel: best,
    selectionMetric: 'mase',
    nFolds: 12,
    horizon: 7,
    notes: [],
    leaderboard: rows,
  };
}

/** 60 observed days at a flat level per target, so growth is computable. */
function history(levels: Record<string, number>): DailyRow[] {
  return Array.from({ length: 60 }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    call_volume: levels['call_volume'] ?? null,
    avg_duration_sec: levels['avg_duration_sec'] ?? null,
    total_cost: levels['total_cost'] ?? null,
  }));
}

function payloadWith(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    targets: ['call_volume', 'avg_duration_sec', 'total_cost'],
    targetMeta: {
      call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' },
      avg_duration_sec: { label: 'Avg duration', units: 'seconds', aggregate: 'mean' },
      total_cost: { label: 'Daily cost', units: 'USD', aggregate: 'sum' },
    },
    forecasts: {
      call_volume: forecast('call_volume', 10),
      total_cost: forecast('total_cost', 2),
      avg_duration_sec: forecast('avg_duration_sec', 120, {
        horizons: rollups(120, 'daily average'),
        aggregate: 'mean',
      }),
    },
    evaluations: {
      call_volume: evaluation('call_volume', 'random_forest', [
        row('random_forest', 'Random Forest', 0.79),
      ]),
      total_cost: evaluation('total_cost', 'ridge', [row('ridge', 'Linear Regression (ridge)', 1.36)]),
      avg_duration_sec: evaluation('avg_duration_sec', 'seasonal_naive', [
        row('seasonal_naive', 'Seasonal Naive', 0.9),
      ]),
    },
    daily: history({ call_volume: 10, avg_duration_sec: 120, total_cost: 2 }),
    anomalies: {
      items: [
        {
          date: '2026-02-11',
          rule: 'cost_overrun',
          metric: 'total_cost',
          actual: 10,
          expected: 5,
          deviation: 5,
          severity: 'critical',
          message: 'cost',
        },
        {
          date: '2026-02-12',
          rule: 'cost_overrun',
          metric: 'total_cost',
          actual: 10,
          expected: 5,
          deviation: 5,
          severity: 'critical',
          message: 'cost',
        },
        {
          date: '2026-01-04',
          rule: 'statistical_outlier',
          metric: 'call_volume',
          actual: 40,
          expected: 10,
          deviation: 30,
          severity: 'warning',
          message: 'volume',
        },
      ],
      byRule: [
        { rule: 'cost_overrun', severity: 'critical', count: 2 },
        { rule: 'statistical_outlier', severity: 'warning', count: 1 },
      ],
      notes: [],
      counts: { critical: 2, warning: 1, info: 0 },
    },
    ...overrides,
  } as unknown as DashboardPayload;
}

function summarise(
  overrides: {
    payload?: DashboardPayload;
    selectedTarget?: string | null;
    horizon?: number;
    analysisAvailable?: boolean;
  } = {},
): ExecutiveMetric[] {
  return executiveMetrics({
    payload: overrides.payload ?? payloadWith(),
    selectedTarget: overrides.selectedTarget ?? null,
    horizon: overrides.horizon ?? 90,
    analysisAvailable: overrides.analysisAvailable ?? true,
  });
}

function byId(metrics: ExecutiveMetric[], id: string): ExecutiveMetric | undefined {
  return metrics.find((metric) => metric.id === id);
}

// ------------------------------------------------------------------ tests --

describe('executiveMetrics', () => {
  it('renders the whole set under All', () => {
    const ids = summarise().map((metric) => metric.id);

    expect(ids).toEqual([
      'forecast-calls',
      'forecast-cost',
      'forecast-duration',
      'best-model',
      'horizon',
      'growth',
      'peak-day',
      'risk-period',
    ]);
  });

  it('keeps the order fixed so a card does not move between selections', () => {
    const all = summarise().map((metric) => metric.id);
    const filtered = summarise({ selectedTarget: 'total_cost' }).map((metric) => metric.id);

    // The survivors appear in the same relative order they had under All.
    expect(all.filter((id) => filtered.includes(id))).toEqual(filtered);
  });

  it('quotes the preferred 30-day rollup when the reader has not narrowed past it', () => {
    const calls = byId(summarise(), 'forecast-calls');

    expect(calls?.value).toBe('300');
    expect(calls?.detail).toContain('next 30 days');
    expect(calls?.detail).toContain('at 90%');
  });

  it('never quotes a horizon the forecast cards have trimmed away', () => {
    // The only rollup at or under 15 days is none, so `headlineRollup` returns
    // nothing and the card must say so rather than reach past the trim.
    const calls = byId(summarise({ horizon: 15 }), 'forecast-calls');

    expect(calls?.value).toBeNull();
  });

  it('formats cost as currency and volume as a count', () => {
    const metrics = summarise();

    expect(byId(metrics, 'forecast-cost')?.value).toBe('$60.00');
    expect(byId(metrics, 'forecast-calls')?.value).toBe('300');
  });

  it('reads a daily-average rollup as the duration itself, not a total', () => {
    const duration = byId(summarise(), 'forecast-duration');

    expect(duration?.value).toBe('120s');
    expect(duration?.detail).toContain('daily average');
  });

  // ------------------------------------------------------------ selection --

  it('drops the cards of targets the rail filtered away', () => {
    const ids = summarise({ selectedTarget: 'call_volume' }).map((metric) => metric.id);

    expect(ids).toContain('forecast-calls');
    expect(ids).not.toContain('forecast-cost');
    expect(ids).not.toContain('forecast-duration');
  });

  it('restores every card when the selection returns to All', () => {
    expect(summarise({ selectedTarget: 'total_cost' }).map((m) => m.id)).not.toContain(
      'forecast-calls',
    );
    expect(summarise().map((m) => m.id)).toContain('forecast-calls');
  });

  it('scopes the confidence card to the selected target', () => {
    // Under All the best MASE wins outright; under a cost selection the card
    // must name cost's model even though it scores worse.
    expect(byId(summarise(), 'best-model')?.value).toBe('Random Forest');
    expect(byId(summarise({ selectedTarget: 'total_cost' }), 'best-model')?.value).toBe(
      'Linear Regression (ridge)',
    );
  });

  it('scopes the risk card to the selected target', () => {
    expect(byId(summarise({ selectedTarget: 'total_cost' }), 'risk-period')?.detail).toContain(
      '2 critical',
    );
    expect(byId(summarise({ selectedTarget: 'call_volume' }), 'risk-period')?.detail).toContain(
      '0 critical · 1 warning',
    );
  });

  it('scopes the peak day to the volume forecast only', () => {
    expect(byId(summarise({ selectedTarget: 'total_cost' }), 'peak-day')).toBeUndefined();
  });

  // ------------------------------------------------------------ confidence --

  it('ranks the confidence card on MASE, the metric the pipeline selects on', () => {
    const metric = byId(summarise(), 'best-model');

    expect(metric?.value).toBe('Random Forest');
    expect(metric?.detail).toContain('MASE 0.79');
    expect(metric?.detail).toContain('beats the seasonal-naive benchmark');
    expect(metric?.tone).toBe('good');
  });

  it('does not call a model that loses to seasonal-naive a good one', () => {
    const metric = byId(summarise({ selectedTarget: 'total_cost' }), 'best-model');

    expect(metric?.detail).toContain('does not beat seasonal-naive');
    expect(metric?.tone).toBeUndefined();
  });

  it('never lets an unscored model win the comparison', () => {
    const payload = payloadWith({
      evaluations: {
        call_volume: evaluation('call_volume', 'random_forest', [
          row('random_forest', 'Random Forest', null),
        ]),
        total_cost: evaluation('total_cost', 'ridge', [
          row('ridge', 'Linear Regression (ridge)', 1.36),
        ]),
      },
    } as Partial<DashboardPayload>);

    // A null MASE is a skipped model, not a perfect one.
    expect(byId(summarise({ payload }), 'best-model')?.value).toBe('Linear Regression (ridge)');
  });

  it('names an unscored model honestly when it is all there is', () => {
    const payload = payloadWith({
      evaluations: {
        call_volume: evaluation('call_volume', 'random_forest', [
          row('random_forest', 'Random Forest', null),
        ]),
      },
    } as Partial<DashboardPayload>);

    const metric = byId(summarise({ payload, selectedTarget: 'call_volume' }), 'best-model');
    expect(metric?.value).toBe('Random Forest');
    expect(metric?.detail).toContain('no cross-validated score');
  });

  // --------------------------------------------------------------- horizon --

  it('reports the chosen horizon and the dates it covers', () => {
    const metric = byId(summarise({ horizon: 30 }), 'horizon');

    expect(metric?.value).toBe('30 days');
    expect(metric?.detail).toContain('Mar 2026');
  });

  it('does not print Infinity when a run configured no horizon', () => {
    const metric = byId(summarise({ horizon: Number.POSITIVE_INFINITY }), 'horizon');

    expect(metric?.value).toBe('90 days');
  });

  // ---------------------------------------------------------------- growth --

  it('reports the largest relative change against observed history', () => {
    const payload = payloadWith({
      // Volume forecast at 10/day against 5/day observed: +100%. Cost is flat.
      daily: history({ call_volume: 5, avg_duration_sec: 120, total_cost: 2 }),
    } as Partial<DashboardPayload>);

    const metric = byId(summarise({ payload }), 'growth');
    expect(metric?.value).toBe('+100.0%');
    expect(metric?.detail).toContain('Call volume');
  });

  it('reports a decrease with a minus sign', () => {
    const payload = payloadWith({
      daily: history({ call_volume: 20, avg_duration_sec: 120, total_cost: 2 }),
    } as Partial<DashboardPayload>);

    expect(byId(summarise({ payload }), 'growth')?.value).toBe('−50.0%');
  });

  it('degrades rather than dividing by a zero baseline', () => {
    const payload = payloadWith({
      daily: history({ call_volume: 0, avg_duration_sec: 0, total_cost: 0 }),
    } as Partial<DashboardPayload>);

    const metric = byId(summarise({ payload }), 'growth');
    expect(metric?.value).toBeNull();
    expect(metric?.unavailable).toContain('history');
  });

  it('will not build a baseline out of a handful of observed days', () => {
    const payload = payloadWith({ daily: history({}).slice(0, 2) } as Partial<DashboardPayload>);

    expect(byId(summarise({ payload }), 'growth')?.value).toBeNull();
  });

  // -------------------------------------------------------------- peak day --

  it('names the busiest forecast day inside the chosen horizon', () => {
    const metric = byId(summarise({ horizon: 30 }), 'peak-day');

    expect(metric?.value).toBe('05 Mar 2026');
    expect(metric?.detail).toContain('30.0 calls');
  });

  // ------------------------------------------------------------------ risk --

  it('ranks the risk period on critical days, with warnings only as a tiebreak', () => {
    const metric = byId(summarise(), 'risk-period');

    expect(metric?.value).toBe('February 2026');
    // February's two criticals outrank January's lone warning outright.
    expect(metric?.detail).toContain('2 critical · 0 warning');
    expect(metric?.tone).toBe('critical');
  });

  it('labels the risk period as observed rather than forecast', () => {
    expect(byId(summarise(), 'risk-period')?.detail).toContain('observed, not forecast');
  });

  it('distinguishes "we found nothing" from "nothing was checked"', () => {
    const clean = payloadWith({
      anomalies: {
        items: [],
        byRule: [],
        notes: [],
        counts: { critical: 0, warning: 0, info: 0 },
      },
    } as Partial<DashboardPayload>);

    const found = byId(summarise({ payload: clean }), 'risk-period');
    expect(found?.detail).toContain('No critical or warning alerts');
    expect(found?.tone).toBe('good');

    const unchecked = byId(summarise({ analysisAvailable: false }), 'risk-period');
    expect(unchecked?.value).toBeNull();
    expect(unchecked?.unavailable).toContain('pipeline step');
  });

  it('ignores info-level anomalies, which the timeline does not plot either', () => {
    const infoOnly = payloadWith({
      anomalies: {
        items: [
          {
            date: '2026-02-01',
            rule: 'overnight_activity',
            metric: 'overnight_calls',
            actual: 3,
            expected: 0,
            deviation: 3,
            severity: 'info',
            message: 'overnight',
          },
        ],
        byRule: [{ rule: 'overnight_activity', severity: 'info', count: 1 }],
        notes: [],
        counts: { critical: 0, warning: 0, info: 1 },
      },
    } as Partial<DashboardPayload>);

    expect(byId(summarise({ payload: infoOnly }), 'risk-period')?.detail).toContain(
      'No critical or warning alerts',
    );
  });

  // --------------------------------------------------------- missing data --

  it('gives a reason rather than a number when a forecast is absent', () => {
    const payload = payloadWith({
      forecasts: { call_volume: forecast('call_volume', 10) },
    } as Partial<DashboardPayload>);

    const duration = byId(summarise({ payload }), 'forecast-duration');
    expect(duration?.value).toBeNull();
    expect(duration?.unavailable).toContain('skipped this target');
  });

  it('never invents a value for a metric the payload cannot answer', () => {
    const empty = payloadWith({
      forecasts: {},
      evaluations: {},
      daily: [],
      anomalies: { items: [], byRule: [], notes: [], counts: { critical: 0, warning: 0, info: 0 } },
    } as Partial<DashboardPayload>);

    for (const metric of summarise({ payload: empty })) {
      // Either a real value, or `null` with a reason. Never `null` in silence.
      if (metric.value === null) expect(metric.unavailable).toBeTruthy();
    }
  });
});
