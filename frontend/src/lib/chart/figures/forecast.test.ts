/**
 * Regression tests for the forecast figure.
 *
 * These exist because the failures they guard against are silent. A band whose
 * lower bound was not reversed still renders — as a bow tie. A "today" divider
 * that lost its `yref: 'paper'` still renders — somewhere near zero on the
 * value axis. Nothing throws and nothing logs, so only an assertion catches it.
 *
 * The builder is pure, so none of this needs a DOM or a real Plotly.
 */

import { describe, expect, it } from 'vitest';
import type { DailyRow, ForecastDayRow } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildForecastFigure } from './forecast';

const DAILY: DailyRow[] = [
  { date: '2026-07-25', call_volume: 10, avg_duration_sec: null, total_cost: 2 },
  { date: '2026-07-26', call_volume: 14, avg_duration_sec: 120, total_cost: 3 },
  { date: '2026-07-27', call_volume: 9, avg_duration_sec: null, total_cost: 2.5 },
];

const FORECAST: ForecastDayRow[] = [
  { date: '2026-07-28', yhat: 11, yhat_lower: 8, yhat_upper: 15, step: 1, horizon_bucket: '30d' },
  { date: '2026-07-29', yhat: 12, yhat_lower: 7, yhat_upper: 17, step: 2, horizon_bucket: '30d' },
];

function build(overrides: Partial<Parameters<typeof buildForecastFigure>[0]> = {}) {
  return buildForecastFigure({
    daily: DAILY,
    forecast: FORECAST,
    target: 'call_volume',
    intervalLevel: 0.9,
    modelLabel: 'Random Forest',
    units: 'calls',
    palette: PALETTE,
    ...overrides,
  });
}

describe('buildForecastFigure', () => {
  it('draws the band first, then history, then the forecast', () => {
    // Order is what puts the lines on top of the band rather than behind it.
    const names = build().data.map((trace) => trace['name']);
    expect(names).toEqual(['90% interval', 'Actual', 'Forecast (Random Forest)']);
  });

  it('closes the interval band by reversing the lower bound', () => {
    // Without the reversal the polygon crosses itself and renders as a bow tie.
    const band = build().data[0]!;
    expect(band['x']).toEqual(['2026-07-28', '2026-07-29', '2026-07-29', '2026-07-28']);
    expect(band['y']).toEqual([15, 17, 7, 8]);
    expect(band['fill']).toBe('toself');
  });

  it('truncates the interval level the way the Python label does', () => {
    // 0.9 * 100 is 90.000000000000014 in binary floating point; the Python
    // dashboard prints `int(...)`, and the two labels must not disagree.
    expect(build({ intervalLevel: 0.9 }).data[0]!['name']).toBe('90% interval');
    expect(build({ intervalLevel: 0.95 }).data[0]!['name']).toBe('95% interval');
  });

  it('plots the requested target out of the history rows', () => {
    expect(build().data[1]!['y']).toEqual([10, 14, 9]);
    expect(build({ target: 'total_cost' }).data[1]!['y']).toEqual([2, 3, 2.5]);
  });

  it('passes a missing observation through as null rather than zero', () => {
    // `avg_duration_sec` is null on every zero-call day — 59% of the real
    // export. Zero would draw a line to the floor and imply calls of no length.
    expect(build({ target: 'avg_duration_sec' }).data[1]!['y']).toEqual([null, 120, null]);
  });

  it('divides history from forecast at the last observed day', () => {
    const layout = build().layout;
    const shape = (layout['shapes'] as Array<Record<string, unknown>>)[0]!;
    expect(shape['x0']).toBe('2026-07-27');
    expect(shape['x1']).toBe('2026-07-27');
    // Paper-referenced, so the line spans the plot regardless of the y range.
    expect(shape['yref']).toBe('paper');
    expect([shape['y0'], shape['y1']]).toEqual([0, 1]);

    const annotation = (layout['annotations'] as Array<Record<string, unknown>>)[0]!;
    expect(annotation['text']).toBe('today');
    expect(annotation['x']).toBe('2026-07-27');
    expect(annotation['showarrow']).toBe(false);
  });

  it('omits the divider when there is no history to divide', () => {
    const layout = build({ daily: [] }).layout;
    expect(layout['shapes']).toBeUndefined();
    expect(layout['annotations']).toBeUndefined();
  });

  it('titles the y axis in the target units', () => {
    expect(build({ units: 'seconds' }).layout['yaxis']).toMatchObject({
      title: { text: 'seconds' },
    });
  });

  it('keeps the hover formats the Python figure used', () => {
    const [band, actual, forecast] = build().data;
    expect(band!['hoverinfo']).toBe('skip');
    expect(actual!['hovertemplate']).toBe('%{x|%a %d %b}<br>Actual: %{y:.2f}<extra></extra>');
    expect(forecast!['hovertemplate']).toBe('%{x|%a %d %b}<br>Forecast: %{y:.2f}<extra></extra>');
  });

  it('takes every colour from the palette it was handed', () => {
    // The theme toggle works by rebuilding with a different palette, so a
    // hard-coded colour anywhere in here would be a mark that never restyles.
    const [band, actual, forecast] = build().data;
    expect(band!['fillcolor']).toBe('band');
    expect(actual!['line']).toMatchObject({ color: 'series1' });
    expect(forecast!['line']).toMatchObject({ color: 'series2' });
  });
});
