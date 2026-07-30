import type { ExecutiveMetric } from '../../lib/executiveSummary';
import styles from './ExecutiveSummaryCard.module.css';

/**
 * One executive summary card.
 *
 * **It formats nothing.** Every string arrives resolved from
 * `lib/executiveSummary.ts`, for the reason that module's doc comment gives:
 * the label and the number have to be written from the same row or they drift.
 * This component's whole job is hierarchy — label, then the number, then the
 * supporting line — and the unavailable state.
 *
 * It is not a `StatTile`. The two look related and are not the same thing: a
 * tile is a headline number and cannot express "this could not be computed,
 * and here is why", which is a requirement here rather than an edge case
 * (`avg_duration_sec` has no forecast at all on the real export). Extending
 * `StatTile` with an unavailable variant would have put that state on every
 * tile in the at-a-glance grid, where nothing needs it.
 *
 * **The unavailable state is text, not an em dash alone.** A bare "—" is
 * indistinguishable from a bug; the reason is what makes the absence a finding
 * the reader can act on.
 */
export function ExecutiveSummaryCard({ metric }: { metric: ExecutiveMetric }) {
  const { label, value, detail, unavailable, tone } = metric;
  const unresolved = value === null;

  const className = [
    styles.card,
    unresolved ? styles.unresolved : '',
    tone ? styles[tone] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    /*
     * A list item, and the grid is a list. Eight sibling cards with no
     * grouping is eight unrelated fragments to a screen reader; a list gives
     * the count and the position for free, which is exactly the "how many of
     * these am I in" that sighted readers get from the grid itself.
     */
    <li className={className}>
      <div className={styles.label}>{label}</div>
      {unresolved ? (
        <>
          {/* The em dash is `format.EMPTY`'s job everywhere else in this
              dashboard; here it is a deliberate literal because there is no
              value to pass through a formatter. */}
          <div className={styles.value} aria-hidden="true">
            —
          </div>
          <p className={styles.unavailable}>{unavailable ?? 'Not available in this payload.'}</p>
        </>
      ) : (
        <>
          <div className={styles.value}>{value}</div>
          {detail ? <p className={styles.detail}>{detail}</p> : null}
        </>
      )}
    </li>
  );
}
