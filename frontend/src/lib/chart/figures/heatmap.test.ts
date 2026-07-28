/**
 * Regression tests for the arrivals heatmap.
 *
 * Every failure this guards renders a perfectly plausible chart: an hour axis
 * on a numeric scale still draws 24 columns, and a week running Sunday-to-Monday
 * down the page still draws seven rows. You have to check a known cell to
 * notice, which is what these do.
 */

import { describe, expect, it } from 'vitest';
import type { HourlyCell } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildHeatmapFigure, HOUR_LABELS } from './heatmap';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The full 168-cell grid the serializer emits, with a few cells populated. */
function fullGrid(populated: Record<string, number> = {}): HourlyCell[] {
  const cells: HourlyCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({
        weekday,
        weekdayLabel: DAYS[weekday]!,
        hour,
        calls: populated[`${weekday}:${hour}`] ?? 0,
      });
    }
  }
  return cells;
}

function build(hourly: readonly HourlyCell[]) {
  return buildHeatmapFigure({ hourly, palette: PALETTE });
}

describe('buildHeatmapFigure', () => {
  it('pins the hour axis to categories', () => {
    // "00".."23" are strings. On an autodetected axis they land on a numeric
    // scale and the zero padding stops meaning anything.
    expect(build(fullGrid()).layout['xaxis']).toMatchObject({ type: 'category' });
  });

  it('labels the hours "00" through "23"', () => {
    expect(HOUR_LABELS[0]).toBe('00');
    expect(HOUR_LABELS[9]).toBe('09');
    expect(HOUR_LABELS[23]).toBe('23');
    expect(build(fullGrid()).data[0]!['x']).toEqual(HOUR_LABELS);
  });

  it('runs Monday to Sunday down the page', () => {
    // Plotly puts the first category at the *bottom*, so the categories are
    // Monday-first and the axis is reversed. Dropping either flips the week.
    const figure = build(fullGrid());
    expect(figure.data[0]!['y']).toEqual([...DAYS]);
    expect(figure.layout['yaxis']).toMatchObject({ autorange: 'reversed', type: 'category' });
  });

  it('places each count at its own weekday and hour', () => {
    const grid = build(fullGrid({ '0:9': 12, '6:23': 3 })).data[0]!['z'] as number[][];
    expect(grid[0]![9]).toBe(12);
    expect(grid[6]![23]).toBe(3);
    expect(grid[6]![9]).toBe(0);
  });

  it('always emits a full 7 x 24 grid', () => {
    // Zero-filled rather than sized from the payload, so a serializer that
    // dropped empty cells could not produce a ragged grid.
    const grid = build([{ weekday: 2, weekdayLabel: 'Wed', hour: 14, calls: 5 }]).data[0]!['z'] as number[][];
    expect(grid).toHaveLength(7);
    expect(grid.every((row) => row.length === 24)).toBe(true);
    expect(grid[2]![14]).toBe(5);
  });

  it('falls back to the default day names for a weekday no row covered', () => {
    expect(build([{ weekday: 2, weekdayLabel: 'Wednesday', hour: 0, calls: 1 }]).data[0]!['y']).toEqual([
      'Mon', 'Tue', 'Wednesday', 'Thu', 'Fri', 'Sat', 'Sun',
    ]);
  });

  it('ignores a cell outside the grid rather than growing one', () => {
    expect(() => build([{ weekday: 9, weekdayLabel: 'Nonesday', hour: 30, calls: 1 }])).not.toThrow();
    const grid = build([{ weekday: 9, weekdayLabel: 'Nonesday', hour: 30, calls: 1 }]).data[0]!['z'] as number[][];
    expect(grid.flat().every((value) => value === 0)).toBe(true);
  });

  it('renders an empty payload as an empty grid, not an empty figure', () => {
    const grid = build([]).data[0]!['z'] as number[][];
    expect(grid).toHaveLength(7);
    expect(grid.flat().every((value) => value === 0)).toBe(true);
  });

  it('builds the colorscale from the palette ramp, anchored at 0 and 1', () => {
    const scale = build(fullGrid()).data[0]!['colorscale'] as Array<[number, string]>;
    expect(scale).toHaveLength(7);
    expect(scale[0]).toEqual([0, 'seq-0']);
    expect(scale[6]).toEqual([1, 'seq-6']);
    // Anchored at zero so an all-quiet week is not painted as if it were busy.
    expect(build(fullGrid()).data[0]!['zmin']).toBe(0);
  });
});
