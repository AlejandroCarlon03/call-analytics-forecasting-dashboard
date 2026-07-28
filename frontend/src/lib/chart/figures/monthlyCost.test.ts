/**
 * Regression tests for the monthly cost figure.
 *
 * The two assertions that matter most here — the category axis and the text
 * constraint — guard failures that still *render*. Without the category axis
 * the chart looks fine and is simply missing its partial months; without
 * `constraintext` every narrow bar is labelled `"$"`. Neither throws, neither
 * logs, and both are exactly the kind of thing a port drops.
 */

import { describe, expect, it } from 'vitest';
import type { ForecastMonthRow } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildMonthlyCostFigure } from './monthlyCost';

function month(overrides: Partial<ForecastMonthRow> = {}): ForecastMonthRow {
  return {
    month: '2026-08',
    month_start: '2026-08-01',
    days_forecast: 31,
    days_in_month: 31,
    partial_month: false,
    yhat: 100,
    yhat_lower: 80,
    yhat_upper: 130,
    aggregate: 'sum',
    ...overrides,
  };
}

const MONTHLY: ForecastMonthRow[] = [
  month({ month: '2026-07', days_forecast: 2, partial_month: true, yhat: 6.17, yhat_lower: 4, yhat_upper: 7.95 }),
  month({ month: '2026-08' }),
  month({ month: '2026-09', month_start: '2026-09-01', days_forecast: 27, days_in_month: 30, partial_month: true }),
];

function build(monthly: readonly ForecastMonthRow[] = MONTHLY) {
  return buildMonthlyCostFigure({ monthly, palette: PALETTE });
}

describe('buildMonthlyCostFigure', () => {
  it('pins the x axis to categories', () => {
    // THE regression test. Left to autodetect, Plotly reads "2026-08" as a date,
    // switches to a date scale, and silently drops the "(partial)" bars — which
    // are precisely the ones the section's blurb is about.
    expect(build().layout['xaxis']).toMatchObject({ type: 'category' });
  });

  it('keeps every bar, partial months included', () => {
    const bar = build().data[0]!;
    expect(bar['x']).toEqual(['2026-07 (partial)', '2026-08', '2026-09 (partial)']);
    expect((bar['y'] as unknown[]).length).toBe(3);
  });

  it('labels only the partial months', () => {
    const labels = build().data[0]!['x'] as string[];
    expect(labels.filter((label) => label.includes('(partial)'))).toHaveLength(2);
  });

  it('lifts the text constraint so narrow bars keep their whole label', () => {
    // Plotly constrains outside text to the bar's own width by default, so
    // "$3.90" on a short bar renders as "$".
    expect(build().data[0]!['constraintext']).toBe('none');
    expect(build().data[0]!['textposition']).toBe('outside');
    expect(build().data[0]!['cliponaxis']).toBe(false);
  });

  it('writes the full currency label on every bar', () => {
    expect(build().data[0]!['text']).toEqual(['$6.17', '$100.00', '$100.00']);
  });

  it('renders a missing projection as an em dash rather than "$NaN"', () => {
    const figure = build([month({ yhat: null, yhat_lower: null, yhat_upper: null })]);
    expect(figure.data[0]!['text']).toEqual(['—']);
  });

  it('builds asymmetric whiskers from the interval bounds', () => {
    const error = build().data[0]!['error_y'] as Record<string, unknown>;
    expect(error['symmetric']).toBe(false);
    expect(error['array']).toEqual([7.95 - 6.17, 30, 30]);
    expect(error['arrayminus']).toEqual([6.17 - 4, 20, 20]);
  });

  it('clips a whisker that would point the wrong way', () => {
    // A bound that has crossed its point forecast would otherwise draw a
    // negative arm, which Plotly renders pointing back through the bar.
    const figure = build([month({ yhat: 100, yhat_lower: 120, yhat_upper: 90 })]);
    const error = figure.data[0]!['error_y'] as Record<string, unknown>;
    expect(error['array']).toEqual([0]);
    expect(error['arrayminus']).toEqual([0]);
  });

  it('drops a whisker with no bound rather than drawing a zero-length one', () => {
    const figure = build([month({ yhat_upper: null })]);
    const error = figure.data[0]!['error_y'] as Record<string, unknown>;
    expect(error['array']).toEqual([null]);
  });

  it('leaves headroom above the tallest whisker for the labels', () => {
    const yaxis = build().layout['yaxis'] as Record<string, unknown>;
    expect(yaxis['range']).toEqual([0, 130 * 1.18]);
  });

  it('omits the y range when no bound is usable', () => {
    // `Math.max` over nothing is -Infinity; passing that to Plotly would blank
    // the axis rather than let it autoscale.
    const yaxis = build([month({ yhat_upper: null })]).layout['yaxis'] as Record<string, unknown>;
    expect(yaxis['range']).toBeUndefined();
  });

  it('survives an empty projection', () => {
    const figure = build([]);
    expect(figure.data[0]!['x']).toEqual([]);
    expect((figure.layout['yaxis'] as Record<string, unknown>)['range']).toBeUndefined();
  });

  it('takes its colours from the palette it was handed', () => {
    const bar = build().data[0]!;
    expect(bar['marker']).toMatchObject({ color: 'series1' });
    expect(bar['error_y']).toMatchObject({ color: 'muted' });
  });
});
