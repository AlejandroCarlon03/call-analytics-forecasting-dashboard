/**
 * Layout defaults shared by every figure — the port of `_base_layout()`.
 *
 * Transparent backgrounds so the card surface shows through in both themes,
 * hairline axes, and a horizontal legend pinned above the plot. Every figure
 * starts from this and overrides only what it must, exactly as the Python
 * figures did.
 */

import type { ChartPalette } from './palette';
import type { PlotLayout } from './types';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Plotly's `margin`, split out so callers can widen one side by name. */
export interface Margin {
  l: number;
  r: number;
  t: number;
  b: number;
}

export const BASE_MARGIN: Margin = { l: 56, r: 20, t: 16, b: 44 };

export function baseLayout(palette: ChartPalette, height = 340): PlotLayout {
  return {
    height,
    margin: { ...BASE_MARGIN },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT_FAMILY, size: 12, color: palette.ink2 },
    hovermode: 'x unified',
    hoverlabel: { font: { size: 12 } },
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.0,
      xanchor: 'left',
      x: 0,
      bgcolor: 'rgba(0,0,0,0)',
    },
    xaxis: {
      gridcolor: palette.grid,
      linecolor: palette.axis,
      zeroline: false,
      showgrid: false,
      ticks: 'outside',
      tickcolor: palette.axis,
    },
    yaxis: {
      gridcolor: palette.grid,
      linecolor: palette.axis,
      zeroline: false,
      griddash: 'solid',
    },
  };
}

/**
 * The Plotly config every figure in this dashboard ships with.
 *
 * `displayModeBar: false` and `staticPlot: false` keep the hover readouts —
 * which are the point — without the toolbar, matching the Python dashboard.
 *
 * `responsive` is deliberately *off*. It resizes by deleting `layout.width`
 * and `layout.height` and re-autosizing, which would throw away the
 * row-derived heights the ranked charts compute; `PlotlyChart` measures its
 * container and redraws instead. That also covers the case Plotly's
 * window-resize handler misses — a chart whose *container* changed size while
 * the window did not.
 */
export const PLOT_CONFIG: Record<string, unknown> = {
  displayModeBar: false,
  responsive: false,
  displaylogo: false,
};
