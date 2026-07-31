// @vitest-environment jsdom
/**
 * `readImportFile` is owned by another agent working in parallel on
 * `lib/import`; these tests mock it so `ImportPanel` is testable against the
 * frozen contract in `lib/import/types.ts` regardless of whether the real
 * implementation exists yet.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPanel } from './ImportPanel';
import { readImportFile } from '../../lib/import';
import type { DashboardPayload } from '../../data/types';
import type { ImportPreview, ImportProgress, ImportResult } from '../../lib/import/types';

// Mock only `readImportFile`; `buildPreviewFields` is a pure helper the panel
// calls directly, so keep the real implementation.
vi.mock('../../lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/import')>();
  return { ...actual, readImportFile: vi.fn() };
});

const mockedRead = vi.mocked(readImportFile);

const PAYLOAD = { kind: 'csv' } as unknown as DashboardPayload;

const PREVIEW: ImportPreview = {
  kind: 'csv',
  fileName: 'my_export.csv',
  fileSize: 12345,
  rowsRead: 210,
  rowsKept: 205,
  dropped: { 'missing timestamp': 5 },
  dateMin: '2026-01-01',
  dateMax: '2026-07-01',
  columnMap: { date: 'Date', calls: 'Calls' },
  ignoredColumns: ['Notes'],
  sampleDaily: [{ date: '2026-01-01', calls: 100 }],
  warnings: [{ message: 'Some rows had unusual gaps.' }],
};

function okResult(): ImportResult {
  return { ok: true, payload: PAYLOAD, preview: PREVIEW };
}

/** A pipeline-JSON import, which carries the forecast metadata a CSV cannot. */
const PAYLOAD_IMPORT = {
  generatedAt: '2026-07-13T09:41:00',
  ingestion: { calendar_days: 74 },
  config: { forecast: { horizons: [30, 60, 90] }, models: { enabled: ['random_forest'] } },
  evaluations: {
    call_volume: { leaderboard: [{ model: 'random_forest', label: 'Random Forest' }] },
  },
} as unknown as DashboardPayload;

const PAYLOAD_PREVIEW: ImportPreview = {
  ...PREVIEW,
  kind: 'payload',
  fileName: 'dashboard_data.json',
  dateMin: '2026-05-01',
  dateMax: '2026-07-13',
};

function payloadOkResult(): ImportResult {
  return { ok: true, payload: PAYLOAD_IMPORT, preview: PAYLOAD_PREVIEW };
}

function errorResult(): ImportResult {
  return {
    ok: false,
    errors: [
      { message: 'No timestamp column found.' },
      { message: 'Cost was not numeric.', row: 412, column: 'Cost' },
    ],
  };
}

function makeFile(name = 'my_export.csv'): File {
  return new File(['a,b\n1,2'], name, { type: 'text/csv' });
}

beforeEach(() => {
  mockedRead.mockReset();
});

