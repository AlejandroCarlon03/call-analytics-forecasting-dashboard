/**
 * Call volume by weekday x hour — the port of `_heatmap_figure()`.
 *
 * The Python version counted raw call timestamps into a 7x24 grid. Here the
 * counting has already happened in `serialize.py`, which emits all 168 cells
 * including the empty ones, so this reshapes rather than aggregates.
 *
 * Two axis settings are load-bearing, and neither announces itself when wrong:
 * the hour axis must be categorical or `"00".."23"` are coerced onto a numeric
 * scale, and the y axis must be reversed or Plotly puts Monday at the *bottom*
 * — the week upside down, which reads as plausible until you check.
 */

import type { HourlyCell } from '../../../data/types';
import { baseLayout } from '../layout';
import { seqColorscale, type ChartPalette } from '../palette';
import type { PlotFigure } from '../types';

interface HeatmapInput {
  /** `payload.hourly` — every weekday x hour cell, empty ones included. */
  hourly: readonly HourlyCell[];
  palette: ChartPalette;
}

const HOURS = 24;
const DAYS = 7;

/** Monday first, matching `Timestamp.dayofweek`. Fallback for absent rows. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** `"00"` … `"23"`. Strings, so the axis has to be told they are categories. */
export const HOUR_LABELS = Array.from({ length: HOURS }, (_, h) => String(h).padStart(2, '0'));

export function buildHeatmapFigure({ hourly, palette }: HeatmapInput): PlotFigure {
  // Zero-filled rather than sized from the payload: a serializer that dropped
  // empty cells would otherwise produce a ragged grid, and a missing hour
  // should read as "no calls", which is what it means.
  const grid = Array.from({ length: DAYS }, () => Array.from({ length: HOURS }, () => 0));
  const labels: string[] = [...DAY_LABELS];

  for (const cell of hourly) {
    const { weekday, hour } = cell;
    if (weekday < 0 || weekday >= DAYS || hour < 0 || hour >= HOURS) continue;
    grid[weekday]![hour] = cell.calls;
    // The payload names its own days; `DAY_LABELS` is only the fallback for a
    // weekday no row covered.
    labels[weekday] = cell.weekdayLabel;
  }

  const data = [
    {
      type: 'heatmap',
      z: grid,
      x: HOUR_LABELS,
      y: labels,
      colorscale: seqColorscale(palette.seq),
      zmin: 0,
      hovertemplate: '%{y} %{x}:00<br>%{z:.0f} calls<extra></extra>',
      colorbar: {
        title: { text: 'calls', font: { size: 11 } },
        thickness: 10,
        len: 0.8,
        outlinewidth: 0,
        tickfont: { size: 11 },
      },
      xgap: 2,
      ygap: 2,
    },
  ];

  const layout = baseLayout(palette, 300);
  layout['hovermode'] = 'closest';
  layout['xaxis'] = {
    ...(layout['xaxis'] as object),
    title: { text: 'hour of day' },
    type: 'category',
  };
  layout['yaxis'] = {
    ...(layout['yaxis'] as object),
    type: 'category',
    showgrid: false,
    // Plotly places the first category at the bottom, so without this the week
    // runs Sunday to Monday down the page.
    autorange: 'reversed',
  };

  return { data, layout };
}
