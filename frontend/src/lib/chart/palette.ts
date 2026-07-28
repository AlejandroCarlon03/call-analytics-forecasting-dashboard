/**
 * The chart palette, read from the CSS custom properties.
 *
 * `dashboard.py` handed each figure a literal slice of `THEME`. Doing the same
 * here would mean a second copy of an audited palette that `tests/test_tokens.py`
 * only guards in one place, and it would drift the first time a hue changed.
 * Instead the resolved values are read off `document.documentElement` — the same
 * variables the rest of the UI paints with, already resolved for whichever of
 * the three theme cases (`:root`, the OS media query, `[data-theme]`) is active.
 *
 * There are therefore no colour literals in this file, which is the project
 * convention: "Colours come from custom properties, never literals."
 *
 * Roles are added as charts need them. The remaining charts land in PR 5 and
 * will want `surface`, `critical`, `warning` and the `--seq-N` ramp.
 */

/** The theme roles the forecast charts use. */
export interface ChartPalette {
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  series1: string;
  series2: string;
  /** The translucent fill behind a forecast's interval band. */
  band: string;
}

const ROLES: ReadonlyArray<keyof ChartPalette> = [
  'ink2',
  'muted',
  'grid',
  'axis',
  'series1',
  'series2',
  'band',
];

/**
 * Snapshot the palette from the document.
 *
 * No theme argument: the browser has already resolved the cascade, so whichever
 * of the three cases in `tokens.css` applies is reflected in these values.
 * `useChartPalette` owns the question of *when* to call this, which is the part
 * with a trap in it.
 *
 * A missing variable resolves to the empty string, which Plotly treats as
 * "unset" and falls back to its own default rather than throwing. That only
 * happens if `tokens.css` was not loaded, in which case a wrong-looking chart
 * is a far better failure than a blank page.
 */
export function readPalette(root: HTMLElement): ChartPalette {
  const computed = getComputedStyle(root);
  const palette = {} as ChartPalette;
  for (const role of ROLES) {
    palette[role] = computed.getPropertyValue(`--${role}`).trim();
  }
  return palette;
}
