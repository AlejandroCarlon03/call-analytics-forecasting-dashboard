/**
 * The one owner of import history.
 *
 * Called **once, in `App`**, and its methods are passed down as props — the same
 * single-owner shape selection (`useHashSelection`) and the export run state
 * use, and for the same reason: two copies of "which datasets have I imported"
 * would drift the moment one place recorded an import the other did not
 * (SESSION_CONTEXT §10). The two `RecentImports` renders (landing page and the
 * report) therefore read one hook, never a hook each.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { DashboardPayload } from '../../data/types';
import type { ImportPreview } from '../import/types';
import { readHistory, saveHistory } from './storage';
import { MAX_HISTORY_ENTRIES, type ImportHistoryEntry, type ImportHistoryState } from './types';

/**
 * A stable identity for an imported file.
 *
 * Keyed on the file's observable properties rather than a random id, so
 * re-importing the same file resolves to the same entry — which is what makes a
 * duplicate import *update* the existing row (new timestamp, moved to the top)
 * instead of stacking a second copy of the same dataset in the list.
 */
function signatureOf(preview: ImportPreview): string {
  return [
    preview.kind,
    preview.fileName,
    preview.fileSize,
    preview.rowsKept,
    preview.dateMin ?? '',
    preview.dateMax ?? '',
  ].join('|');
}

/** The history surface `App` drives and `RecentImports` renders. */
export interface ImportHistory {
  entries: ImportHistoryEntry[];
  activeId: string | null;
  /** The entry currently open, resolved from `activeId`. */
  activeEntry: ImportHistoryEntry | null;
  /** Remember an import (or refresh an existing one) and mark it current. */
  record: (payload: DashboardPayload, preview: ImportPreview, analysisAvailable: boolean) => void;
  /** Mark an entry current and return it, so the caller can restore its payload. */
  reopen: (id: string) => ImportHistoryEntry | null;
  /** Forget an entry. If it was current, nothing becomes current. */
  remove: (id: string) => void;
  /**
   * Set (or clear, with `null`) the current entry without swapping payloads.
   * `App` clears it when the view on screen is a fresh pipeline run rather than
   * a remembered dataset, so the "current" marker never sits on a row that is
   * not actually what is displayed (SESSION_CONTEXT §10).
   */
  markActive: (id: string | null) => void;
}

export function useImportHistory(): ImportHistory {
  // Read synchronously on first render, so the history is present before paint —
  // the shape `ThemeProvider` uses for the stored theme preference.
  const [state, setState] = useState<ImportHistoryState>(readHistory);

  // A mirror of the latest state for the callbacks to read, so they can stay
  // referentially stable (empty deps) without closing over a stale `state`.
  // Every mutation goes through `saveHistory`, which returns what actually
  // persisted, and that — not an optimistic copy — becomes the new state.
  const stateRef = useRef(state);
  stateRef.current = state;

  const record = useCallback(
    (payload: DashboardPayload, preview: ImportPreview, analysisAvailable: boolean) => {
      const previous = stateRef.current;
      const id = signatureOf(preview);
      const entry: ImportHistoryEntry = {
        id,
        fileName: preview.fileName,
        importedAt: new Date().toISOString(),
        kind: preview.kind,
        fileSize: preview.fileSize,
        rowsKept: preview.rowsKept,
        dateMin: preview.dateMin,
        dateMax: preview.dateMax,
        analysisAvailable,
        payload,
      };
      // Drop any prior copy of this file, put the fresh one first, and cap.
      const withoutDuplicate = previous.entries.filter((existing) => existing.id !== id);
      const entries = [entry, ...withoutDuplicate].slice(0, MAX_HISTORY_ENTRIES);
      setState(saveHistory({ version: previous.version, entries, activeId: id }));
    },
    [],
  );

  const reopen = useCallback((id: string): ImportHistoryEntry | null => {
    const previous = stateRef.current;
    const entry = previous.entries.find((existing) => existing.id === id) ?? null;
    if (!entry) return null;
    setState(saveHistory({ ...previous, activeId: id }));
    return entry;
  }, []);

  const remove = useCallback((id: string) => {
    const previous = stateRef.current;
    const entries = previous.entries.filter((existing) => existing.id !== id);
    // Removing the current dataset clears the indicator but does *not* unload
    // what is on screen — the reader is mid-view, and forgetting the history
    // row is not a request to close the report.
    const activeId = previous.activeId === id ? null : previous.activeId;
    setState(saveHistory({ version: previous.version, entries, activeId }));
  }, []);

  const markActive = useCallback((id: string | null) => {
    const previous = stateRef.current;
    // Only a `null` (clear) or an id that names a real entry is meaningful.
    const activeId = id === null || previous.entries.some((e) => e.id === id) ? id : previous.activeId;
    if (activeId === previous.activeId) return;
    setState(saveHistory({ ...previous, activeId }));
  }, []);

  const activeEntry = useMemo(
    () => state.entries.find((entry) => entry.id === state.activeId) ?? null,
    [state],
  );

  return {
    entries: state.entries,
    activeId: state.activeId,
    activeEntry,
    record,
    reopen,
    remove,
    markActive,
  };
}
