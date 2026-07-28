/**
 * Tests for the ranked-chart sizing helpers.
 *
 * The behaviour worth pinning is at the edges: a chart of two rows must not
 * collapse to a strip, a long label must widen the margin instead of being
 * clipped, and a label past the cap must be ellipsised rather than truncated
 * invisibly by Plotly.
 */

import { describe, expect, it } from 'vitest';
import { BASE_MARGIN } from './layout';
import { ellipsise, estimateTextWidth, rankedSizing } from './sizing';

const OPTIONS = { perRow: 46, minHeight: 220 };

describe('ellipsise', () => {
  it('leaves a label that already fits untouched', () => {
    expect(ellipsise('mae', 200)).toBe('mae');
  });

  it('marks the cut with an ellipsis', () => {
    const short = ellipsise('call_volume_roll7_vs_roll30', 70);
    expect(short.endsWith('…')).toBe(true);
    expect(short.length).toBeLessThan('call_volume_roll7_vs_roll30'.length);
    expect(estimateTextWidth(short)).toBeLessThanOrEqual(70);
  });

  it('gives up rather than returning a bare ellipsis', () => {
    // Below two characters there is nothing to say; the label is left long and
    // Plotly's own clipping takes over.
    expect(ellipsise('mase', 3)).toBe('mase');
  });
});

describe('rankedSizing', () => {
  it('derives height from the row count', () => {
    expect(rankedSizing(new Array(10).fill('m'), OPTIONS).height).toBe(460);
  });

  it('floors the height so a short chart is still a chart', () => {
    expect(rankedSizing(['a', 'b'], OPTIONS).height).toBe(220);
    expect(rankedSizing([], OPTIONS).height).toBe(220);
  });

  it('widens the left margin for the longest label', () => {
    const narrow = rankedSizing(['XGBoost'], OPTIONS).marginLeft;
    const wide = rankedSizing(['XGBoost', 'Linear Regression (ridge)'], OPTIONS).marginLeft;
    expect(wide).toBeGreaterThan(narrow);
  });

  it('leaves room for the longest label plus the tick gap', () => {
    // The point of the whole helper: `dashboard.py` hard-coded 170 and 220, and
    // a label longer than the tuning silently lost its start.
    const label = 'total_cost_roll7_vs_roll30';
    const { marginLeft } = rankedSizing([label], OPTIONS);
    expect(marginLeft).toBeGreaterThan(estimateTextWidth(label));
  });

  it('never narrows past the base margin', () => {
    expect(rankedSizing(['a'], OPTIONS).marginLeft).toBe(BASE_MARGIN.l);
    expect(rankedSizing([], OPTIONS).marginLeft).toBe(BASE_MARGIN.l);
  });

  it('caps the margin and ellipsises rather than eating the plot', () => {
    const monster = 'a'.repeat(200);
    const { labels, marginLeft } = rankedSizing([monster], { ...OPTIONS, maxMargin: 220 });
    expect(marginLeft).toBeLessThanOrEqual(220);
    expect(labels[0]).not.toBe(monster);
    expect(labels[0]!.endsWith('…')).toBe(true);
  });

  it('returns the labels in the order it was given them', () => {
    // The caller has already sorted them into bar order; reordering here would
    // pair every bar with the wrong name.
    expect(rankedSizing(['c', 'a', 'b'], OPTIONS).labels).toEqual(['c', 'a', 'b']);
  });
});
