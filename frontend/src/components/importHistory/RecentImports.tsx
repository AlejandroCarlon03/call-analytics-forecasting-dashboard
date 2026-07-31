import type { ImportHistoryEntry } from '../../lib/importHistory';
import styles from './RecentImports.module.css';

interface RecentImportsProps {
  /** Newest first, exactly as the hook stores them. */
  entries: ImportHistoryEntry[];
  /** The entry currently on screen, or `null`. Drives the "current" marker. */
  activeId: string | null;
  /** Reopen a remembered dataset. */
  onReopen: (id: string) => void;
  /** Forget a remembered dataset. */
  onRemove: (id: string) => void;
  /**
   * How the empty state reads.
   *
   * `landing` is the welcome screen's version — a full call to action, because
   * on the landing page importing is the reader's whole reason to be there.
   * `panel` is the in-report version — one muted line, because the import
   * controls are already a few pixels above it and a second CTA would be noise.
   */
  variant: 'landing' | 'panel';
  /** The landing empty state's "Import a dataset" action. */
  onImport?: () => void;
}

/** `CSV` / `Pipeline JSON`, so a reader can tell a raw import from a full one. */
function kindLabel(kind: ImportHistoryEntry['kind']): string {
  return kind === 'payload' ? 'Pipeline JSON' : 'CSV';
}

/**
 * A readable import time.
 *
 * Wrapped because `Intl.DateTimeFormat` can throw on a malformed stored string,
 * and a broken timestamp must not cost the reader the whole list — it falls
 * back to the raw ISO value, which is still legible.
 */
function formatImportedAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/** The metadata line under a file name, built only from the parts that exist. */
function metaParts(entry: ImportHistoryEntry): string[] {
  const parts = [kindLabel(entry.kind)];
  if (entry.rowsKept !== null) {
    parts.push(`${entry.rowsKept.toLocaleString()} row${entry.rowsKept === 1 ? '' : 's'}`);
  }
  if (entry.dateMin && entry.dateMax) parts.push(`${entry.dateMin} → ${entry.dateMax}`);
  return parts;
}

/**
 * The Recent Imports list, shared by the landing page and the report.
 *
 * Reopening restores a previously imported dashboard *exactly as it was*: the
 * hook stores the whole payload (`lib/importHistory/types.ts` explains why), so
 * selecting a row hands `App` the same payload the import produced, with no file
 * to re-read. It renders no heading — both hosts supply their own (`Section` in
 * the report, the landing page's `<h2>`), so this stays a single reusable body.
 */
export function RecentImports({
  entries,
  activeId,
  onReopen,
  onRemove,
  variant,
  onImport,
}: RecentImportsProps) {
  if (entries.length === 0) {
    if (variant === 'landing') {
      return (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No imports yet</p>
          <p className={styles.emptyBody}>
            Datasets you import will be listed here for one-click reopening. Start with a RetellAI
            CSV export or a <code>dashboard_data.json</code> produced by the pipeline.
          </p>
          {onImport ? (
            <button type="button" className={styles.emptyAction} onClick={onImport}>
              Import a dataset
            </button>
          ) : null}
        </div>
      );
    }
    return <p className={styles.panelEmpty}>No datasets imported yet.</p>;
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => {
        const isActive = entry.id === activeId;
        const meta = metaParts(entry);
        return (
          <li key={entry.id} className={isActive ? `${styles.item} ${styles.itemActive}` : styles.item}>
            <button
              type="button"
              className={styles.open}
              onClick={() => onReopen(entry.id)}
              // An explicit verb+file name, so this control and the "Remove …"
              // one beside it have distinct accessible names rather than both
              // reading as the file name.
              aria-label={`Reopen ${entry.fileName}`}
              // The rail marks its current tab this way too; a screen reader is
              // told which dataset is open rather than inferring it from styling.
              {...(isActive ? { 'aria-current': 'true' as const } : {})}
            >
              <span className={styles.fileRow}>
                <span className={styles.fileName}>{entry.fileName}</span>
                {isActive ? <span className={styles.currentBadge}>Current</span> : null}
              </span>
              <span className={styles.meta}>
                <time dateTime={entry.importedAt}>{formatImportedAt(entry.importedAt)}</time>
                {meta.map((part) => (
                  <span key={part} className={styles.metaPart}>
                    {part}
                  </span>
                ))}
              </span>
            </button>
            <button
              type="button"
              className={styles.remove}
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove ${entry.fileName} from recent imports`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable={false}
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
