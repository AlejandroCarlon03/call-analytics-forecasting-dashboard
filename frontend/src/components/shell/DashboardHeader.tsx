import type { IngestionReport } from '../../data/types';
import { formatCount, formatDate, formatDateTime } from '../../lib/format';
import { ThemeToggle } from './ThemeToggle';
import styles from './DashboardHeader.module.css';

interface DashboardHeaderProps {
  ingestion: IngestionReport;
  generatedAt: string;
}

/**
 * Title, provenance line, theme toggle.
 *
 * The meta line is the port of the Python header: date span, calls kept,
 * active-vs-calendar days with coverage, and when the run happened. It is the
 * reader's only cue that they are looking at a stale report, so it stays
 * prominent rather than moving to the footer.
 */
export function DashboardHeader({ ingestion, generatedAt }: DashboardHeaderProps) {
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
      <ThemeToggle />
    </header>
  );
}
