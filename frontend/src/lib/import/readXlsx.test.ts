/**
 * `readXlsx` against a small committed fixture workbook
 * (`fixtures/sample_workbook.xlsx`, generated with openpyxl — see the
 * script noted below) rather than the real RetellAI export, which lives
 * outside the repo and cannot be a committed test dependency.
 *
 * The fixture is deliberately built to exercise the two coercions the
 * module docblock calls out: a `Time` cell Excel stores as a full
 * datetime, and a `Call Duration` cell Excel stores as a time-of-day
 * (`1:29`, meaning one minute twenty-nine seconds) rather than free text.
 *
 * To regenerate: see the `openpyxl` snippet in the PR description / task
 * notes for this file — three rows, column A formatted `yyyy-mm-dd
 * hh:mm:ss`, column B formatted `h:mm:ss` where non-blank.
 */
import { describe, expect, it } from 'vitest';
import { readXlsx, WorkbookReadError } from './readXlsx';
import { buildFromCsv } from './buildFromCsv';
import { parseDurationToSeconds, parseTimestamp } from './callSchema';
import { SAMPLE_WORKBOOK_BASE64 } from './fixtures/sampleWorkbookBase64';

/**
 * `atob` rather than `node:fs` — this project's tsconfig carries no
 * `@types/node` (see `crossValidation.test.ts`'s docblock for why), and a
 * binary fixture is committed as a base64 string for exactly that reason.
 */
function fixtureBuffer(): ArrayBuffer {
  const binary = atob(SAMPLE_WORKBOOK_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

describe('readXlsx', () => {
  it('reads the header row and data rows as strings', async () => {
    const rows = await readXlsx(fixtureBuffer());

    expect(rows[0]).toEqual([
      'Time',
      'Call Duration',
      'Cost',
      'Disconnection Reason',
      'Call Status',
      'User Sentiment',
      'Call Successful',
      'End to End Latency',
    ]);
    expect(rows).toHaveLength(4); // header + 3 data rows
    for (const row of rows) {
      for (const cell of row) {
        expect(typeof cell).toBe('string');
      }
    }
  });

  it('formats a duration-typed cell so parseDurationToSeconds understands it', async () => {
    const rows = await readXlsx(fixtureBuffer());
    // Row 2 (index 2, after header) carries a duration of 1:29 = 89s.
    const durationCell = rows[2]![1]!;
    expect(parseDurationToSeconds(durationCell)).toBe(89);
  });

  it('formats a timestamp-typed cell so parseTimestamp understands it', async () => {
    const rows = await readXlsx(fixtureBuffer());
    const tsCell = rows[1]![0]!;
    const parsed = parseTimestamp(tsCell);
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(4); // May, 0-indexed
    expect(parsed!.getDate()).toBe(18);
    expect(parsed!.getHours()).toBe(12);
    expect(parsed!.getMinutes()).toBe(1);
  });

  it('leaves a blank cell as an empty string, not "null" or "undefined"', async () => {
    const rows = await readXlsx(fixtureBuffer());
    // Row 3 has no duration and no latency.
    expect(rows[3]![1]).toBe('');
    expect(rows[3]![7]).toBe('');
  });

  it('passes a plain numeric cell through as text', async () => {
    const rows = await readXlsx(fixtureBuffer());
    expect(rows[1]![2]).toBe('0.038');
  });

  it('feeds cleanly into buildFromCsv, producing a valid payload', async () => {
    const rows = await readXlsx(fixtureBuffer());
    const csvText = rows.map((r) => r.join(',')).join('\r\n');
    const result = buildFromCsv(csvText, 'sample_workbook.xlsx', 1234);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.ingestion.rows_read).toBe(3);
      expect(result.payload.ingestion.rows_kept).toBe(3);
    }
  });

  it('rejects a file that is not a valid workbook with a WorkbookReadError', async () => {
    const garbage = new TextEncoder().encode('not an xlsx file at all').buffer;
    await expect(readXlsx(garbage as ArrayBuffer)).rejects.toThrow(WorkbookReadError);
  });
});
