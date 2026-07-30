import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type {
  AnalyticDescriptor,
  AnalyticId,
  ExportFormat,
  ExportOutcome,
  ExportRequest,
} from '../../lib/export/types';
import { FORMAT_MEMORY_KEY } from '../../lib/export/types';
import { Card, Callout } from '../primitives';
import styles from './ExportCenter.module.css';

export interface ExportCenterProps {
  /** Analytics available for the current payload/selection. Already filtered by the registry; render exactly these. May be empty. */
  analytics: readonly AnalyticDescriptor[];
  /** True while an export is running. Disable Export, show the loading indicator, set aria-busy. */
  busy: boolean;
  /** The last completed run, or null. Drives the success notification. */
  outcome: ExportOutcome | null;
  /** A whole-run failure message, or null. Drives the error notification. */
  error: string | null;
  /** How the current dashboard selection reads, e.g. "All models" or "Daily cost". Show it so the reader knows what will be exported. */
  selectionLabel: string;
  onExport: (request: ExportRequest) => void;
  /** Clears `outcome`/`error` — call when the reader changes the selection or dismisses a notification. */
  onDismiss: () => void;
}

const FORMATS: readonly ExportFormat[] = ['csv', 'json', 'png'];

const FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV',
  json: 'JSON',
  png: 'PNG',
};

/** Human-readable byte size for the success notification's "N files · size" line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value < 10 && !Number.isInteger(value) ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * The format the reader last used, for the length of this browser session.
 *
 * `sessionStorage`, not `localStorage`, and a *format* only: which analytics
 * someone wants is a question about one task and pre-ticking last time's boxes
 * would put files in their downloads folder they did not ask for. The format is
 * a durable preference for the length of a sitting — someone exporting for a
 * spreadsheet exports for a spreadsheet all afternoon.
 *
 * Wrapped in try/catch because this page is opened from `file://`, where an
 * opaque origin makes even reading `sessionStorage` throw in some browsers. A
 * remembered format is a convenience; it must never be the reason the Export
 * Center fails to render.
 */
