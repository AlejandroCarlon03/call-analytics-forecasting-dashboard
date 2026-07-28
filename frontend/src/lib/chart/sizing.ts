/**
 * Sizing for the ranked horizontal-bar charts (leaderboard, importance).
 *
 * `dashboard.py` hard-coded `margin.l = 170` and `220` and heights of `46 * n`
 * and `30 * n`. Those numbers were tuned against the labels that existed when
 * they were written, and the label set is not fixed: `feature` names come from
 * `features.engineer()` and grow whenever a feature is added, while `label`
 * comes from the model registry. A hard-coded margin fails silently — Plotly
 * clips the overrun and the chart still renders, just with half a feature name.
 *
 * So the margin is derived from the longest label, clamped, and anything past
 * the clamp is ellipsised *here* rather than clipped by Plotly. An ellipsis is
 * a visible statement that text was dropped; a clip is not. The full name is
 * always in the table view beside the chart either way.
 *
 * Widths are estimated, not measured. Measuring would mean a canvas or a
 * hidden DOM node, which would make these builders impure and untestable for
 * the sake of a margin — and the clamp already absorbs the error.
 */

import { BASE_MARGIN } from './layout';

/**
 * Advance width of one character of the axis-label font.
 *
 * system-ui at 12px runs a little under 0.6em per character for identifiers of
 * this shape — lowercase, digits and underscores, no wide capitals. Erring
 * high is the safe direction: a slightly wide margin costs plot width, a
 * narrow one costs the reader the start of the label.
 */
const CHAR_PX = 7;

/** Tick length plus the gap Plotly leaves between a tick label and the axis. */
const LABEL_PAD_PX = 16;

/** The widest a label column may grow before labels are ellipsised instead. */
const MAX_MARGIN_PX = 220;

/** Estimated rendered width of `text` in the axis-label font. */
export function estimateTextWidth(text: string): number {
  return text.length * CHAR_PX;
}

/**
 * Shorten `text` to fit `maxWidth`, marking the cut with an ellipsis.
 *
 * Returned unchanged when it already fits, so the common case is untouched.
 */
export function ellipsise(text: string, maxWidth: number): string {
  const maxChars = Math.floor(maxWidth / CHAR_PX);
  // Below two characters there is no room for content plus the ellipsis, and a
  // bare "…" tells the reader nothing; the label is left long and Plotly's own
  // clipping takes over. Only reachable with an absurd cap.
  if (maxChars < 2 || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export interface RankedSizingOptions {
  /** Vertical space per bar — `46` for the leaderboard, `30` for importance. */
  perRow: number;
  /** Floor, so a two-row chart is still a chart and not a strip. */
  minHeight: number;
  /** Overridable for tests; defaults to the shared cap. */
  maxMargin?: number;
}

export interface RankedSizing {
  /** The labels to plot — ellipsised only where they exceeded the cap. */
  labels: string[];
  height: number;
  /** `layout.margin.l`. */
  marginLeft: number;
}

/**
 * Height from row count, left margin from the longest label.
 *
 * The margin is computed from the *ellipsised* labels, so it can never exceed
 * the cap, and it is floored at the base margin so a chart of short labels
 * does not end up with its axis crushed against the card edge.
 */
export function rankedSizing(
  labels: readonly string[],
  { perRow, minHeight, maxMargin = MAX_MARGIN_PX }: RankedSizingOptions,
): RankedSizing {
  const budget = maxMargin - LABEL_PAD_PX;
  const fitted = labels.map((label) => ellipsise(label, budget));

  const widest = fitted.reduce((max, label) => Math.max(max, estimateTextWidth(label)), 0);
  const marginLeft = Math.min(
    maxMargin,
    Math.max(BASE_MARGIN.l, Math.ceil(widest) + LABEL_PAD_PX),
  );

  return {
    labels: fitted,
    height: Math.max(minHeight, perRow * labels.length),
    marginLeft,
  };
}
