/**
 * Regression tests for the anomaly timeline.
 *
 * Three behaviours here are decisions, not implementation details, and all
 * three produce a believable chart when broken: one marker per flagged *day*
 * rather than per rule, marker heights read off the volume line rather than the
 * rule's own `actual`, and info-level alerts excluded entirely.
 *
 * The shape and legend assertions guard the accessibility rule — severity is
 * never carried by colour alone, in the plot or in the legend.
 */

import { describe, expect, it } from 'vitest';
import type { AnomalyRow, DailyRow, Severity } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildAnomalyFigure } from './anomalies';

const DAILY: DailyRow[] = [
  { date: '2026-07-25', call_volume: 10, avg_duration_sec: null, total_cost: 2 },
  { date: '2026-07-26', call_volume: 14, avg_duration_sec: 120, total_cost: 3 },
  { date: '2026-07-27', call_volume: null, avg_duration_sec: null, total_cost: 0 },
  { date: '2026-07-28', call_volume: 21, avg_duration_sec: 90, total_cost: 4.27 },
];

function alert(date: string, severity: Severity, rule = 'robust_z'): AnomalyRow {
  return {
    date,
    rule,
    metric: 'call_volume',
    actual: 21,
    expected: 12,
    deviation: 0.75,
    severity,
    message: `${rule} fired`,
  };
}

function build(anomalies: readonly AnomalyRow[], daily: readonly DailyRow[] = DAILY) {
  return buildAnomalyFigure({ daily, anomalies, palette: PALETTE });
}

/** Traces after the volume line, keyed by legend name. */
function markers(figure: ReturnType<typeof build>) {
  return new Map(figure.data.slice(1).map((trace) => [trace['name'] as string, trace]));
}

describe('buildAnomalyFigure', () => {
  it('always draws the volume line first', () => {
    const line = build([]).data[0]!;
    expect(line['name']).toBe('Daily calls');
    expect(line['mode']).toBe('lines');
    expect(line['y']).toEqual([10, 14, null, 21]);
  });

  it('draws no marker traces when nothing fired', () => {
    expect(build([]).data).toHaveLength(1);
  });

  it('marks critical with a triangle and warning with a diamond', () => {
    const figure = build([alert('2026-07-28', 'critical'), alert('2026-07-26', 'warning')]);
    const traces = markers(figure);
    expect((traces.get('▲ Critical')!['marker'] as Record<string, unknown>)['symbol']).toBe('triangle-up');
    expect((traces.get('◆ Warning')!['marker'] as Record<string, unknown>)['symbol']).toBe('diamond');
  });

  it('names the severity in the legend text', () => {
    // Severity must never be carried by colour alone — in the plot or in the
    // legend. A reader with either kind of colour vision reads the word.
    const names = build([alert('2026-07-28', 'critical'), alert('2026-07-26', 'warning')])
      .data.slice(1)
      .map((trace) => trace['name']);
    expect(names).toEqual(['▲ Critical', '◆ Warning']);
  });

  it('leaves info-level alerts off the chart', () => {
    // 71 of 173 flagged days on the sample export are info; marking them would
    // bury the two severities that warrant looking at.
    expect(build([alert('2026-07-28', 'info')]).data).toHaveLength(1);
  });

  it('plots one marker per flagged day, not per rule', () => {
    const figure = build([
      alert('2026-07-28', 'critical', 'cost_overrun'),
      alert('2026-07-28', 'critical', 'robust_z'),
      alert('2026-07-26', 'critical', 'robust_z'),
    ]);
    expect(markers(figure).get('▲ Critical')!['x']).toEqual(['2026-07-28', '2026-07-26']);
  });

  it('takes the marker height from the volume line, not the rule', () => {
    // A cost alert's `actual` is $4.27; on a call-count axis it would land on
    // the floor, nowhere near the day it refers to.
    const figure = build([
      { ...alert('2026-07-28', 'critical', 'cost_overrun'), metric: 'total_cost', actual: 4.27 },
    ]);
    expect(markers(figure).get('▲ Critical')!['y']).toEqual([21]);
  });

  it('leaves a gap for a flagged day with no observed volume', () => {
    // `undefined` would let Plotly pair x and y by position and shift every
    // later marker onto the wrong day.
    const figure = build([alert('2026-07-27', 'critical'), alert('2026-07-28', 'critical')]);
    expect(markers(figure).get('▲ Critical')!['y']).toEqual([null, 21]);
  });

  it('leaves a gap for a flagged day absent from history entirely', () => {
    const figure = build([alert('2099-01-01', 'warning'), alert('2026-07-26', 'warning')]);
    expect(markers(figure).get('◆ Warning')!['y']).toEqual([null, 14]);
  });

  it('survives an empty history', () => {
    const figure = build([alert('2026-07-28', 'critical')], []);
    expect(figure.data[0]!['x']).toEqual([]);
    expect(markers(figure).get('▲ Critical')!['y']).toEqual([null]);
  });

  it('takes every colour from the palette it was handed', () => {
    const figure = build([alert('2026-07-28', 'critical'), alert('2026-07-26', 'warning')]);
    const traces = markers(figure);
    expect(figure.data[0]!['line']).toMatchObject({ color: 'series1' });
    expect(traces.get('▲ Critical')!['marker']).toMatchObject({
      color: 'critical',
      // The halo in the card colour, so a marker on the line stays legible.
      line: { width: 2, color: 'surface' },
    });
    expect(traces.get('◆ Warning')!['marker']).toMatchObject({ color: 'warning' });
  });
});
