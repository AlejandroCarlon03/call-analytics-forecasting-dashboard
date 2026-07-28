/**
 * History plus forecast with an interval band — the port of `_forecast_figure()`.
 *
 * A pure function of payload rows and a palette. Nothing here touches the DOM
 * or Plotly, which is what lets the details that are easy to drop in a port —
 * the band's ordering, the "today" divider, the hover formats — be asserted
 * against a plain object.
 */

import type { DailyRow, ForecastDayRow, Maybe } from '../../../data/types';
import { baseLayout } from '../layout';
import type { ChartPalette } from '../palette';
import type { PlotFigure } from '../types';

interface ForecastFigureInput {
  /** Observed history, oldest first. */
  daily: readonly DailyRow[];
  /** The forecast horizon, oldest first. */
  forecast: readonly ForecastDayRow[];
  /** Which column of `daily` this forecast is for. */
  target: string;
  /** `0.9` -> a legend entry reading "90% interval". */
  intervalLevel: number;
  /** Names the forecast series, e.g. "Forecast (Random Forest)". */
  modelLabel: string;
  /** Y-axis title — `TargetMeta.units`. */
  units: string;
  palette: ChartPalette;
}

/** Read one target out of a history row. Every payload number can be null. */
function historyValue(row: DailyRow, target: string): Maybe {
  const value = row[target];
  return typeof value === 'number' ? value : null;
}

export function buildForecastFigure(input: ForecastFigureInput): PlotFigure {
  const { daily, forecast, target, intervalLevel, modelLabel, units, palette } = input;

  const forecastDates = forecast.map((row) => row.date);

  const data = [
    // The band is drawn first so the two lines sit on top of it rather than
    // behind it. It is a single closed polygon: up the upper bound, back down
    // the lower one — hence the reversal, which is what closes the shape.
    {
      type: 'scatter',
      x: [...forecastDates, ...[...forecastDates].reverse()],
      y: [
        ...forecast.map((row) => row.yhat_upper),
        ...[...forecast].reverse().map((row) => row.yhat_lower),
      ],
      fill: 'toself',
      fillcolor: palette.band,
      line: { width: 0 },
      // The band has no meaningful value at a point; the two lines carry the
      // numbers, and a third entry in a unified hover would just be noise.
      hoverinfo: 'skip',
      name: `${Math.trunc(intervalLevel * 100)}% interval`,
      showlegend: true,
    },
    {
      type: 'scatter',
      x: daily.map((row) => row.date),
      y: daily.map((row) => historyValue(row, target)),
      mode: 'lines',
      name: 'Actual',
      line: { color: palette.series1, width: 2 },
      hovertemplate: '%{x|%a %d %b}<br>Actual: %{y:.2f}<extra></extra>',
    },
    {
      type: 'scatter',
      x: forecastDates,
      y: forecast.map((row) => row.yhat),
      mode: 'lines',
      name: `Forecast (${modelLabel})`,
      line: { color: palette.series2, width: 2 },
      hovertemplate: '%{x|%a %d %b}<br>Forecast: %{y:.2f}<extra></extra>',
    },
  ];

  const layout = baseLayout(palette, 360);
  layout['yaxis'] = { ...(layout['yaxis'] as object), title: { text: units } };

  // Mark where history ends and extrapolation begins. `add_vline` in Plotly.py
  // expands into a layout shape plus an annotation; there is no such helper in
  // the JS API, so both are written out.
  const lastObserved = daily.at(-1)?.date;
  if (lastObserved !== undefined) {
    layout['shapes'] = [
      {
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: lastObserved,
        x1: lastObserved,
        y0: 0,
        y1: 1,
        line: { color: palette.muted, width: 1 },
      },
    ];
    layout['annotations'] = [
      {
        x: lastObserved,
        y: 1,
        xref: 'x',
        yref: 'paper',
        text: 'today',
        showarrow: false,
        // Anchored right of its x, so the label sits on the history side of
        // the divider rather than over the forecast — Plotly.py's "top left".
        xanchor: 'right',
        yanchor: 'bottom',
        font: { size: 11, color: palette.muted },
      },
    ];
  }

  return { data, layout };
}
