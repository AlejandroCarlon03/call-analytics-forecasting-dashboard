// @vitest-environment jsdom
/**
 * `useImportHistory`'s contract: record/reopen/remove, de-duplication of the
 * same file, the cap, current-entry tracking, and that it initialises from
 * whatever was already persisted.
 */

import '@testing-library/jest-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DashboardPayload } from '../../data/types';
import type { ImportPreview } from '../import/types';
import { useImportHistory } from './useImportHistory';
import { MAX_HISTORY_ENTRIES } from './types';
import { saveHistory } from './storage';
import { HISTORY_STORAGE_VERSION } from './types';

function payload(tag: string): DashboardPayload {
  return { schemaVersion: 1, generatedAt: tag } as unknown as DashboardPayload;
}

function preview(fileName: string, overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    kind: 'csv',
    fileName,
    fileSize: 2048,
    rowsRead: 120,
    rowsKept: 118,
    dropped: {},
    dateMin: '2026-01-01',
    dateMax: '2026-03-01',
    columnMap: {},
    ignoredColumns: [],
    sampleDaily: [],
    warnings: [],
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('useImportHistory', () => {
  it('records an import, marks it current, and exposes the active entry', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]!.fileName).toBe('a.csv');
    expect(result.current.activeId).toBe(result.current.entries[0]!.id);
    expect(result.current.activeEntry?.fileName).toBe('a.csv');
  });

  it('puts the newest import first', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    act(() => result.current.record(payload('b'), preview('b.csv'), false));

    expect(result.current.entries.map((e) => e.fileName)).toEqual(['b.csv', 'a.csv']);
  });

  it('re-importing the same file updates one row rather than duplicating it', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    act(() => result.current.record(payload('b'), preview('b.csv'), false));
    // Same signature as the first import (same name/size/rows/dates).
    act(() => result.current.record(payload('a2'), preview('a.csv'), false));

    expect(result.current.entries).toHaveLength(2);
    // The refreshed one is now at the front, carrying the newer payload.
    expect(result.current.entries[0]!.fileName).toBe('a.csv');
    expect(result.current.entries[0]!.payload.generatedAt).toBe('a2');
    expect(result.current.activeEntry?.payload.generatedAt).toBe('a2');
  });

  it('caps the history at MAX_HISTORY_ENTRIES, dropping the oldest', () => {
    const { result } = renderHook(() => useImportHistory());
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 3; i += 1) {
      act(() => result.current.record(payload(`p${i}`), preview(`file${i}.csv`), false));
    }
    expect(result.current.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    // The three earliest are gone; the most recent survive, newest first.
    expect(result.current.entries[0]!.fileName).toBe(`file${MAX_HISTORY_ENTRIES + 2}.csv`);
    expect(result.current.entries.some((e) => e.fileName === 'file0.csv')).toBe(false);
  });

  it('reopen returns the stored entry and marks it current', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), true));
    act(() => result.current.record(payload('b'), preview('b.csv'), false));
    const firstId = result.current.entries[1]!.id;

    let returned: ReturnType<typeof result.current.reopen> = null;
    act(() => {
      returned = result.current.reopen(firstId);
    });

    expect(returned).not.toBeNull();
    expect(returned!.fileName).toBe('a.csv');
    expect(returned!.analysisAvailable).toBe(true);
    expect(result.current.activeId).toBe(firstId);
  });

  it('reopen returns null for an unknown id and changes nothing', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    const before = result.current.activeId;

    let returned: ReturnType<typeof result.current.reopen> = 'unset' as never;
    act(() => {
      returned = result.current.reopen('nope');
    });
    expect(returned).toBeNull();
    expect(result.current.activeId).toBe(before);
  });

  it('remove forgets an entry and clears the indicator if it was current', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    const id = result.current.activeId!;
    act(() => result.current.remove(id));

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.activeId).toBeNull();
  });

  it('removing a non-current entry leaves the current one active', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    act(() => result.current.record(payload('b'), preview('b.csv'), false)); // current
    const currentId = result.current.activeId!;
    const otherId = result.current.entries.find((e) => e.id !== currentId)!.id;

    act(() => result.current.remove(otherId));

    expect(result.current.entries.map((e) => e.fileName)).toEqual(['b.csv']);
    expect(result.current.activeId).toBe(currentId);
  });

  it('markActive clears the current marker without touching the entries', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    expect(result.current.activeId).not.toBeNull();

    act(() => result.current.markActive(null));

    expect(result.current.activeId).toBeNull();
    expect(result.current.entries).toHaveLength(1); // the row is untouched
  });

  it('markActive ignores an id that names no entry', () => {
    const { result } = renderHook(() => useImportHistory());
    act(() => result.current.record(payload('a'), preview('a.csv'), false));
    const current = result.current.activeId;
    act(() => result.current.markActive('nope'));
    expect(result.current.activeId).toBe(current);
  });

  it('initialises from whatever was already persisted', () => {
    // Seed storage before the hook mounts.
    saveHistory({
      version: HISTORY_STORAGE_VERSION,
      entries: [
        {
          id: 'seed',
          fileName: 'seeded.csv',
          importedAt: '2026-07-01T00:00:00.000Z',
          kind: 'csv',
          fileSize: null,
          rowsKept: null,
          dateMin: null,
          dateMax: null,
          analysisAvailable: false,
          payload: payload('seed'),
        },
      ],
      activeId: 'seed',
    });

    const { result } = renderHook(() => useImportHistory());
    expect(result.current.entries.map((e) => e.fileName)).toEqual(['seeded.csv']);
    expect(result.current.activeEntry?.id).toBe('seed');
  });
});
