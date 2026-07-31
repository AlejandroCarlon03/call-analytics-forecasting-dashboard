/**
 * The import-history contract.
 *
 * Import history lets a reader reopen a dataset they imported earlier without
 * choosing the file again. It is **entirely client-side** — a `localStorage`
 * record, no backend, no API — which is the same constraint the whole import
 * feature was built under (SESSION_CONTEXT §12).
 *
 * Two decisions live here rather than in any one consumer.
 *
 * **An entry carries the whole `DashboardPayload`, not a pointer to the file.**
 * Reopening must restore the dashboard *exactly as if it had just been
 * imported*, and the file the reader dropped is long gone — a browser cannot
 * re-read it later. The payload is the only thing that reproduces the view, so
 * it is what we keep. Payloads are ~130–275 KB (§8), which is why the history
 * is capped (`MAX_HISTORY_ENTRIES`) and the writer evicts under quota pressure
 * rather than assuming the write always succeeds (`storage.ts`).
 *
 * **`analysisAvailable` is stored beside the payload, never on it.** A raw CSV
 * this browser aggregated has no forecasts, and a section that renders an empty
 * state for a *run that never happened* is asserting something false (§12, §19).
 * The flag that tells the two apart is `App`'s, not `serialize.py`'s, so a
 * reopened entry has to carry the app's own answer — the payload cannot supply
 * it.
 */

import type { DashboardPayload } from '../../data/types';
import type { ImportKind } from '../import/types';

/**
 * `localStorage` key. Namespaced the same way the theme preference is
 * (`ThemeProvider`), so it cannot collide with anything else on a shared origin.
 */
export const HISTORY_STORAGE_KEY = 'call-forecast:import-history';

/**
 * Persisted-shape version.
 *
 * A stored blob written by a *different* version is a schema this build cannot
 * safely read — the payload contract itself may have changed — so `readHistory`
 * discards it rather than rendering it. Bump this when `ImportHistoryEntry` or
 * `DashboardPayload` changes shape, and old history is dropped cleanly instead
 * of crashing a reopen.
 */
export const HISTORY_STORAGE_VERSION = 1;

/**
 * How many datasets to remember.
 *
 * Small on purpose: each entry is a full payload, and the storage budget is a
 * few megabytes shared with the theme preference. Eight covers "the handful of
 * files I switch between" without the history becoming the thing that fills the
 * quota. The newest is kept and the oldest evicted (`storage.ts`).
 */
export const MAX_HISTORY_ENTRIES = 8;

/** One remembered import. */
export interface ImportHistoryEntry {
  /**
   * Stable identity, derived from the file's observable properties
   * (`useImportHistory.signatureOf`). Re-importing the same file updates this
   * one row rather than adding a duplicate — the "duplicate imports" edge case.
   */
  id: string;
  /** The imported file's name, e.g. `calls_2026.csv`. */
  fileName: string;
  /** When it was imported (or last re-imported), ISO 8601. */
  importedAt: string;
  /** Which route produced the payload — decides how complete it is (§12). */
  kind: ImportKind;
  /** Optional metadata, surfaced when present. `null` when the route had none. */
  fileSize: number | null;
  rowsKept: number | null;
  dateMin: string | null;
  dateMax: string | null;
  /** Whether a pipeline actually analysed this data (see the file docblock). */
  analysisAvailable: boolean;
  /** The payload itself — what a reopen restores. */
  payload: DashboardPayload;
}

/** The whole persisted record: the entries and which one is currently open. */
export interface ImportHistoryState {
  version: number;
  /** Newest first. Index 0 is the most recent import. */
  entries: ImportHistoryEntry[];
  /**
   * The entry currently rendered, or `null` when the current view did not come
   * from history (the initial pipeline run, or a dataset just removed). Drives
   * the "currently opened" indicator and the restore-on-load (`App`).
   */
  activeId: string | null;
}
