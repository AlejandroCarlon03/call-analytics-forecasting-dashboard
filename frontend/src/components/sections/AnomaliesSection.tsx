import { useMemo } from 'react';
import type { AnomalyRow, AnomalyRuleTally, AnomalySection, ConfigSummary } from '../../data/types';
import { formatPercent } from '../../lib/format';
import { Card, DataTable, Section, TableView } from '../primitives';
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
}

/**
 * Anomalies and alerts — tables only.
 *
 * The timeline chart that sits above these in the Python dashboard is PR 5.
 * The tables are the part that is machine-readable and screen-reader-readable,
 * so they are worth landing first regardless.
 */
export function AnomaliesSection({ anomalies, config }: AnomaliesSectionProps) {
  // Sliced here rather than passed as `maxRows` so the disclosure label and the
  // row count cannot disagree, and so no "showing first 25 of 173" note appears
  // where the Python dashboard showed none.
  const recent = useMemo(() => anomalies.items.slice(0, RECENT_LIMIT), [anomalies.items]);

  return (
    <Section title="Anomalies and alerts" blurb={blurbFor(config)}>
      <Card>
        <DataTable
          columns={TALLY_COLUMNS}
          rows={anomalies.byRule}
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
