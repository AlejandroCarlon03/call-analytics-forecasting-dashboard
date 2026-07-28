import { useMemo } from 'react';
import type { EvaluationSection, LeaderboardRow, TargetMeta } from '../../data/types';
import { deriveColumns } from '../../lib/columns';
import { buildLeaderboardFigure } from '../../lib/chart/figures';
import { PlotlyChart, useChartPalette } from '../charts';
import { Callout, Card, DataTable, Section } from '../primitives';

const BLURB =
  'Every model was scored by walk-forward validation: train to a cut-off, ' +
  'forecast forward, score against what actually happened, advance the cut-off. ' +
  'MASE below 1 beats a seasonal-naive forecast; at or above 1 it does not.';

/** Column order from `build_dashboard()`. Absent names are skipped by `deriveColumns`. */
const COLUMNS = [
  'label',
  'status',
  'n_folds',
  'mae',
  'rmse',
  'r2',
  'mape',
  'mape_n',
  'smape',
  'mase',
  'bias',
  'beats_baseline',
  'note',
] as const;

/** Counts, not measurements — `n_folds` and `mape_n` were `int` in pandas. */
const INTEGER_COLUMNS = ['n_folds', 'mape_n'] as const;

interface ComparisonCardProps {
  evaluation: EvaluationSection;
  meta: TargetMeta | undefined;
}

function ComparisonCard({ evaluation, meta }: ComparisonCardProps) {
  const palette = useChartPalette();
  const label = meta?.label ?? evaluation.target;

  // Null when no model produced a usable error — every learned model for
  // `avg_duration_sec` is skipped below the `min_observations` floor on the
  // real export. The table still carries the rows and their skip reasons.
  const figure = useMemo(
    () =>
      buildLeaderboardFigure({
        leaderboard: evaluation.leaderboard,
        units: meta?.units ?? '',
        palette,
      }),
    [evaluation.leaderboard, meta?.units, palette],
  );

  const columns = useMemo(
    () =>
      deriveColumns<LeaderboardRow>(evaluation.leaderboard, {
        only: COLUMNS,
        integerKeys: INTEGER_COLUMNS,
      }),
    [evaluation.leaderboard],
  );

  return (
    <Card
      title={label}
      blurb={
        <>
          Selected: <strong>{evaluation.bestModel ?? 'none'}</strong> (lowest{' '}
          {evaluation.selectionMetric.toUpperCase()} over {evaluation.nFolds} folds of{' '}
          {evaluation.horizon} days)
        </>
      }
    >
      {figure ? (
        <PlotlyChart
          figure={figure}
          description={
            `${label}: mean absolute error per model as horizontal bars, lowest ` +
            'error at the top. The same numbers, with every other metric, are in ' +
            'the table below.'
          }
        />
      ) : null}
      <DataTable
        columns={columns}
        rows={evaluation.leaderboard}
        caption={`Cross-validation metrics per model for ${label}`}
        sortable
        emptyMessage="No models were scored."
      />
      {evaluation.notes.map((note) => (
        <Callout key={note} tone="info">
          {note}
        </Callout>
      ))}
    </Card>
  );
}

interface ModelComparisonSectionProps {
  evaluations: Record<string, EvaluationSection>;
  targets: readonly string[];
  targetMeta: Record<string, TargetMeta>;
}

/**
 * Model comparison — one card per target.
 *
 * Cards follow `payload.targets` rather than the key order of `evaluations`, so
 * page order matches the rail, exactly as `ForecastsSection` does.
 */
export function ModelComparisonSection({
  evaluations,
  targets,
  targetMeta,
}: ModelComparisonSectionProps) {
  const present = targets
    .map((target) => evaluations[target])
    .filter(
      (evaluation): evaluation is EvaluationSection =>
        evaluation !== undefined && evaluation.leaderboard.length > 0,
    );

  if (present.length === 0) return null;

  return (
    <Section title="Model comparison" blurb={BLURB}>
      {present.map((evaluation) => (
        <ComparisonCard
          key={evaluation.target}
          evaluation={evaluation}
          meta={targetMeta[evaluation.target]}
        />
      ))}
    </Section>
  );
}
