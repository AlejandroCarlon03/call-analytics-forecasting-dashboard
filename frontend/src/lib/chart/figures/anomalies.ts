/**
 * Volume history with flagged days marked — the port of `_anomaly_figure()`.
 *
 * Three decisions carried over from the Python figure, each of which produces a
 * plausible-looking wrong chart if dropped:
 *
 * *One marker per flagged day, not per rule.* A day that trips three rules is
 * one dot. Three overlapping dots would read as three events.
 *
 * *The marker's y comes from the volume line, not from the rule's `actual`.*
 * A cost alert's `actual` is `4.27`; plotted on a call-count axis it would land
 * on the floor, nowhere near the day it refers to. The marker's job is to point
 * at a date on the line, and the number is in the table.
 *
 * *Info severity is deliberately absent.* It is the most numerous severity by
 * some margin (71 of 173 flagged days on the sample export) and would bury the
 * two that warrant looking at.
 *
 * Severity is carried by *shape* — triangle and diamond — and named in the
 * legend text, not by colour alone. That is a project rule, and it is the
 * reason the legend entries read "▲ Critical" rather than just "Critical".
 */

import type { AnomalyRow, DailyRow, Maybe, Severity } from '../../../data/types';
import { baseLayout } from '../layout';
import type { ChartPalette } from '../palette';
import type { PlotFigure, PlotTrace } from '../types';

interface AnomalyFigureInput {
  /** Observed history, oldest first. The line, and the source of marker y. */
  daily: readonly DailyRow[];
  anomalies: readonly AnomalyRow[];
  palette: ChartPalette;
}

/** The two severities that get a marker, in legend order, with their marks. */
const PLOTTED: ReadonlyArray<{
  severity: Extract<Severity, 'critical' | 'warning'>;
  symbol: string;
  icon: string;
  label: string;
}> = [
  { severity: 'critical', symbol: 'triangle-up', icon: '▲', label: 'Critical' },
  { severity: 'warning', symbol: 'diamond', icon: '◆', label: 'Warning' },
];

function volumeOf(row: DailyRow): Maybe {
  const value = row.call_volume;
  return typeof value === 'number' ? value : null;
}

export function buildAnomalyFigure({
  daily,
  anomalies,
  palette,
}: AnomalyFigureInput): PlotFigure {
  const volumeByDate = new Map(daily.map((row) => [row.date, volumeOf(row)]));

  const data: PlotTrace[] = [
    {
      type: 'scatter',
      x: daily.map((row) => row.date),
      y: daily.map(volumeOf),
      mode: 'lines',
      name: 'Daily calls',
      line: { color: palette.series1, width: 2 },
      hovertemplate: '%{x|%a %d %b}<br>%{y:.0f} calls<extra></extra>',
    },
  ];

  for (const { severity, symbol, icon, label } of PLOTTED) {
    // Set rather than a filter+dedupe so a day tripping several rules of the
    // same severity contributes one marker; insertion order keeps the payload's.
    const dates = [
      ...new Set(anomalies.filter((row) => row.severity === severity).map((row) => row.date)),
    ];
    if (dates.length === 0) continue;

    data.push({
      type: 'scatter',
      x: dates,
      // `undefined` for a flagged day absent from history would leave Plotly to
      // pair x and y by position and shift every later marker; `null` draws a
      // gap in the right place.
      y: dates.map((date) => volumeByDate.get(date) ?? null),
      mode: 'markers',
      name: `${icon} ${label}`,
      marker: {
        size: 11,
        color: palette[severity],
        symbol,
        // A halo in the card colour, so a marker sitting on the line stays
        // distinguishable from it.
        line: { width: 2, color: palette.surface },
      },
      hovertemplate: `%{x|%a %d %b}<br>${severity} alert<extra></extra>`,
    });
  }

  const layout = baseLayout(palette, 320);
  layout['yaxis'] = { ...(layout['yaxis'] as object), title: { text: 'calls' } };

  return { data, layout };
}
