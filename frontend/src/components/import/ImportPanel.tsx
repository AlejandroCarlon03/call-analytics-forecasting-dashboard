import { useCallback, useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import type { DashboardPayload } from '../../data/types';
import { readImportFile } from '../../lib/import';
import type { ImportPreview, ImportProblem, ImportProgress, ImportResult, ImportStage } from '../../lib/import/types';
import { ACCEPTED_EXTENSIONS, IMPORT_STAGE_LABELS } from '../../lib/import/types';

/**
 * `readImportFile` is contracted (`lib/import/types.ts`) to take an optional
 * progress callback as its second argument, landing alongside `.xlsx`
 * support from a parallel agent. Called through this typed wrapper so the
 * panel builds against the frozen signature even while the current
 * implementation still declares one parameter; drop the cast once the real
 * second parameter lands.
 */
const readImportFileWithProgress = readImportFile as (
  file: File,
  onProgress?: ImportProgress,
) => Promise<ImportResult>;
import { Card, Callout, DataTable } from '../primitives';
import type { Column } from '../primitives';
import { deriveColumns } from '../../lib/columns';
import styles from './ImportPanel.module.css';

interface ImportPanelProps {
  /** Called when the reader confirms the preview. */
  onImport: (payload: DashboardPayload, preview: ImportPreview) => void;
  /** Describes what is on screen now, e.g. "sample dataset" or "my_export.csv". */
  activeSourceLabel: string;
}

type Stage = 'idle' | 'reading' | 'error' | 'preview' | 'imported';

interface StagedResult {
  payload: DashboardPayload;
  preview: ImportPreview;
}

/** What the success state confirms, captured before `staged` is cleared. */
interface ImportedSummary {
  fileName: string;
  rowsKept: number;
  dateMin: string | null;
  dateMax: string | null;
}

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

function problemLocation(problem: ImportProblem): string | null {
  if (problem.row !== undefined && problem.column) return `row ${problem.row}, column ${problem.column}`;
  if (problem.row !== undefined) return `row ${problem.row}`;
  if (problem.column) return `column ${problem.column}`;
  return null;
}

/** The confirmation sentence for the success state, and its live-region echo. */
function importedMessage(summary: ImportedSummary): string {
  const span = summary.dateMin && summary.dateMax ? ` covering ${summary.dateMin} to ${summary.dateMax}` : '';
  return `Imported ${summary.fileName}: ${summary.rowsKept} row${summary.rowsKept === 1 ? '' : 's'} kept${span}.`;
}

/**
 * Reads a CSV, a pipeline JSON export, or a workbook and, once the reader
 * confirms the preview, hands the resulting payload back to `App`.
 *
 * Nothing is applied until "Import" is pressed — the preview stage exists so
 * a swap of the dashboard's one source of truth is never a surprise.
 */
export function ImportPanel({ onImport, activeSourceLabel }: ImportPanelProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [errors, setErrors] = useState<ImportProblem[]>([]);
  const [staged, setStaged] = useState<StagedResult | null>(null);
  const [importedSummary, setImportedSummary] = useState<ImportedSummary | null>(null);
  const [progressStage, setProgressStage] = useState<ImportStage | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const busy = stage === 'reading';

  const handleFile = useCallback(async (file: File) => {
    setStage('reading');
    setProgressStage('reading');
    setDragActive(false);
    dragCounter.current = 0;
    let result: ImportResult;
    try {
      result = await readImportFileWithProgress(file, setProgressStage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The file could not be read.';
      setErrors([{ message }]);
      setStage('error');
      return;
    }
    if (result.ok) {
      setStaged({ payload: result.payload, preview: result.preview });
      setStage('preview');
    } else {
      setErrors(result.errors);
      setStage('error');
    }
  }, []);

  const openPicker = useCallback(() => {
    if (busy) return;
    inputRef.current?.click();
  }, [busy]);

  const onDropZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file twice still fires `change`.
    event.target.value = '';
    if (file) void handleFile(file);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    dragCounter.current += 1;
    setDragActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (busy) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounter.current = 0;
    setDragActive(false);
    if (busy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const reset = () => {
    setErrors([]);
    setStaged(null);
    setProgressStage(null);
    setStage('idle');
  };

  const confirmImport = () => {
    if (!staged) return;
    onImport(staged.payload, staged.preview);
    setImportedSummary({
      fileName: staged.preview.fileName,
      rowsKept: staged.preview.rowsKept,
      dateMin: staged.preview.dateMin,
      dateMax: staged.preview.dateMax,
    });
    setProgressStage('done');
    setStage('imported');
    setStaged(null);
  };

  const cancelPreview = () => {
    setStaged(null);
    setProgressStage(null);
    setStage('idle');
  };

  const liveMessage =
    stage === 'reading'
      ? IMPORT_STAGE_LABELS[progressStage ?? 'reading']
      : stage === 'preview' && staged
        ? `Preview ready: ${staged.preview.rowsKept} of ${staged.preview.rowsRead} rows kept.`
        : stage === 'error'
          ? errors.length === 1 && errors[0]
            ? errors[0].message
            : `${errors.length} problems found. ${errors.map((problem) => problem.message).join(' ')}`
          : stage === 'imported' && importedSummary
            ? importedMessage(importedSummary)
            : '';

  const droppedEntries = staged ? Object.entries(staged.preview.dropped) : [];
  const columnMapEntries = staged ? Object.entries(staged.preview.columnMap) : [];
  const sampleColumns: Array<Column<Record<string, string | number | null>>> = staged
    ? deriveColumns(staged.preview.sampleDaily)
    : [];

  return (
    <Card title="Import data" anchor="import">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className={styles.hiddenInput}
        accept={ACCEPT_ATTR}
        aria-label="Choose a CSV or JSON file to import"
        onChange={onInputChange}
        disabled={busy}
      />

      <div className={styles.liveRegion} aria-live="polite">
        {liveMessage}
      </div>

      {(stage === 'idle' || stage === 'reading') && (
        <>
          <div
            className={dragActive ? `${styles.dropZone} ${styles.dropZoneActive}` : styles.dropZone}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-disabled={busy}
            aria-busy={busy}
            onClick={openPicker}
            onKeyDown={onDropZoneKeyDown}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {busy ? (
              <div className={styles.progress}>
                <span className={styles.spinner} aria-hidden="true" />
                <p className={styles.status}>{IMPORT_STAGE_LABELS[progressStage ?? 'reading']}</p>
              </div>
            ) : (
              <>
                <p className={styles.status}>Drag a file here, or choose one below.</p>
                <p className={styles.hint}>
                  Currently showing: {activeSourceLabel}. Accepts {ACCEPTED_EXTENSIONS.join(', ')}.
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            className={styles.chooseButton}
            onClick={openPicker}
            disabled={busy}
          >
            Choose file
          </button>
        </>
      )}

      {stage === 'error' && (
        <div className={styles.errorBlock}>
          <div role="alert" className={styles.alert}>
            <Callout tone="critical">
              {errors.length === 1 && errors[0] ? errors[0].message : `${errors.length} problems found.`}
            </Callout>
            {errors.length > 0 && (
              <ul className={styles.problemList}>
                {errors.map((problem, index) => {
                  const location = problemLocation(problem);
                  return (
                    <li key={index}>
                      {location ? <span className={styles.problemLocation}>{location}: </span> : null}
                      {problem.message}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className={styles.hint}>Fix the file and try again, or choose a different one.</p>
          </div>
          <button type="button" className={styles.chooseButton} onClick={reset}>
            Try another file
          </button>
        </div>
      )}

      {stage === 'preview' && staged && (
        <div className={styles.previewBlock}>
          <dl className={styles.summary}>
            <div>
              <dt>Rows read</dt>
              <dd>{staged.preview.rowsRead}</dd>
            </div>
            <div>
              <dt>Rows kept</dt>
              <dd>{staged.preview.rowsKept}</dd>
            </div>
            <div>
              <dt>Date span</dt>
              <dd>
                {staged.preview.dateMin && staged.preview.dateMax
                  ? `${staged.preview.dateMin} to ${staged.preview.dateMax}`
                  : 'None'}
              </dd>
            </div>
          </dl>

          {droppedEntries.length > 0 && (
            <p className={styles.detailLine}>
              Dropped: {droppedEntries.map(([reason, count]) => `${reason} (${count})`).join(', ')}
            </p>
          )}

          {columnMapEntries.length > 0 && (
            <p className={styles.detailLine}>
              Matched columns: {columnMapEntries.map(([canonical, source]) => `${canonical} ← ${source}`).join(', ')}
            </p>
          )}

          {staged.preview.ignoredColumns.length > 0 && (
            <p className={styles.detailLine}>Ignored columns: {staged.preview.ignoredColumns.join(', ')}</p>
          )}

          {staged.preview.warnings.length > 0 && (
            <div className={styles.warnings}>
              {staged.preview.warnings.map((warning, index) => (
                <Callout key={index} tone="warning">
                  {(() => {
                    const location = problemLocation(warning);
                    return location ? `${location}: ${warning.message}` : warning.message;
                  })()}
                </Callout>
              ))}
            </div>
          )}

          <DataTable
            columns={sampleColumns}
            rows={staged.preview.sampleDaily}
            caption="Preview of imported daily rows"
          />

          <div className={styles.actions}>
            <button type="button" className={styles.primaryButton} onClick={confirmImport}>
              Import
            </button>
            <button type="button" className={styles.chooseButton} onClick={cancelPreview}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === 'imported' && importedSummary && (
        <div className={styles.importedBlock}>
          <svg className={styles.successCheck} viewBox="0 0 52 52" aria-hidden="true" focusable="false">
            <circle className={styles.successCheckCircle} cx="26" cy="26" r="24" fill="none" />
            <path className={styles.successCheckMark} fill="none" d="M14 27l7 7 17-17" />
          </svg>
          <Callout tone="good">{importedMessage(importedSummary)}</Callout>
          <button type="button" className={styles.chooseButton} onClick={reset}>
            Import another file
          </button>
        </div>
      )}
    </Card>
  );
}
