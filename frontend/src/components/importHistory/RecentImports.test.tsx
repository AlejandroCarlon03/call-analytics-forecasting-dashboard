// @vitest-environment jsdom
/**
 * `RecentImports`' own contract: it lists entries with their metadata, marks
 * the current one, reopens and removes on click, and renders the right empty
 * state for each variant.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { DashboardPayload } from '../../data/types';
import type { ImportHistoryEntry } from '../../lib/importHistory';
import { RecentImports } from './RecentImports';

function entry(overrides: Partial<ImportHistoryEntry> = {}): ImportHistoryEntry {
  return {
    id: 'id-a',
    fileName: 'calls_2026.csv',
    importedAt: '2026-07-31T14:12:00.000Z',
    kind: 'csv',
    fileSize: 4096,
    rowsKept: 172,
    dateMin: '2026-05-01',
    dateMax: '2026-07-13',
    analysisAvailable: false,
    payload: { schemaVersion: 1 } as unknown as DashboardPayload,
    ...overrides,
  };
}

function renderList(overrides: Partial<Parameters<typeof RecentImports>[0]> = {}) {
  const props = {
    entries: [entry()],
    activeId: null as string | null,
    onReopen: vi.fn(),
    onRemove: vi.fn(),
    variant: 'panel' as const,
    ...overrides,
  };
  render(<RecentImports {...props} />);
  return props;
}

describe('RecentImports list', () => {
  it('shows the file name, the import time and available metadata', () => {
    renderList();
    expect(screen.getByText('calls_2026.csv')).toBeInTheDocument();
    // Rendered through a <time> carrying the machine-readable value.
    const time = document.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-07-31T14:12:00.000Z');
    // Metadata parts: kind, rows kept, and the date span.
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('172 rows')).toBeInTheDocument();
    expect(screen.getByText('2026-05-01 → 2026-07-13')).toBeInTheDocument();
  });

  it('labels a pipeline import differently from a raw CSV', () => {
    renderList({ entries: [entry({ kind: 'payload' })] });
    expect(screen.getByText('Pipeline JSON')).toBeInTheDocument();
  });

  it('omits metadata parts the entry does not carry', () => {
    renderList({ entries: [entry({ rowsKept: null, dateMin: null, dateMax: null })] });
    expect(screen.queryByText(/rows?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
    // The kind is always present.
    expect(screen.getByText('CSV')).toBeInTheDocument();
  });

  it('marks the current entry with aria-current and a visible badge', () => {
    renderList({ entries: [entry({ id: 'id-a' })], activeId: 'id-a' });
    const open = screen.getByRole('button', { name: /Reopen calls_2026\.csv/ });
    expect(open).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('marks no entry current when nothing is active', () => {
    renderList({ activeId: null });
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reopen calls_2026\.csv/ })).not.toHaveAttribute('aria-current');
  });

  it('reopens on clicking the entry', async () => {
    const { onReopen } = renderList();
    await userEvent.click(screen.getByRole('button', { name: /Reopen calls_2026\.csv/ }));
    expect(onReopen).toHaveBeenCalledWith('id-a');
  });

  it('removes on clicking the remove control, which names the file', async () => {
    const { onRemove } = renderList();
    const remove = screen.getByRole('button', { name: 'Remove calls_2026.csv from recent imports' });
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith('id-a');
  });

  it('renders each entry as a list item', () => {
    renderList({ entries: [entry({ id: 'a', fileName: 'a.csv' }), entry({ id: 'b', fileName: 'b.csv' })] });
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('RecentImports empty state', () => {
  it('landing variant offers a call to action wired to onImport', async () => {
    const onImport = vi.fn();
    render(
      <RecentImports
        entries={[]}
        activeId={null}
        onReopen={vi.fn()}
        onRemove={vi.fn()}
        variant="landing"
        onImport={onImport}
      />,
    );
    expect(screen.getByText('No imports yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import a dataset' }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('panel variant is a single muted line, with no call to action', () => {
    render(
      <RecentImports entries={[]} activeId={null} onReopen={vi.fn()} onRemove={vi.fn()} variant="panel" />,
    );
    expect(screen.getByText(/No datasets imported yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import a dataset' })).not.toBeInTheDocument();
  });
});
