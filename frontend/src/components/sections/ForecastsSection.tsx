import { useMemo } from 'react';
import type {
  DailyRow,
  ForecastDayRow,
  ForecastSection as ForecastPayload,
  HorizonRollup,
  TargetMeta,
} from '../../data/types';
import { deriveColumns } from '../../lib/columns';
import { buildForecastFigure } from '../../lib/chart/figures';
import { isTargetVisible } from '../../lib/selection';
import { PlotlyChart, useChartPalette } from '../charts';
import { Callout, Card, DataTable, HorizonSelect, Section, TableView } from '../primitives';
import type { Column } from '../primitives';

function blurbFor(horizons: readonly number[], intervalLevel: number): string {
  const longest = horizons.length > 0 ? Math.max(...horizons) : 0;
  return (
    `Each model was refitted on all history, then rolled forward ${longest} days. ` +
    `The shaded band is a ${Math.trunc(intervalLevel * 100)}% interval calibrated on ` +
    'out-of-sample backtest error, so it widens with horizon.'
  );
}

/**
 * The 30/60/90 summary.
 *
 * Carried in the payload rather than derived from the daily rows: the bounds
 * come from the distribution of simulated trajectory sums, not from summing
 * daily bounds, which would describe a period where every day independently
 * hits its worst case.
 */
const HORIZON_COLUMNS: ReadonlyArray<Column<HorizonRollup>> = [
  { key: 'horizon', header: 'horizon', value: (row) => `${row.days} days`, align: 'left' },
  { key: 'measure', header: 'measure', value: (row) => row.measure, align: 'left' },
  { key: 'forecast', header: 'forecast', value: (row) => row.forecast },
  { key: 'lower', header: 'lower', value: (row) => row.lower },
  { key: 'upper', header: 'upper', value: (row) => row.upper },
];

/** Column order from `build_dashboard()`'s daily disclosure. */
const DAILY_COLUMNS = ['date', 'yhat', 'yhat_lower', 'yhat_upper', 'horizon_bucket'] as const;

interface ForecastCardProps {
  forecast: ForecastPayload;
  meta: TargetMeta | undefined;
  daily: readonly DailyRow[];
  horizons: readonly number[];
  horizon: number;
  onHorizonChange: (horizon: number) => void;
}

function ForecastCard({
  forecast,
  meta,
  daily,
  horizons,
  horizon,
  onHorizonChange,
}: ForecastCardProps) {
  const palette = useChartPalette();

  // Trimmed once and reused everywhere the card shows daily rows, so the
  // figure, the daily disclosure and its derived columns all agree on the
  // same cut. `step <= horizon` is true for every row when horizon is
  // `Infinity` — a run configured no horizons — so nothing here special-cases
  // that; it falls out of the comparison.
  const trimmedDaily = useMemo(
    () => forecast.daily.filter((row) => row.step <= horizon),
    [forecast.daily, horizon],
  );

  const trimmedHorizons = useMemo(
    () => forecast.horizons.filter((row) => row.days <= horizon),
    [forecast.horizons, horizon],
  );

  const figure = useMemo(
    () =>
      buildForecastFigure({
        daily,
        forecast: trimmedDaily,
        target: forecast.target,
        intervalLevel: forecast.intervalLevel,
        modelLabel: forecast.modelLabel,
        units: meta?.units ?? '',
        palette,
      }),
    [daily, forecast, meta?.units, palette, trimmedDaily],
  );

  const dailyColumns = useMemo(
    () => deriveColumns<ForecastDayRow>(trimmedDaily, { only: DAILY_COLUMNS }),
    [trimmedDaily],
  );

  const label = `${meta?.label ?? forecast.target} — ${forecast.modelLabel}`;

  return (
    // Kept as a deep link into the page even though the rail now filters
    // rather than scrolls. It is also why the location fragment is
    // `model=<target>` and not `model-<target>`: the two would collide, and
    // selecting a target would scroll to a card the same click just filtered
    // away. `selection.ts` has the test that pins them apart.
    <Card title={label} anchor={`model-${forecast.target}`}>
      <HorizonSelect horizons={horizons} value={horizon} onChange={onHorizonChange} />
      <PlotlyChart
        figure={figure}
        description={
          `${label}: observed history followed by a ${Math.trunc(forecast.intervalLevel * 100)}% ` +
          'interval band and the forecast line, split by a "today" divider. The same ' +
          'numbers are in the table below.'
        }
      />
      <DataTable
        columns={HORIZON_COLUMNS}
        rows={trimmedHorizons}
        caption={`Forecast totals per horizon for ${label}`}
        emptyMessage="No horizons were rolled up."
      />
      {forecast.notes.map((note) => (
        <Callout key={note}>{note}</Callout>
      ))}
      {/* Not "full" any more — the disclosure shows the same cut the chart
          does, so the two never disagree about what the horizon means. */}
      <TableView label="View daily forecast as table">
        <DataTable
          columns={dailyColumns}
          rows={trimmedDaily}
          caption={`Daily forecast with interval bounds for ${label}`}
          sortable
        />
      </TableView>
    </Card>
  );
}

interface ForecastsSectionProps {
  forecasts: Record<string, ForecastPayload>;
  targets: readonly string[];
  targetMeta: Record<string, TargetMeta>;
  daily: readonly DailyRow[];
  horizons: readonly number[];
  selectedTarget: string | null;
  horizon: number;
  onHorizonChange: (horizon: number) => void;
}

/**
 * Forecasts — one card per target.
 *
 * Cards follow `payload.targets` rather than the key order of `forecasts`, so
 * the page order is the configured target order regardless of how the
 * serializer happened to build the map — and so it matches the rail, which is
 * built from the same list.
 */
export function ForecastsSection({
  forecasts,
  targets,
  targetMeta,
  daily,
  horizons,
  selectedTarget,
  horizon,
  onHorizonChange,
}: ForecastsSectionProps) {
  const present = targets
    .map((target) => forecasts[target])
    .filter((forecast): forecast is ForecastPayload => forecast !== undefined)
    .filter((forecast) => isTargetVisible(forecast.target, selectedTarget));

  if (present.length === 0) return null;

  // Every target shares the configured interval level; the first is representative.
  const intervalLevel = present[0]?.intervalLevel ?? 0;

  return (
    <Section title="Forecasts" blurb={blurbFor(horizons, intervalLevel)}>
      {present.map((forecast) => (
        <ForecastCard
          key={forecast.target}
          forecast={forecast}
          meta={targetMeta[forecast.target]}
          daily={daily}
          horizons={horizons}
          horizon={horizon}
          onHorizonChange={onHorizonChange}
        />
      ))}
    </Section>
  );
}