describe('ImportPanel', () => {
  it('renders the drop zone and file picker in the idle state, naming the active source', () => {
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /drag a file here/i })).toBeInTheDocument();
    expect(screen.getByText(/sample dataset/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a file to import/i)).toBeInTheDocument();
  });

  it('shows the preview after a successful read and does not call onImport', async () => {
    mockedRead.mockResolvedValue(okResult());
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<ImportPanel onImport={onImport} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
    const summary = screen.getByText('Rows kept').closest('div');
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText('205')).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('shows the six-field dashboard summary in the preview, before any ingestion detail', async () => {
    mockedRead.mockResolvedValue(payloadOkResult());
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
    for (const label of [
      'Dashboard Name',
      'Generation Time',
      'Forecast Horizon',
      'Available Models',
      'Reporting Period',
      'Dataset Size',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Real payload metadata is surfaced, not placeheld.
    expect(screen.getByText('dashboard_data.json')).toBeInTheDocument();
    expect(screen.getByText('30, 60, 90 days')).toBeInTheDocument();
    expect(screen.getByText('Random Forest')).toBeInTheDocument();
    expect(screen.getByText('01 May 2026 – 13 Jul 2026')).toBeInTheDocument();
  });

  it('shows honest placeholders for forecast metadata a raw CSV cannot carry', async () => {
    mockedRead.mockResolvedValue(okResult()); // PREVIEW.kind === 'csv'
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
    // Generation Time / Forecast Horizon / Available Models each say "not applicable".
    expect(screen.getAllByText(/not applicable/i).length).toBeGreaterThanOrEqual(3);
    // But a CSV still has a real reporting period.
    expect(screen.getByText('01 Jan 2026 – 01 Jul 2026')).toBeInTheDocument();
  });

  it('calls onImport exactly once with the payload and preview when Import is pressed', async () => {
    mockedRead.mockResolvedValue(okResult());
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<ImportPanel onImport={onImport} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(PAYLOAD, PREVIEW);
  });

  it('Cancel returns to idle without calling onImport', async () => {
    mockedRead.mockResolvedValue(okResult());
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<ImportPanel onImport={onImport} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: /choose file/i })).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('renders error messages, including row/column location, in a role="alert" container', async () => {
    mockedRead.mockResolvedValue(errorResult());
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No timestamp column found.');
    expect(alert).toHaveTextContent('row 412, column Cost');
    expect(alert).toHaveTextContent('Cost was not numeric.');
  });

  it('supports keyboard activation of the drop zone', async () => {
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const dropZone = screen.getByRole('button', { name: /drag a file here/i });
    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');

    dropZone.focus();
    await user.keyboard('{Enter}');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    await user.keyboard(' ');
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('sets a hover state on drag-over and clears it on drag-leave', () => {
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const dropZone = screen.getByRole('button', { name: /drag a file here/i });
    const dataTransfer = { files: [] as File[] };

    fireEvent.dragEnter(dropZone, { dataTransfer });
    expect(dropZone.className).toMatch(/dropZoneActive/);

    fireEvent.dragLeave(dropZone, { dataTransfer });
    expect(dropZone.className).not.toMatch(/dropZoneActive/);
  });

  it('sets aria-busy while reading', async () => {
    let resolveRead: (value: ImportResult) => void = () => {};
    mockedRead.mockReturnValue(
      new Promise<ImportResult>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    const dropZone = screen.getByRole('button', { name: /reading file/i });
    expect(dropZone).toHaveAttribute('aria-busy', 'true');

    resolveRead(okResult());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
  });

  it('calls readImportFile with a progress callback and shows the reported stage label', async () => {
    let resolveRead: (value: ImportResult) => void = () => {};
    mockedRead.mockImplementation(
      ((_file: File, onProgress?: ImportProgress) =>
        new Promise<ImportResult>((resolve) => {
          onProgress?.('parsing');
          resolveRead = resolve;
        })) as typeof readImportFile,
    );
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getAllByText(/parsing rows/i).length).toBeGreaterThan(0));
    resolveRead(okResult());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
  });

  it('shows a success state naming the file, rows kept and date span, and announces it', async () => {
    mockedRead.mockResolvedValue(okResult());
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Import' }));

    const confirmations = screen.getAllByText(/my_export\.csv/);
    expect(confirmations.length).toBeGreaterThan(0);
    const rowsKeptMatches = screen.getAllByText(/205 rows kept/);
    expect(rowsKeptMatches.length).toBeGreaterThan(0);
    const spanMatches = screen.getAllByText(/2026-01-01 to 2026-07-01/);
    expect(spanMatches.length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /import another file/i })).toBeInTheDocument();
  });

  it('lists every error message when there are several, with guidance text', async () => {
    mockedRead.mockResolvedValue(errorResult());
    const user = userEvent.setup();
    render(<ImportPanel onImport={vi.fn()} activeSourceLabel="sample dataset" />);

    const input = screen.getByLabelText(/choose a file to import/i) as HTMLInputElement;
    await user.upload(input, makeFile());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No timestamp column found.');
    expect(alert).toHaveTextContent('Cost was not numeric.');
    expect(alert).toHaveTextContent(/try again|different one/i);
  });
});
