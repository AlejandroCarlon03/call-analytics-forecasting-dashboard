/**
 * Reading and writing the import history to `localStorage`.
 *
 * Every access is wrapped, for the same reason `ThemeProvider` wraps the theme
 * preference: `localStorage` **throws** rather than returning null in real
 * situations — Safari private browsing, and any page opened from `file://` with
 * site data disabled. The production dashboard is opened from `file://` by
 * design (§8), so these paths are taken, not hypothetical. Persistence is a
 * convenience; a session with no storage at all still works, it just forgets.
 */

import {
  HISTORY_STORAGE_KEY,
  HISTORY_STORAGE_VERSION,
  type ImportHistoryEntry,
  type ImportHistoryState,
} from './types';

/** The empty record, returned whenever nothing valid can be read. */
export const EMPTY_HISTORY: ImportHistoryState = {
  version: HISTORY_STORAGE_VERSION,
  entries: [],
  activeId: null,
};

/**
 * Is this the browser's "you are out of storage" error?
 *
 * Named differently across engines and sometimes only distinguishable by the
 * legacy code 22, so all three spellings are checked. This is the one write
 * failure worth *reacting* to — by evicting and retrying — rather than giving
 * up on persistence entirely.
 */
function isQuotaError(error: unknown): boolean {
  // Matched by name/code rather than `instanceof DOMException`: the exception
  // can cross realm boundaries (and in tests is a synthesised one), where
  // `instanceof` fails even though the name and legacy code are right.
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: string; code?: number };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22;
}

/** A stored value is only usable if it has every field a reopen will read. */
function isValidEntry(value: unknown): value is ImportHistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.fileName === 'string' &&
    typeof entry.importedAt === 'string' &&
    (entry.kind === 'csv' || entry.kind === 'payload') &&
    typeof entry.analysisAvailable === 'boolean' &&
    typeof entry.payload === 'object' &&
    entry.payload !== null
  );
}

/**
 * Read the stored history, tolerating everything that can go wrong.
 *
 * Corrupt JSON, a truncated blob, a schema from a different version, an entry
 * missing a field, or storage that throws on read all resolve to the same safe
 * answer: an empty history. A single bad row is dropped rather than discarding
 * the whole record; a version mismatch discards everything, because the payload
 * shape itself may have changed and rendering a stale one would be worse than
 * forgetting it.
 */
export function readHistory(): ImportHistoryState {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_HISTORY;

    const state = parsed as Record<string, unknown>;
    if (state.version !== HISTORY_STORAGE_VERSION) return EMPTY_HISTORY;
    if (!Array.isArray(state.entries)) return EMPTY_HISTORY;

    const entries = state.entries.filter(isValidEntry);
    // An `activeId` that no longer names a surviving entry is meaningless, so
    // it degrades to "nothing active" rather than dangling.
    const activeId =
      typeof state.activeId === 'string' && entries.some((entry) => entry.id === state.activeId)
        ? state.activeId
        : null;

    return { version: HISTORY_STORAGE_VERSION, entries, activeId };
  } catch {
    return EMPTY_HISTORY;
  }
}

/**
 * Persist as much of `state` as fits, and return **what was actually stored**.
 *
 * The caller adopts the returned value as its own state, so the UI can never
 * claim to remember a dataset that did not survive the write. Under a quota
 * error the oldest entries are dropped one at a time and the write retried; if
 * storage is unavailable outright (not merely full), the desired state is
 * returned unstored so the session still works in memory.
 */
export function saveHistory(state: ImportHistoryState): ImportHistoryState {
  let entries = state.entries;

  for (;;) {
    const candidate: ImportHistoryState = {
      version: HISTORY_STORAGE_VERSION,
      entries,
      // Recompute rather than trust the incoming id: an eviction below could
      // have dropped the entry it pointed at.
      activeId: entries.some((entry) => entry.id === state.activeId) ? state.activeId : null,
    };

    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
      return candidate;
    } catch (error) {
      if (isQuotaError(error) && entries.length > 0) {
        // Drop the oldest (the tail) and try again. A single huge payload that
        // will not fit even alone falls through to the return below.
        entries = entries.slice(0, entries.length - 1);
        continue;
      }
      // Storage is disabled or the write is impossible. Keep working in memory.
      return state;
    }
  }
}
