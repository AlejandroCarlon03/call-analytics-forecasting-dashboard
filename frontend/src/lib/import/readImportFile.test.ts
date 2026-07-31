/**
 * `readImportFile` — the DOM-touching seam that branches on extension and
 * hands off to `buildFromCsv` / `buildFromPayloadJson` / `readXlsx`. Node's
 * global `File` (with `.text()` and `.arrayBuffer()`) is enough to exercise
 * this without jsdom.
 */
import { describe, expect, it, vi } from 'vitest';
import { readImportFile } from './readImportFile';
import { MAX_FILE_BYTES, type ImportStage } from './types';
import { SAMPLE_WORKBOOK_BASE64 } from './fixtures/sampleWorkbookBase64';

/** See `readXlsx.test.ts` for why this is `atob` rather than `node:fs`. */
function fixtureFile(): File {
  const binary = atob(SAMPLE_WORKBOOK_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], 'sample_workbook.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('readImportFile', () => {
  it('rejects a file over MAX_FILE_BYTES with the exact CSV-path message shape', async () => {
    const big = new File([new Uint8Array(1)], 'big.csv');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    const result = await readImportFile(big);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.message).toMatch(/above the 25 MB import limit/);
    }
  });

  it('rejects an unsupported extension', async () => {
    const file = new File(['hello'], 'notes.txt');
    const result = await readImportFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.message).toMatch(/Unsupported file type/);
    }
  });

  it('reads a real .xlsx file and produces the same shape buildFromCsv does', async () => {
    const result = await readImportFile(fixtureFile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.kind).toBe('csv');
      expect(result.preview.rowsRead).toBe(3);
      expect(result.preview.rowsKept).toBe(3);
    }
  });

  it('calls onProgress with reading, decoding, parsing, aggregating in order for .xlsx', async () => {
    const stages: ImportStage[] = [];
    const onProgress = vi.fn((s: ImportStage) => stages.push(s));
    await readImportFile(fixtureFile(), onProgress);
    expect(stages).toEqual(['reading', 'decoding', 'parsing', 'aggregating']);
  });

  it('works with no onProgress passed at all (optional, existing callers unaffected)', async () => {
    await expect(readImportFile(fixtureFile())).resolves.toMatchObject({ ok: true });
  });

  it('produces a specific, actionable error for a corrupt .xlsx rather than an unhandled rejection', async () => {
    const corrupt = new File([new TextEncoder().encode('this is not a zip')], 'bad.xlsx');
    const result = await readImportFile(corrupt);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]!.message).toMatch(/could not be read/i);
      expect(result.errors[0]!.message).toMatch(/corrupt|password-protected|not a valid/i);
    }
  });

  it('still reads .csv text through the original path (byte-for-byte behaviour preserved)', async () => {
    const csv = 'time,call_duration,cost\n2026-01-01 10:00:00,1:00,0.10\n';
    const file = new File([csv], 'export.csv', { type: 'text/csv' });
    const result = await readImportFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.rowsRead).toBe(1);
    }
  });

  it('emits reading + parsing (+ aggregating) for a .csv, with no decoding stage', async () => {
    const stages: ImportStage[] = [];
    const csv = 'time,call_duration,cost\n2026-01-01 10:00:00,1:00,0.10\n';
    const file = new File([csv], 'export.csv', { type: 'text/csv' });
    await readImportFile(file, (s) => stages.push(s));
    expect(stages).toEqual(['reading', 'parsing', 'aggregating']);
  });

  it('still reads .json through the original path', async () => {
    const json = JSON.stringify({ not: 'a payload' });
    const file = new File([json], 'export.json', { type: 'application/json' });
    const result = await readImportFile(file);
    expect(result.ok).toBe(false); // not a real payload, but reached buildFromPayloadJson
  });
});
