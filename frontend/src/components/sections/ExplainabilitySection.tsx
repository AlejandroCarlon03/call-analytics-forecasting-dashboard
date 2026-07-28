import { useMemo } from 'react';
import type { ExplanationSection, FeatureImportanceRow, TargetMeta } from '../../data/types';
import { deriveColumns } from '../../lib/columns';
import { buildImportanceFigure } from '../../lib/chart/figures';
import { PlotlyChart, useChartPalette } from '../charts';
import { Callout, Card, Section, DataTable, TableView } from '../primitives';

const BLURB =
  'Rankings combine SHAP attribution, permutation importance and the model’s ' +
  'native importance. SHAP is the one that explains an individual day rather ' +
  'than an average.';

/** How many rows the Python disclosure listed — `explanation.top_features(12)`. */
const TABLE_FEATURES = 12;

/** How many notes the Python card showed. The rest are in the CSVs. */
const NOTE_LIMIT = 4;

interface ExplanationCardProps {
  explanation: ExplanationSection;
  meta: TargetMeta | undefined;
}

function ExplanationCard({ explanation, meta }: ExplanationCardProps) {
  const palette = useChartPalette();
  const label = `${meta?.label ?? explanation.target} — ${explanation.modelLabel}`;

  // Null when nothing scored: SHAP is optional, and a model with no native
  // importance whose permutation run found nothing leaves every column empty.
  const figure = useMemo(
    () => buildImportanceFigure({ topFeatures: explanation.topFeatures, palette }),
    [explanation.topFeatures, palette],
  );

  const top = useMemo(
    () => explanation.topFeatures.slice(0, TABLE_FEATURES),
    [explanation.topFeatures],
  );

  // Derived rather than listed: which of `shap`, `permutation` and `native` a
  // row carries depends on what was available at explain time, and the Python
  // table simply printed the columns the frame happened to have.
  const columns = useMemo(() => deriveColumns<FeatureImportanceRow>(top), [top]);

  return (
    <Card title={label} blurb={explanation.summary}>
      {figure ? (
        <PlotlyChart
          figure={figure}
          description={
            `${label}: the ten features the model leans on most, as horizontal ` +
            'bars ranked strongest at the top. The same scores are in the table below.'
          }
        />
      ) : null}
      {top.length > 0 ? (
        <TableView label="View importance ranking as table">
          <DataTable
            columns={columns}
            rows={top}
            caption={`Feature importance ranking for ${label}`}
            sortable
          />
        </TableView>
      ) : null}
      {explanation.notes.slice(0, NOTE_LIMIT).map((note) => (
        <Callout key={note} tone="info">
          {note}
        </Callout>
      ))}
    </Card>
  );
}

interface ExplainabilitySectionProps {
  explanations: Record<string, ExplanationSection>;
  targets: readonly string[];
  targetMeta: Record<string, TargetMeta>;
}

/** What drives the forecast — one card per target, in `payload.targets` order. */
export function ExplainabilitySection({
  explanations,
  targets,
  targetMeta,
}: ExplainabilitySectionProps) {
  const present = targets
    .map((target) => explanations[target])
    .filter((explanation): explanation is ExplanationSection => explanation !== undefined);

  if (present.length === 0) return null;

  return (
    <Section title="What drives the forecast" blurb={BLURB}>
      {present.map((explanation) => (
        <ExplanationCard
          key={explanation.target}
          explanation={explanation}
          meta={targetMeta[explanation.target]}
        />
      ))}
    </Section>
  );
}
