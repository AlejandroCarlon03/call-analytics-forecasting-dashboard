import { useMemo } from 'react';
import type { HourlyCell } from '../../data/types';
import { buildHeatmapFigure } from '../../lib/chart/figures';
import { PlotlyChart, useChartPalette } from '../charts';
import { Card, DataTable, Section, TableView } from '../primitives';
import type { Column } from '../primitives';

const BLURB =
  'Every call in the dataset, bucketed by weekday and hour. This is what drives ' +
  'the after-hours features and the overnight-activity alert.';

/**
 * Columns for the disclosure, matching the frame `build_dashboard()` built.
 *
 * `weekdayLabel` is used rather than the numeric `weekday`: the heatmap's rows
 * are named, and a reader cross-referencing the table should see the same word.
 */
const COLUMNS: ReadonlyArray<Column<HourlyCell>> = [
  { key: 'weekday', header: 'weekday', value: (row) => row.weekdayLabel, align: 'left' },
  { key: 'hour', header: 'hour', value: (row) => row.hour, digits: 0 },
  { key: 'calls', header: 'calls', value: (row) => row.calls, digits: 0 },
];

/**
 * When calls arrive.
 *
 * The chart is the whole 7x24 grid; the table is only the cells with calls in
 * them, ranked, which is what `build_dashboard()` listed — a `groupby` produces
 * no row for a combination that never happened. Keeping the empty cells here
 * would mean scrolling 168 rows to find the 60-odd that say anything.
 */
export function ArrivalsSection({ hourly }: { hourly: readonly HourlyCell[] }) {
  const palette = useChartPalette();

  const figure = useMemo(() => buildHeatmapFigure({ hourly, palette }), [hourly, palette]);

  const ranked = useMemo(
    () => hourly.filter((cell) => cell.calls > 0).sort((a, b) => b.calls - a.calls),
    [hourly],
  );

  if (hourly.length === 0) return null;

  return (
    <Section title="When calls arrive" blurb={BLURB}>
      <Card>
        <PlotlyChart
          figure={figure}
          description={
            'Heatmap of call counts by weekday and hour of day, Monday at the top ' +
            'and midnight at the left. Darker cells carry more calls. The same ' +
            'counts are in the table below, ranked.'
          }
        />
        <TableView label="View weekday x hour counts as table">
          <DataTable
            columns={COLUMNS}
            rows={ranked}
            caption="Call counts per weekday and hour, busiest first"
            digits={0}
            sortable
            emptyMessage="No calls were bucketed."
          />
        </TableView>
      </Card>
    </Section>
  );
}
