import { useMemo } from 'react';
import type {
  AnomalyRow,
  AnomalyRuleTally,
  AnomalySection,
  ConfigSummary,
  DailyRow,
} from '../../data/types';
import { formatPercent } from '../../lib/format';
import { buildAnomalyFigure } from '../../lib/chart/figures';
import { selectAnomalies } from '../../lib/selectionView';
import { PlotlyChart, useChartPalette } from '../charts';
import { Callout, Card, DataTable, Section, TableView } from '../primitives';
import type { Column } from '../primitives';

/** How many flagged days the Python disclosure showed. All of them are in the CSVs. */
const RECENT_LIMIT = 25;

/**
 * Python's `%g`: up to six significant digits with trailing zeros stripped, so
 * a sigma of `3.0` prints as `3` rather than `3.0`.
 */
function formatGeneral(value: number): string {
  return Number(value.toPrecision(6)).toString();
}

function blurbFor(config: ConfigSummary['anomalies']): string {
  return (
    `Cost overruns above ${formatPercent(config.cost_overrun_pct)}, duration and ` +
    `missed-call spikes beyond ${formatGeneral(config.duration_sigma)} sigma, ` +
    'overnight activity, and robust-z outliers. Every baseline is trailing and ' +
    'weekday-aware, so no day contributes to its own expectation.'
  );
}

const TALLY_COLUMNS: ReadonlyArray<Column<AnomalyRuleTally>> = [
  { key: 'rule', header: 'rule', value: (row) => row.rule },
  { key: 'severity', header: 'severity', value: (row) => row.severity },
  { key: 'count', header: 'count', value: (row) => row.count, digits: 0 },
];

/**
 * Columns for the flagged-day table.
 *
 * Listed rather than derived because this frame's shape is fixed by
 * `anomalies.py`, and `date` needs to stay left-aligned: it arrives as an ISO
 * string, which the default alignment would already handle, but stating it
 * keeps the intent from depending on the payload's type.
 */
const ITEM_COLUMNS: ReadonlyArray<Column<AnomalyRow>> = [
  { key: 'date', header: 'date', value: (row) => row.date, align: 'left' },
  { key: 'rule', header: 'rule', value: (row) => row.rule },
  { key: 'metric', header: 'metric', value: (row) => row.metric },
  { key: 'actual', header: 'actual', value: (row) => row.actual },
  { key: 'expected', header: 'expected', value: (row) => row.expected },
  { key: 'deviation', header: 'deviation', value: (row) => row.deviation },
  { key: 'severity', header: 'severity', value: (row) => row.severity },
  { key: 'message', header: 'message', value: (row) => row.message },
];

interface AnomaliesSectionProps {
  anomalies: AnomalySection;
  config: ConfigSummary['anomalies'];
  /** Observed history — the line the flagged days are marked on. */
  daily: readonly DailyRow[];
  /** The rail's target, or `null` for "All". */
  selectedTarget: string | null;
  /** How the selected target is written in prose, for the scope note. */
  selectedLabel?: string | undefined;
}

/**
 * Anomalies and alerts.
 *
 * The timeline sits above the tables rather than in a section of its own,
 * because a flagged day means nothing without the line it departs from — and
 * the marker's height is read off that line, not off the rule's own `actual`.
 *
 * **A target selection scopes this section**, through `selectAnomalies` — the
 * same derivation the at-a-glance alert tile reads, so the tile and the tally
 * table can never report different totals. The volume line itself stays whole:
 * it is observed history, not a model's output, and the markers need something
 * to sit on.
 */
export function AnomaliesSection({
  anomalies,
  config,
  daily,
  selectedTarget,
  selectedLabel,
}: AnomaliesSectionProps) {
  const palette = useChartPalette();

  const scoped = useMemo(
    () => selectAnomalies(anomalies, selectedTarget),
    [anomalies, selectedTarget],
  );

  const figure = useMemo(
    () => buildAnomalyFigure({ daily, anomalies: scoped.items, palette }),
    [daily, scoped.items, palette],
  );

  // Sliced here rather than passed as `maxRows` so the disclosure label and the
  // row count cannot disagree, and so no "showing first 25 of 173" note appears
  // where the Python dashboard showed none.
  const recent = useMemo(() => scoped.items.slice(0, RECENT_LIMIT), [scoped.items]);

  return (
    <Section title="Anomalies and alerts" blurb={blurbFor(config)}>
      <Card>
        {selectedTarget === null ? null : (
          // Said rather than implied: a shorter table under a filter should not
          // be mistakable for a quieter week.
          <Callout tone="info">
            {`Showing alerts on ${selectedLabel ?? selectedTarget} only. Choose "All" for every rule.`}
          </Callout>
        )}
        <PlotlyChart
          figure={figure}
          description={
            'Daily call volume as a line, with flagged days marked: an up triangle ' +
            'for critical alerts and a diamond for warnings. Info-level alerts are ' +
            'not marked. The flagged days are listed in the tables below.'
          }
        />
        <DataTable
          columns={TALLY_COLUMNS}
          rows={scoped.byRule}
          caption="Flagged days per rule and severity"
          digits={0}
          sortable
          emptyMessage="No rules fired."
        />
        <TableView label={`View the ${RECENT_LIMIT} most recent alerts`}>
          <DataTable
            columns={ITEM_COLUMNS}
            rows={recent}
            caption="Most recent flagged days"
            sortable
            emptyMessage="No anomalies detected."
          />
        </TableView>
      </Card>
    </Section>
  );
}
