import type { IngestionReport } from '../../data/types';
import { formatCount, formatDate, formatDateTime } from '../../lib/format';
import { ThemeToggle } from './ThemeToggle';
import styles from './DashboardHeader.module.css';

interface DashboardHeaderProps {
  ingestion: IngestionReport;
  generatedAt: string;
  /**
   * Return to the landing page. The title is the home control, so this is
   * required — every rendered header can be clicked home. `App` clears the
   * fragment and resets its `entered` flag; see its `navigateHome`.
   */
  onNavigateHome: () => void;
  /**
   * Which view the header is sitting above, so it can mark the current one.
   *
   * The Docs control carries `aria-current="page"` in the docs view — the same
   * current-page cue the rails use, arriving in the header. Defaults to
   * `'report'` so a caller with only a report to show need not pass it.
   */
  view?: 'report' | 'docs';
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
 * Title, provenance line, docs link, theme toggle.
 *
 * **The title is the home control.** Clicking it returns the reader to the
 * landing page from anywhere — the report or the docs. It is a `<button>`, not
 * an `<a href>`, for the §15 reason the rails are: it changes what this page
 * shows in place rather than navigating to another document, and an anchor to
 * `#…` would *write* the fragment (§11's skip-link collision). It stays inside
 * the `<h1>`, so the page keeps exactly one top-level heading and its
 * accessible name is the visible title (WCAG label-in-name).
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
export function DashboardHeader({
  ingestion,
  generatedAt,
  onNavigateHome,
  view = 'report',
  onOpenDocs,
}: DashboardHeaderProps) {
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

  const onDocs = view === 'docs';

  return (
    <header className={styles.top}>
      <div>
        <h1 className={styles.title}>
          <button type="button" className={styles.home} onClick={onNavigateHome}>
            Call Analytics Forecast
          </button>
        </h1>
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
          <button
            type="button"
            className={styles.docsLink}
            onClick={onOpenDocs}
            aria-current={onDocs ? 'page' : undefined}
          >
            Docs
          </button>
        ) : null}
        <ThemeToggle />
      </div>
    </header>
  );
}
