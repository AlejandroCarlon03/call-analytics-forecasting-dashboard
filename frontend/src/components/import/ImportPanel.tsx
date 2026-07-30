import { useCallback, useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import type { DashboardPayload } from '../../data/types';
import { readImportFile } from '../../lib/import';
import type { ImportPreview, ImportProblem, ImportResult } from '../../lib/import/types';
import { ACCEPTED_EXTENSIONS } from '../../lib/import/types';
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

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

function problemLocation(problem: ImportProblem): string | null {
  if (problem.row !== undefined && problem.column) return `row ${problem.row}, column ${problem.column}`;
  if (problem.row !== undefined) return `row ${problem.row}`;
  if (problem.column) return `column ${problem.column}`;
  return null;
}

/**
 * Reads a CSV or a pipeline JSON export and, once the reader confirms the
 * preview, hands the resulting payload back to `App`.
 *
 * Nothing is applied until "Import" is pressed — the preview stage exists so
 * a swap of the dashboard's one source of truth is never a surprise.
 */
export function ImportPanel({ onImport, activeSourceLabel }: ImportPanelProps) {
  const [stage, setStage] = useState<Stage>('idle');
  const [errors, setErrors] = useState<ImportProblem[]>([]);
  const [staged, setStaged] = useState<StagedResult | null>(null);
  const [importedLabel, setImportedLabel] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();

  const busy = stage === 'reading';

  const handleFile = useCallback(async (file: File) => {
    setStage('reading');
    setDragActive(false);
    dragCounter.current = 0;
    let result: ImportResult;
    try {
      result = await readImportFile(file);
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
    setStage('idle');
  };

  const confirmImport = () => {
    if (!staged) return;
    onImport(staged.payload, staged.preview);
    setImportedLabel(staged.preview.fileName);
    setStage('imported');
    setStaged(null);
  };

  const cancelPreview = () => {
    setStaged(null);
    setStage('idle');
  };

  const liveMessage =
    stage === 'reading'
      ? 'Reading file…'
      : stage === 'preview' && staged
        ? `Preview ready: ${staged.preview.rowsKept} of ${staged.preview.rowsRead} rows kept.`
        : stage === 'error'
          ? 'Import failed.'
          : stage === 'imported' && importedLabel
            ? `Imported ${importedLabel}.`
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
              <p className={styles.status}>Reading file…</p>
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

      {stage === 'imported' && (
        <div className={styles.importedBlock}>
          <Callout tone="good">
            {importedLabel ? `Imported ${importedLabel}.` : 'Import complete.'}
          </Callout>
          <button type="button" className={styles.chooseButton} onClick={reset}>
            Import another file
          </button>
        </div>
      )}
    </Card>
  );
}
