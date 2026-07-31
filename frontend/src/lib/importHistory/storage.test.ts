// @vitest-environment jsdom
/**
 * The storage layer's contract: it round-trips a valid record, and it never
 * throws or lies about what it kept when the stored blob is corrupt, from a
 * different version, or when the browser refuses the write.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardPayload } from '../../data/types';
import { EMPTY_HISTORY, readHistory, saveHistory } from './storage';
import { HISTORY_STORAGE_KEY, HISTORY_STORAGE_VERSION, type ImportHistoryEntry } from './types';

/** A minimal payload — storage does not inspect its shape, only that it exists. */
function payload(): DashboardPayload {
  return { schemaVersion: 1 } as unknown as DashboardPayload;
}

function entry(id: string, overrides: Partial<ImportHistoryEntry> = {}): ImportHistoryEntry {
  return {
    id,
    fileName: `${id}.csv`,
    importedAt: '2026-07-31T12:00:00.000Z',
    kind: 'csv',
    fileSize: 1024,
    rowsKept: 100,
    dateMin: '2026-01-01',
    dateMax: '2026-03-01',
    analysisAvailable: false,
    payload: payload(),
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('readHistory', () => {
  it('returns the empty history when nothing is stored', () => {
    expect(readHistory()).toEqual(EMPTY_HISTORY);
  });

  it('round-trips a saved record', () => {
    const saved = saveHistory({ version: HISTORY_STORAGE_VERSION, entries: [entry('a')], activeId: 'a' });
    expect(saved.entries).toHaveLength(1);
    const read = readHistory();
    expect(read.entries.map((e) => e.id)).toEqual(['a']);
    expect(read.activeId).toBe('a');
  });

  it('discards a blob written by a different version', () => {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ version: HISTORY_STORAGE_VERSION + 1, entries: [entry('a')], activeId: 'a' }),
    );
    expect(readHistory()).toEqual(EMPTY_HISTORY);
  });

  it('recovers to empty on corrupt JSON', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, '{ not json');
    expect(readHistory()).toEqual(EMPTY_HISTORY);
  });

  it('drops a single malformed entry but keeps the valid ones', () => {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: HISTORY_STORAGE_VERSION,
        entries: [entry('good'), { id: 'bad', fileName: 'x' /* missing fields */ }],
        activeId: 'good',
      }),
    );
    const read = readHistory();
    expect(read.entries.map((e) => e.id)).toEqual(['good']);
    expect(read.activeId).toBe('good');
  });

  it('drops an activeId that no longer names a surviving entry', () => {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify({ version: HISTORY_STORAGE_VERSION, entries: [entry('a')], activeId: 'gone' }),
    );
    expect(readHistory().activeId).toBeNull();
  });

  it('returns empty when localStorage.getItem throws', () => {
    // Spy on the prototype: jsdom's `localStorage` instance does not intercept a
    // spy on its own methods, but `Storage.prototype` does.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied');
    });
    expect(readHistory()).toEqual(EMPTY_HISTORY);
  });
});

describe('saveHistory', () => {
  it('persists and returns the same entries when there is room', () => {
    const state = { version: HISTORY_STORAGE_VERSION, entries: [entry('a'), entry('b')], activeId: 'a' };
    const saved = saveHistory(state);
    expect(saved.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(readHistory().entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('evicts the oldest under a quota error, and reports what actually fit', () => {
    let calls = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      calls += 1;
      // Fail while three entries are present, succeed once trimmed to two.
      if (calls === 1) throw new DOMException('full', 'QuotaExceededError');
    });
    const saved = saveHistory({
      version: HISTORY_STORAGE_VERSION,
      entries: [entry('new'), entry('mid'), entry('old')],
      activeId: 'new',
    });
    // The newest survive, the oldest ('old', the tail) was dropped.
    expect(saved.entries.map((e) => e.id)).toEqual(['new', 'mid']);
    expect(saved.activeId).toBe('new');
  });

  it('keeps the desired state in memory when storage is unavailable outright', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('disabled', 'SecurityError');
    });
    const state = { version: HISTORY_STORAGE_VERSION, entries: [entry('a')], activeId: 'a' };
    // A non-quota failure is not retried; the caller still gets a usable value.
    expect(saveHistory(state).entries.map((e) => e.id)).toEqual(['a']);
  });

  it('nulls an activeId that points at no surviving entry', () => {
    const saved = saveHistory({ version: HISTORY_STORAGE_VERSION, entries: [entry('a')], activeId: 'ghost' });
    expect(saved.activeId).toBeNull();
  });
});
