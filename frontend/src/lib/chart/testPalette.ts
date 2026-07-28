/**
 * A stub palette for the figure-builder tests.
 *
 * Deliberately *not* the real one. `readPalette()` resolves the audited values
 * from the CSS custom properties at runtime, and a test asserting on hex codes
 * would be a second, unaudited copy of the palette that fails whenever a hue is
 * legitimately retuned. Each value is its own role name instead, so an
 * assertion reads as "this mark takes the series1 colour" and stays true across
 * a repaint.
 *
 * Test-only, but a plain module rather than a `.test.ts` so several test files
 * can share it. Nothing in the app imports it, so it is not in the bundle.
 */

import type { ChartPalette } from './palette';

export const TEST_PALETTE: ChartPalette = {
  ink2: 'ink2',
  muted: 'muted',
  grid: 'grid',
  axis: 'axis',
  series1: 'series1',
  series2: 'series2',
  band: 'band',
  surface: 'surface',
  critical: 'critical',
  warning: 'warning',
  seq: ['seq-0', 'seq-1', 'seq-2', 'seq-3', 'seq-4', 'seq-5', 'seq-6'],
};
