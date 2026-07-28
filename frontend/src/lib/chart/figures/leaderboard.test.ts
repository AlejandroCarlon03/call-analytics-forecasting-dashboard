/**
 * Regression tests for the model-comparison chart.
 *
 * The ordering assertion is the load-bearing one: Plotly stacks the first
 * category of a horizontal bar chart at the *bottom*, so a sort in the
 * intuitive direction puts the worst model at the top and reads as a ranking
 * of the wrong end. Nothing about the rendered chart says which it is.
 */

import { describe, expect, it } from 'vitest';
import type { LeaderboardRow } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildLeaderboardFigure } from './leaderboard';

function row(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    model: 'xgboost',
    label: 'XGBoost',
    status: 'ok',
    selected: false,
    n_folds: 24,
    fit_seconds: 1,
    mae: 3,
    rmse: 5,
    r2: 0.1,
    mape: 40,
    mape_n: 160,
    smape: 42,
    mase: 0.8,
    bias: 0,
    ...overrides,
  };
}

function build(leaderboard: readonly LeaderboardRow[], units = 'calls') {
  return buildLeaderboardFigure({ leaderboard, units, palette: PALETTE });
}

const BOARD: LeaderboardRow[] = [
  row({ label: 'XGBoost', mae: 2.9 }),
  row({ label: 'SARIMA', mae: 4.1 }),
  row({ label: 'Random Forest', mae: 3.4 }),
];

describe('buildLeaderboardFigure', () => {
  it('orders bars worst-first so the best model lands at the top', () => {
    expect(build(BOARD)!.data[0]!['y']).toEqual(['SARIMA', 'Random Forest', 'XGBoost']);
    expect(build(BOARD)!.data[0]!['x']).toEqual([4.1, 3.4, 2.9]);
  });

  it('drops models that were skipped rather than scored', () => {
    // A model below the `min_observations` floor carries a skip reason and a
    // row of nulls; plotting it would imply an error of zero.
    const figure = build([...BOARD, row({ label: 'Prophet', status: 'skipped: too few rows', mae: null })])!;
    expect(figure.data[0]!['y']).not.toContain('Prophet');
  });

  it('drops a nominally-ok model with no error to plot', () => {
    const figure = build([...BOARD, row({ label: 'Ridge', mae: null })])!;
    expect(figure.data[0]!['y']).not.toContain('Ridge');
  });

  it('returns null when nothing was scored', () => {
    // The real `avg_duration_sec` case: every learned model skipped. The
    // section keeps its table and omits the chart.
    expect(build([row({ status: 'skipped', mae: null })])).toBeNull();
    expect(build([])).toBeNull();
  });

  it('lifts the text constraint so a short bar keeps its number', () => {
    expect(build(BOARD)!.data[0]!['constraintext']).toBe('none');
    expect(build(BOARD)!.data[0]!['text']).toEqual(['4.10', '3.40', '2.90']);
  });

  it('grows with the number of models and floors at a readable height', () => {
    expect(build(BOARD)!.layout['height']).toBe(220);
    expect(build(new Array(6).fill(0).map((_, i) => row({ label: `m${i}`, mae: i + 1 })))!.layout['height']).toBe(276);
  });

  it('widens the left margin for a long model label', () => {
    const short = build([row({ label: 'Ridge', mae: 1 })])!.layout['margin'] as Record<string, number>;
    const long = build([row({ label: 'Linear Regression (ridge)', mae: 1 })])!.layout['margin'] as Record<string, number>;
    expect(long['l']!).toBeGreaterThan(short['l']!);
    // Room on the right for the outside text label, which sits past the bar.
    expect(long['r']).toBe(72);
  });

  it('keeps the y axis categorical so two equal errors keep separate rows', () => {
    const figure = build([row({ label: 'A', mae: 3 }), row({ label: 'B', mae: 3 })])!;
    expect(figure.layout['yaxis']).toMatchObject({ type: 'category' });
    expect(figure.data[0]!['y']).toEqual(['A', 'B']);
  });

  it('names the error axis in the target units', () => {
    expect(build(BOARD, 'seconds')!.layout['xaxis']).toMatchObject({
      title: { text: 'Mean absolute error (seconds)' },
    });
  });

  it('takes its colour from the palette it was handed', () => {
    expect(build(BOARD)!.data[0]!['marker']).toMatchObject({ color: 'series1' });
  });
});
