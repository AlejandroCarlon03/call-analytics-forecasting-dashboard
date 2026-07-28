import { useMemo } from 'react';
import type { ForecastMonthRow, ForecastSection as ForecastPayload } from '../../data/types';
import { deriveColumns } from '../../lib/columns';
import { buildMonthlyCostFigure } from '../../lib/chart/figures';
import { PlotlyChart, useChartPalette } from '../charts';
import { Card, DataTable, Section, TableView } from '../primitives';

const BLURB =
  'Monthly bounds come from simulated forecast trajectories rather than summing ' +
  'daily bounds, which would describe a month where every day independently hits ' +
  'its worst case. Partial months are labelled — they cover only part of the ' +
  'calendar month.';

/** The disclosure columns, in `build_dashboard()`'s order. */
const COLUMNS = [
  'month',
  'days_forecast',
  'partial_month',
  'yhat',
  'yhat_lower',
  'yhat_upper',
] as const;

/** `days_forecast` was `int` in pandas; JSON cannot say so. */
const INTEGER_COLUMNS = ['days_forecast'] as const;

/**
 * Stable identity for the no-cost-forecast case.
 *
 * A `[]` literal in the render body would be a new array every time, so the
 * memos below would recompute on every render of a section that is about to
 * return null anyway.
 */
const NO_MONTHS: readonly ForecastMonthRow[] = [];

/**
 * Monthly cost projection.
 *
 * Cost only, and that is not an omission: `total_cost` is the one target with a
 * monthly rollup, because summing calls or averaging durations over a month
 * answers no question anyone asks. The section disappears when cost was not
 * forecast at all.
 */
export function MonthlyCostSection({ forecast }: { forecast: ForecastPayload | undefined }) {
  const palette = useChartPalette();
  const monthly = forecast?.monthly ?? NO_MONTHS;

  const figure = useMemo(
    () => buildMonthlyCostFigure({ monthly, palette }),
    [monthly, palette],
  );

  const columns = useMemo(
    () => deriveColumns(monthly, { only: COLUMNS, integerKeys: INTEGER_COLUMNS }),
    [monthly],
  );

  if (monthly.length === 0) return null;

  return (
    <Section title="Monthly cost projection" blurb={BLURB}>
      <Card>
        <PlotlyChart
          figure={figure}
          description={
            'Projected cost per calendar month as bars, each with a simulated ' +
            'interval whisker and a dollar label. Months covering only part of the ' +
            'calendar month are labelled "(partial)". The same numbers are in the ' +
            'table below.'
          }
        />
        <TableView label="View monthly projection as table">
          <DataTable
            columns={columns}
            rows={monthly}
            caption="Projected cost per month with interval bounds"
            digits={2}
            sortable
          />
        </TableView>
      </Card>
    </Section>
  );
}
