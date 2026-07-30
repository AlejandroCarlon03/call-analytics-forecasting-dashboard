import { useMemo } from 'react';
import type { DashboardPayload } from '../../data/types';
import { executiveMetrics } from '../../lib/executiveSummary';
import { Section } from '../primitives';
import { ExecutiveSummaryCard } from './ExecutiveSummaryCard';
import styles from './ExecutiveSummarySection.module.css';

interface ExecutiveSummarySectionProps {
  payload: DashboardPayload;
  /** The rail's target, or `null` for "All". */
  selectedTarget: string | null;
  /** The forecast horizon in days; `Infinity` when the run configured none. */
  horizon: number;
  /** Whether a pipeline analysed this data — see `App`'s `analysisAvailable`. */
  analysisAvailable: boolean;
  /** How the current selection reads in prose; absent under "All". */
  selectedLabel?: string;
}

/**
 * The executive summary.
 *
 * **It holds no state of its own, and that is the whole state design.** Every
 * card is a pure function of the four props above, all of which `App` already
 * owns: the payload (replaced in place by an import) and the selection (the
 * URL fragment, read by the one `useHashSelection` subscriber). So a rail
 * change and an import both update this grid on the next render with nothing
 * to keep in step — there is no second model state here, no local copy of the
 * horizon, and nothing to go stale under a selection the way §10's tiles once
 * did.
 *
 * The `useMemo` is a courtesy to the eight derivations, not a correctness
 * requirement: its dependencies are exactly the props, so it recomputes
 * whenever any of them moves, which is exactly when the cards must change.
 *
 * It sits above the charts because that is the reading order it exists to
 * enable — the reader should be able to answer how many calls, at what cost,
 * on which model and in which period before scrolling into a single figure.
 * Nothing below it changed; this section adds a way in, it does not replace
 * the analysis.
 */
export function ExecutiveSummarySection({
  payload,
  selectedTarget,
  horizon,
  analysisAvailable,
  selectedLabel,
}: ExecutiveSummarySectionProps) {
  const metrics = useMemo(
    () => executiveMetrics({ payload, selectedTarget, horizon, analysisAvailable }),
    [payload, selectedTarget, horizon, analysisAvailable],
  );

  // Says what the grid is scoped to, rather than leaving the reader to infer it
  // from which cards are missing — the same argument the run-wide sections make
  // about naming what they are *not* filtered by.
  const blurb =
    selectedLabel === undefined
      ? 'The headline figures for this run, across every model.'
      : `The headline figures for this run, filtered to ${selectedLabel}.`;

  return (
    <Section title="Executive summary" blurb={blurb}>
      {/* A real list: eight sibling cards give a screen reader no sense of how
          many there are or where in the set it is, which is precisely what the
          grid gives a sighted reader. */}
      <ul className={styles.grid}>
        {metrics.map((metric) => (
          <ExecutiveSummaryCard key={metric.id} metric={metric} />
        ))}
      </ul>
    </Section>
  );
}
