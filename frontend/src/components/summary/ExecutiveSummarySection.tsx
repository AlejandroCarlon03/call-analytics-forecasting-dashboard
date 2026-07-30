import { useMemo } from 'react';
import type { DashboardPayload } from '../../data/types';
import { executiveMetrics } from '../../lib/executiveSummary';
import { Callout, Section } from '../primitives';
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
 *
 * **On the import route the grid is replaced by one sentence, not filled with
 * eight unavailable states.** All eight metrics derive from `forecasts`,
 * `evaluations` or `anomalies`, so a raw CSV or XLSX resolves every one of them
 * to `value: null` — and because this section sits at the top of the page, the
 * first thing a reader saw after a *successful* import was a grid of eight
 * em-dashes. That reads as a failed import, which is how PR 19 came to be
 * filed as a data-loss bug: the file had parsed perfectly, 172 of 172 rows, and
 * every one of them was present in the sections below.
 *
 * The per-card `unavailable` reasons are still the right design when a pipeline
 * *ran* and skipped something — `avg_duration_sec` falling below the
 * observation floor is a finding worth showing. They are the wrong design when
 * no pipeline ran at all: that is one fact about the whole payload, and saying
 * it once is clearer than repeating it eight times in the negative.
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

  // No pipeline ran, so there are no headline figures — say that once, in place
  // of a grid that could only say it eight times over. The section keeps its
  // heading so a reader looking for the summary finds the reason it is absent
  // rather than finding nothing at all.
  if (!analysisAvailable) {
    return (
      <Section
        title="Executive summary"
        blurb="Headline figures come from a forecast run. This view was imported from a file."
      >
        {/* Worded so it does not repeat the import note in the Data source
            section above it. That note names the file and enumerates every
            absent section; this one answers the narrower question a reader has
            while looking straight at this heading. */}
        <Callout tone="info">
          No headline figures for an imported file — call volume, cost and duration
          projections, model selection and risk periods each require a forecast run. The
          descriptive analysis of every imported row continues below.
        </Callout>
      </Section>
    );
  }

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
