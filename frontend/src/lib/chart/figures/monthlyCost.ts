/**
 * Monthly cost projection — the port of `_monthly_cost_figure()`.
 *
 * Two details here are load-bearing and both fail *silently*, which is why each
 * has a test rather than a look:
 *
 * 1. `xaxis.type: 'category'`. Left to autodetect, Plotly reads `"2026-08"` as
 *    a date, switches to a date scale, and then drops every bar whose label it
 *    cannot parse — which is exactly the `(partial)` months, the ones the
 *    section's blurb is about.
 * 2. `constraintext: 'none'`. Plotly constrains outside bar text to the bar's
 *    own width by default, so `"$3.90"` on a narrow bar renders as `"$"`.
 */

import type { ForecastMonthRow, Maybe } from '../../../data/types';
import { formatCurrency } from '../../format';
import { baseLayout } from '../layout';
import type { ChartPalette } from '../palette';
import type { PlotFigure } from '../types';

interface MonthlyCostInput {
  /** `forecasts.total_cost.monthly`, oldest first. */
  monthly: readonly ForecastMonthRow[];
  palette: ChartPalette;
}

/** Headroom above the tallest whisker, so labels clear the plot edge. */
const HEADROOM = 1.18;

function isFinite_(value: Maybe): value is number {
  return value !== null && Number.isFinite(value);
}

/**
 * One arm of an asymmetric error bar.
 *
 * Clipped at zero the way the Python `.clip(lower=0)` was: a bound that has
 * crossed its point forecast would otherwise draw a whisker pointing the wrong
 * way. A missing bound yields `null`, which Plotly draws as no whisker rather
 * than as a zero-length one.
 */
function arm(bound: Maybe, yhat: Maybe): Maybe {
  if (!isFinite_(bound) || !isFinite_(yhat)) return null;
  return Math.max(0, bound - yhat);
}

export function buildMonthlyCostFigure({ monthly, palette }: MonthlyCostInput): PlotFigure {
  const labels = monthly.map((row) => `${row.month}${row.partial_month ? ' (partial)' : ''}`);

  const data = [
    {
      type: 'bar',
      x: labels,
      y: monthly.map((row) => row.yhat),
      marker: { color: palette.series1, line: { width: 0 } },
      error_y: {
        type: 'data',
        symmetric: false,
        array: monthly.map((row) => arm(row.yhat_upper, row.yhat)),
        arrayminus: monthly.map((row) => arm(row.yhat, row.yhat_lower)),
        color: palette.muted,
        thickness: 1.5,
        width: 6,
      },
      text: monthly.map((row) => formatCurrency(row.yhat)),
      textposition: 'outside',
      cliponaxis: false,
      constraintext: 'none',
      textfont: { size: 12 },
      textangle: 0,
      hovertemplate: '%{x}<br>Projected: $%{y:.2f}<extra></extra>',
      showlegend: false,
    },
  ];

  const layout = baseLayout(palette, 340);
  // One series and one bar per x, so the unified hover of the line charts would
  // just be a box around a single value.
  layout['hovermode'] = 'closest';
  layout['yaxis'] = { ...(layout['yaxis'] as object), title: { text: '$' } };
  layout['margin'] = { ...(layout['margin'] as object), t: 34 };
  layout['xaxis'] = { ...(layout['xaxis'] as object), type: 'category' };

  const highest = Math.max(
    ...monthly.map((row) => (isFinite_(row.yhat_upper) ? row.yhat_upper : Number.NEGATIVE_INFINITY)),
  );
  if (Number.isFinite(highest) && highest > 0) {
    layout['yaxis'] = { ...(layout['yaxis'] as object), range: [0, highest * HEADROOM] };
  }

  return { data, layout };
}
