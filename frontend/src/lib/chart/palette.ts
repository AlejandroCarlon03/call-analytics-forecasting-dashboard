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
 * Roles are added as charts need them.
 */

/** The theme roles the charts use. */
export interface ChartPalette {
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  series1: string;
  series2: string;
  /** The translucent fill behind a forecast's interval band. */
  band: string;
  /** The card background, used as the halo around an anomaly marker. */
  surface: string;
  critical: string;
  warning: string;
  /** The sequential ramp, lightest first — the heatmap's colour scale. */
  seq: readonly string[];
}

/** Every role that resolves to a single colour, i.e. all but `seq`. */
type ScalarRole = Exclude<keyof ChartPalette, 'seq'>;

const ROLES: readonly ScalarRole[] = [
  'ink2',
  'muted',
  'grid',
  'axis',
  'series1',
  'series2',
  'band',
  'surface',
  'critical',
  'warning',
];

/** `--seq-0` … `--seq-6`. The length is fixed by `THEME`, not discovered. */
const SEQ_STEPS = 7;

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
  const read = (name: string) => computed.getPropertyValue(`--${name}`).trim();

  const scalars = {} as Record<ScalarRole, string>;
  for (const role of ROLES) {
    scalars[role] = read(role);
  }
  const seq = Array.from({ length: SEQ_STEPS }, (_, i) => read(`seq-${i}`));
  return { ...scalars, seq };
}

/**
 * The ramp in Plotly's colorscale form — `[[0, c0], … [1, cN]]`.
 *
 * The port of the comprehension in `_heatmap_figure()`. Plotly also accepts a
 * named scale, but the ramp is part of the audited palette and lives in
 * `tokens.css`, so the stops are built from it rather than named.
 */
export function seqColorscale(seq: readonly string[]): Array<[number, string]> {
  // A one-colour ramp has no interval to interpolate over; Plotly needs both
  // ends, so it is stated twice rather than left as a single stop at 0.
  if (seq.length === 1) return [[0, seq[0]!], [1, seq[0]!]];
  return seq.map((color, i) => [i / (seq.length - 1), color]);
}
