import type { IngestionReport } from '../../data/types';
import { formatCount, formatDate, formatDateTime } from '../../lib/format';
import { ThemeToggle } from './ThemeToggle';
import styles from './DashboardHeader.module.css';

interface DashboardHeaderProps {
  ingestion: IngestionReport;
  generatedAt: string;
  /**
   * Open the documentation.
   *
   * Optional, so the header still renders standalone in a test or a future
   * caller that has no docs to open — and so adding it did not change this
   * component's existing contract.
   */
  onOpenDocs?: () => void;
}

/**
 * Title, provenance line, theme toggle, docs link.
 *
 * The meta line is the port of the Python header: date span, calls kept,
 * active-vs-calendar days with coverage, and when the run happened. It is the
 * reader's only cue that they are looking at a stale report, so it stays
 * prominent rather than moving to the footer.
 *
 * **The docs entry point lives here rather than in the model rail**, because
 * the rail is a filter over the current report and the documentation is not a
 * target to filter to. Putting "Docs" among the model tabs would have implied
 * it was one, and it would have disappeared on a payload with no forecasts —
 * exactly the run whose reader most needs an explanation of why.
 */
export function DashboardHeader({ ingestion, generatedAt, onOpenDocs }: DashboardHeaderProps) {
  const span =
    ingestion.date_min && ingestion.date_max
      ? `${formatDate(ingestion.date_min)} – ${formatDate(ingestion.date_max)}`
      : 'unknown range';

  const facts = [
    span,
    `${formatCount(ingestion.rows_kept)} calls`,
    `${ingestion.active_days} active of ${ingestion.calendar_days} days ` +
      `(${Math.round(ingestion.coverage_pct)}% coverage)`,
    `generated ${formatDateTime(generatedAt)}`,
  ];

  return (
    <header className={styles.top}>
      <div>
        <h1 className={styles.title}>Call Analytics Forecast</h1>
        <div className={styles.meta}>
          {facts.map((fact, index) => (
            <span key={fact}>
              {index > 0 && (
                <span className={styles.sep} aria-hidden="true">
                  ·
                </span>
              )}
              {fact}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.actions}>
        {onOpenDocs ? (
          <button type="button" className={styles.docsLink} onClick={onOpenDocs}>
            Docs
          </button>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
