import { useMemo } from 'react';
import type { ScenarioSection } from '../../data/types';
import { deriveColumns } from '../../lib/columns';
import { Callout, Card, DataTable, Section } from '../primitives';

/**
 * Scenario columns that were `int` in `ScenarioOutcome`, not `float`.
 *
 * JSON cannot carry the distinction and `1` is `1` either way, so the two
 * agent-count columns are named here to keep them printing as `1` rather than
 * `1.00` like every other numeric column in this table.
 */
const INTEGER_COLUMNS = ['current_agents', 'required_agents'] as const;

const BLURB =
  'Cost scales with volume; wait time, staffing and missed calls do not — they ' +
  'come from Erlang C and Erlang A queueing models, because near capacity a ' +
  'small volume rise produces a disproportionate jump in wait.';

/**
 * Scenario analysis.
 *
 * The columns are derived from the payload rather than listed, so a new column
 * added in `scenarios.py` appears here with no frontend change — which is how
 * the Python dashboard behaved, since it iterated the DataFrame's columns.
 */
export function ScenariosSection({ scenarios }: { scenarios: ScenarioSection }) {
  const columns = useMemo(
    () => deriveColumns(scenarios.rows, { integerKeys: INTEGER_COLUMNS }),
    [scenarios.rows],
  );

  if (scenarios.rows.length === 0) return null;

  return (
    <Section title="Scenario analysis" blurb={BLURB}>
      <Card>
        <DataTable
          columns={columns}
          rows={scenarios.rows}
          caption="Modelled outcomes per volume scenario"
          digits={2}
          sortable
        />
        {scenarios.notes.map((note) => (
          <Callout key={note} tone="info">
            {note}
          </Callout>
        ))}
      </Card>
    </Section>
  );
}
