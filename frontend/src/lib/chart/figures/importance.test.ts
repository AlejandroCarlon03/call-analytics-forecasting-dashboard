/**
 * Regression tests for the feature-importance chart.
 *
 * Method selection is the subtle part. `shap`, `permutation` and `native` are
 * each optional and each may be present-but-null, so choosing on key presence
 * draws ten empty bars while a populated column sits unused — a chart that
 * renders, has axes, and says nothing.
 */

import { describe, expect, it } from 'vitest';
import type { FeatureImportanceRow } from '../../../data/types';
import { TEST_PALETTE as PALETTE } from '../testPalette';
import { buildImportanceFigure, CHART_FEATURES } from './importance';

function build(topFeatures: readonly FeatureImportanceRow[]) {
  return buildImportanceFigure({ topFeatures, palette: PALETTE });
}

const FEATURES: FeatureImportanceRow[] = [
  { feature: 'day_of_week', rank_mean: 1, shap: 0.2, permutation: 0.16, native: 0.13 },
  { feature: 'call_volume_lag_7', rank_mean: 3, shap: 0.08, permutation: 0.06, native: 0.05 },
  { feature: 'cost_per_minute_prev', rank_mean: 5, shap: 0.05, permutation: 0.07, native: 0.02 },
];

describe('buildImportanceFigure', () => {
  it('orders bars weakest-first so the strongest driver lands at the top', () => {
    // Same trap as the leaderboard: Plotly stacks the first category at the
    // bottom of a horizontal bar chart.
    expect(build(FEATURES)!.data[0]!['y']).toEqual([
      'cost_per_minute_prev',
      'call_volume_lag_7',
      'day_of_week',
    ]);
    expect(build(FEATURES)!.data[0]!['x']).toEqual([0.05, 0.08, 0.2]);
  });

  it('prefers SHAP, then permutation, then native', () => {
    expect(build(FEATURES)!.layout['xaxis']).toMatchObject({
      title: { text: 'relative importance (shap)' },
    });

    // Rebuilt rather than destructured: under `exactOptionalPropertyTypes` an
    // absent method and one explicitly set to `undefined` are different types,
    // and the payload's absent case is the one being modelled.
    const noShap: FeatureImportanceRow[] = [
      { feature: 'day_of_week', rank_mean: 1, permutation: 0.16, native: 0.13 },
      { feature: 'call_volume_lag_7', rank_mean: 3, permutation: 0.06, native: 0.05 },
    ];
    expect(build(noShap)!.layout['xaxis']).toMatchObject({
      title: { text: 'relative importance (permutation)' },
    });

    const nativeOnly: FeatureImportanceRow[] = [
      { feature: 'day_of_week', rank_mean: 1, native: 0.13 },
      { feature: 'call_volume_lag_7', rank_mean: 3, native: 0.05 },
    ];
    expect(build(nativeOnly)!.layout['xaxis']).toMatchObject({
      title: { text: 'relative importance (native)' },
    });
  });

  it('skips a method that is present but scored nothing', () => {
    // SHAP ran and produced nothing: the key is there, the values are null.
    const rows = FEATURES.map((row) => ({ ...row, shap: null }));
    expect(build(rows)!.layout['xaxis']).toMatchObject({
      title: { text: 'relative importance (permutation)' },
    });
  });

  it('returns null when no method scored anything', () => {
    expect(build([{ feature: 'day_of_week', rank_mean: 1 }])).toBeNull();
    expect(build([])).toBeNull();
  });

  it('plots at most the top ten features', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      feature: `feature_${i}`,
      rank_mean: i + 1,
      shap: 25 - i,
    }));
    // The payload carries 25 — a superset for the table — and the chart takes
    // the head of it, which is already ranked by `rank_mean`.
    expect((build(many)!.data[0]!['y'] as string[]).length).toBe(CHART_FEATURES);
    expect(build(many)!.data[0]!['y']).toContain('feature_0');
    expect(build(many)!.data[0]!['y']).not.toContain('feature_10');
  });

  it('grows with the number of features and floors at a readable height', () => {
    expect(build(FEATURES)!.layout['height']).toBe(260);
    const ten = Array.from({ length: 10 }, (_, i) => ({
      feature: `feature_${i}`,
      rank_mean: i + 1,
      shap: 10 - i,
    }));
    expect(build(ten)!.layout['height']).toBe(300);
  });

  it('widens the left margin for a long feature name', () => {
    const short = build([{ feature: 'dow', rank_mean: 1, shap: 1 }])!.layout['margin'] as Record<string, number>;
    const long = build([
      { feature: 'total_cost_roll7_vs_roll30', rank_mean: 1, shap: 1 },
    ])!.layout['margin'] as Record<string, number>;
    expect(long['l']!).toBeGreaterThan(short['l']!);
  });

  it('ellipsises a name past the margin cap rather than letting Plotly clip it', () => {
    const label = build([
      { feature: `feature_${'x'.repeat(120)}`, rank_mean: 1, shap: 1 },
    ])!.data[0]!['y'] as string[];
    expect(label[0]!.endsWith('…')).toBe(true);
    expect((build([{ feature: 'a'.repeat(200), rank_mean: 1, shap: 1 }])!.layout['margin'] as Record<string, number>)['l'])
      .toBeLessThanOrEqual(220);
  });

  it('keeps the y axis categorical so two equal scores keep separate rows', () => {
    const figure = build([
      { feature: 'a', rank_mean: 1, shap: 0.5 },
      { feature: 'b', rank_mean: 2, shap: 0.5 },
    ])!;
    expect(figure.layout['yaxis']).toMatchObject({ type: 'category' });
    expect((figure.data[0]!['y'] as string[]).length).toBe(2);
  });

  it('takes its colour from the palette it was handed', () => {
    expect(build(FEATURES)!.data[0]!['marker']).toMatchObject({ color: 'series1' });
  });
});
