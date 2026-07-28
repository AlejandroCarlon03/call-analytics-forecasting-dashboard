/**
 * Model accuracy comparison — the port of `_leaderboard_figure()`.
 *
 * One series, so one colour and no legend: the bars are already labelled by
 * the y axis, and a legend for a single trace is chrome.
 *
 * Returns `null` when no model has a usable MAE, which is a real case — every
 * learned model for `avg_duration_sec` is skipped by the `min_observations`
 * floor on the real export, leaving a leaderboard of rows with `status` set to
 * a skip reason and every metric null. A chart of nothing is worse than no
 * chart; the table beside it still explains why.
 */

import type { LeaderboardRow, Maybe } from '../../../data/types';
import { baseLayout } from '../layout';
import type { ChartPalette } from '../palette';
import { rankedSizing } from '../sizing';
import type { PlotFigure } from '../types';

interface LeaderboardInput {
  leaderboard: readonly LeaderboardRow[];
  /** Y-axis units for the error axis title — `TargetMeta.units`. */
  units: string;
  palette: ChartPalette;
}

/** Vertical space per bar, from `_leaderboard_figure()`. */
const PER_ROW = 46;
const MIN_HEIGHT = 220;
/** Room to the right of the longest bar for its outside text label. */
const MARGIN_RIGHT = 72;

function isFinite_(value: Maybe): value is number {
  return value !== null && Number.isFinite(value);
}

export function buildLeaderboardFigure({
  leaderboard,
  units,
  palette,
}: LeaderboardInput): PlotFigure | null {
  // `status === 'ok'` is what `_leaderboard_figure()` filtered on; the null
  // check is the JSON-side half of it, since pandas dropped NaN rows from the
  // sort for free and `Array.prototype.sort` would scatter them.
  const scored = leaderboard.filter((row) => row.status === 'ok' && isFinite_(row.mae));
  if (scored.length === 0) return null;

  // Descending, so the smallest error — the best model — ends up at the top:
  // Plotly stacks the first category at the bottom of a horizontal bar chart.
  const board = [...scored].sort((a, b) => (b.mae as number) - (a.mae as number));

  const { labels, height, marginLeft } = rankedSizing(
    board.map((row) => row.label),
    { perRow: PER_ROW, minHeight: MIN_HEIGHT },
  );

  const data = [
    {
      type: 'bar',
      x: board.map((row) => row.mae),
      y: labels,
      orientation: 'h',
      marker: { color: palette.series1, line: { width: 0 } },
      text: board.map((row) => (row.mae as number).toFixed(2)),
      textposition: 'outside',
      cliponaxis: false,
      // Without this Plotly clips the label to the bar's own width, so a short
      // bar loses its number entirely.
      constraintext: 'none',
      textfont: { size: 12 },
      hovertemplate: '%{y}<br>MAE: %{x:.3f}<extra></extra>',
      showlegend: false,
    },
  ];

  const layout = baseLayout(palette, height);
  layout['hovermode'] = 'closest';
  layout['margin'] = { ...(layout['margin'] as object), l: marginLeft, r: MARGIN_RIGHT };
  layout['xaxis'] = {
    ...(layout['xaxis'] as object),
    title: { text: `Mean absolute error (${units})` },
    showgrid: true,
  };
  // Categorical, so two models with the same MAE still get their own row.
  layout['yaxis'] = { ...(layout['yaxis'] as object), type: 'category', showgrid: false };

  return { data, layout };
}