function rememberedFormat(): ExportFormat {
  try {
    const stored = sessionStorage.getItem(FORMAT_MEMORY_KEY);
    if (stored !== null && (FORMATS as readonly string[]).includes(stored)) {
      return stored as ExportFormat;
    }
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return 'csv';
}

function rememberFormat(format: ExportFormat): void {
  try {
    sessionStorage.setItem(FORMAT_MEMORY_KEY, format);
  } catch {
    // Not remembering a format is not worth failing an export over.
  }
}

/**
 * The reader's file-export surface: a disclosure panel, not a modal — this
 * dashboard is a single scrolling report with no portal infrastructure, so
 * "open" just means "expanded in place" (matches `ImportPanel`'s staged-panel
 * pattern).
 *
 * Every byte of state here is either the checked-analytics set or the checked
 * format; `outcome`/`error`/`busy` are read straight from props because a
 * second local copy of "did it work" is exactly the disagreement §10 of
 * SESSION_CONTEXT warns about.
 */
export function ExportCenter({
  analytics,
  busy,
  outcome,
  error,
  selectionLabel,
  onExport,
  onDismiss,
}: ExportCenterProps) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<AnalyticId>>(new Set());
  const [format, setFormatState] = useState<ExportFormat>(rememberedFormat);

  // Every write goes through here so the memory cannot drift from the radio —
  // including the automatic move below, which is a real choice the reader will
  // see reflected next time they open the panel.
  const setFormat = useCallback((next: ExportFormat) => {
    setFormatState(next);
    rememberFormat(next);
  }, []);

  const panelId = useId();
  const legendId = useId();
  const formatLegendId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Formats a currently-checked analytic actually supports. Empty selection
  // disables nothing — there is nothing to contradict yet.
  const supportedFormats = useMemo(() => {
    if (checked.size === 0) return new Set<ExportFormat>(FORMATS);
    const supported = new Set<ExportFormat>();
    for (const descriptor of analytics) {
      if (!checked.has(descriptor.id)) continue;
      for (const f of descriptor.formats) supported.add(f);
    }
    return supported;
  }, [analytics, checked]);

  // If the checked format falls out of support (the reader unchecked the one
  // analytic that offered it), move to the first format that is still valid
  // rather than leaving a disabled radio selected.
  useEffect(() => {
    if (supportedFormats.has(format)) return;
    const fallback = FORMATS.find((f) => supportedFormats.has(f));
    if (fallback) setFormat(fallback);
  }, [supportedFormats, format, setFormat]);

  const closePanel = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const togglePanel = () => {
    if (open) {
      closePanel();
    } else {
      setOpen(true);
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
    }
  };

  const toggleAnalytic = (id: AnalyticId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setChecked(new Set(analytics.map((a) => a.id)));
  const clearAll = () => setChecked(new Set());

  const handleExport = () => {
    if (checked.size === 0 || busy) return;
    // Catalogue order, not click order — `analytics` already carries page order.
    const ordered = analytics.filter((a) => checked.has(a.id)).map((a) => a.id);
    onExport({ analytics: ordered, format });
  };

  const hasSelection = checked.size > 0;

  const totalBytes = outcome ? outcome.artifacts.reduce((sum, a) => sum + a.size, 0) : 0;
  const isPartial = !!outcome && outcome.artifacts.length > 0 && outcome.problems.length > 0;
  const isFullFailure = !!outcome && outcome.artifacts.length === 0;

  const fileCount = outcome ? outcome.artifacts.length : 0;
  const filesPhrase = `${fileCount} file${fileCount === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`;
  const failedPhrase = outcome ? outcome.problems.map((p) => p.message).join(' ') : '';

  const successText = !outcome
    ? ''
    : isPartial
      ? `Partial export: ${filesPhrase} written. Failed: ${failedPhrase}`
      : `Exported ${filesPhrase}: ${outcome.artifacts.map((a) => a.fileName).join(', ')}`;

  /**
   * What the polite live region says right now.
   *
   * ***The region is rendered unconditionally, and that is the point.*** A
   * `role="status"` element that is inserted into the DOM carrying its message
   * is not reliably announced — assistive technology watches an *existing* live
   * region for changes. Mounting the success `Callout` inside its own new region
   * would therefore announce the start of an export and nothing about its
   * finish, which is the one moment a reader who cannot see the downloads shelf
   * actually needs.
   *
   * Failures are deliberately absent here: they render in a `role="alert"`
   * below, and carrying them in both places would announce every failure twice.
   */
  const liveMessage = busy ? 'Exporting…' : successText;

  return (
    <Card title="Export" anchor="export">
      {/* Escape is handled on the wrapper rather than on the panel so it also
          fires while focus is on the trigger — the reader who has just closed
          and reopened the panel is focused there, and a key that works only
          inside the panel is a key that appears broken half the time. */}
      <div className={styles.root} onKeyDown={onPanelKeyDown}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={togglePanel}
        >
          {open ? 'Close export panel' : 'Export…'}
        </button>

        {/* Outside the `open` guard: a live region has to be in the document
            before the message it carries changes. */}
        <div role="status" aria-live="polite" className={styles.statusRegion}>
          {liveMessage}
        </div>

        {open && (
          <div id={panelId} className={styles.panel} aria-busy={busy}>
          <p className={styles.selectionLine}>Exporting from: {selectionLabel}</p>

          {analytics.length === 0 ? (
            <p className={styles.emptyState}>
              The imported data carries no analysis to export.
            </p>
          ) : (
            <>
              <fieldset className={styles.fieldset} aria-labelledby={legendId}>
                <legend id={legendId} className={styles.legend}>
                  Analytics
                </legend>
                <div className={styles.fieldsetActions}>
                  <button type="button" className={styles.linkButton} onClick={selectAll}>
                    Select all
                  </button>
                  <button type="button" className={styles.linkButton} onClick={clearAll}>
                    Clear
                  </button>
                </div>
                <div className={styles.checkGrid}>
                  {analytics.map((descriptor) => {
                    const descId = `${legendId}-${descriptor.id}-desc`;
                    return (
                      <div key={descriptor.id} className={styles.checkItem}>
                        <label className={styles.checkLabel}>
                          <input
                            type="checkbox"
                            checked={checked.has(descriptor.id)}
                            onChange={() => toggleAnalytic(descriptor.id)}
                            aria-describedby={descId}
                          />
                          {descriptor.label}
                        </label>
                        <p id={descId} className={styles.checkDescription}>
                          {descriptor.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className={styles.fieldset} aria-labelledby={formatLegendId}>
                <legend id={formatLegendId} className={styles.legend}>
                  Format
                </legend>
                <div className={styles.formatRow}>
                  {FORMATS.map((f) => (
                    <label key={f} className={styles.radioLabel}>
                      <input
                        type="radio"
                        name={formatLegendId}
                        value={f}
                        checked={format === f}
                        disabled={!supportedFormats.has(f)}
                        onChange={() => setFormat(f)}
                      />
                      {FORMAT_LABEL[f]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.exportButton}
                  disabled={!hasSelection || busy}
                  onClick={handleExport}
                >
                  Export
                </button>
                {busy && (
                  <span className={styles.spinner} aria-hidden="true" />
                )}
                {/* Visible echo of the live region above. Motion alone carries
                    no meaning to a reader who cannot see the spinner, and the
                    live region alone carries none to one who is not using a
                    screen reader. */}
                {busy && <span className={styles.busyText}>Exporting…</span>}
              </div>
            </>
          )}

          {!busy && error && (
            <div role="alert" className={styles.alert}>
              <Callout tone="critical">{error}</Callout>
              <button type="button" className={styles.linkButton} onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          )}

          {!busy && !error && isFullFailure && (
            <div role="alert" className={styles.alert}>
              <Callout tone="critical">
                {outcome && outcome.problems.length > 0
                  ? outcome.problems.map((p) => p.message).join(' ')
                  : 'The export could not be completed.'}
              </Callout>
              <button type="button" className={styles.linkButton} onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          )}

          {!busy && !error && outcome && outcome.artifacts.length > 0 && (
            <div className={styles.notification}>
              {/* The same words the live region above is already announcing, so
                  this copy is hidden from assistive technology rather than read
                  out a second time. */}
              <div aria-hidden="true">
                <Callout tone={isPartial ? 'warning' : 'good'}>{successText}</Callout>
              </div>
              <button type="button" className={styles.linkButton} onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          )}
          </div>
        )}
      </div>
    </Card>
  );
}
