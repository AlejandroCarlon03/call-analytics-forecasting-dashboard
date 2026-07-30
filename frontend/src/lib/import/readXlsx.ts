/**
 * Turn a `.xlsx` workbook into the same `string[][]` shape `parseCsv`
 * produces from a CSV — header row first, then data rows — so
 * `buildFromCsv`'s column mapping, duration/currency parsing and daily
 * rollup stay the single implementation for both file formats. This file
 * does not reimplement any of that; it is purely "workbook -> rows of
 * strings".
 *
 * Only the *first* worksheet is read, matching a CSV's single implicit
 * sheet.
 *
 * ## Cell coercion
 *
 * `read-excel-file` returns typed values (`string | number | boolean |
 * Date | null`), not text — Excel itself has no "this cell is a string"
 * concept independent of its number format. Two of those types need care
 * so the text handed to `buildFromCsv` is exactly what a CSV export of the
 * same workbook would contain:
 *
 * - **A `Time` cell typed as a full timestamp** arrives as a `Date`
 *   resolved against `parseExcelTimestamp`'s UTC-based epoch. Its UTC
 *   fields are the wall-clock date and time the cell displays (there is no
 *   timezone in an Excel serial number to begin with), so formatting them
 *   with `getUTC*` and handing the result to `parseTimestamp`'s
 *   `YYYY-MM-DD HH:MM:SS` branch reproduces the display value exactly.
 * - **A `Call Duration` cell Excel typed as a time-of-day is the one real
 *   surprise, and it is not what the naive reading suggests.** Verified
 *   against the real workbook (`LatestRetellAIData.xlsx` / …CSV.csv on the
 *   Desktop — outside the repo, see `readXlsx.test.ts` for the committed
 *   fixture that pins the behaviour instead): the CSV export writes this
 *   column as `M:SS` (`ingest.py`'s `parse_duration_to_seconds` 2-part
 *   branch — `"1:29"` means one minute twenty-nine seconds). But whatever
 *   produced the `.xlsx` typed that same text into a cell and let Excel's
 *   default time auto-detection take it literally as `H:MM:SS`, storing
 *   `"1:29"` as **1 hour 29 minutes, 0 seconds** — a real Excel gotcha, not
 *   a bug in this reader or in `read-excel-file`. Every duration cell in
 *   the real workbook lands with `:00` seconds for exactly this reason: the
 *   text never had a seconds component to begin with.
 *
 *   So the seconds field is the signal. A cell with zero seconds is
 *   read as `M:SS` — the stored "hours" are re-labelled minutes and the
 *   stored "minutes" become seconds, undoing Excel's mistake and matching
 *   the CSV path's own parse of the same text. A cell with a genuine
 *   nonzero seconds field (only possible from a workbook built
 *   programmatically with an explicit `h:mm:ss` value, as the committed
 *   test fixture is) is read literally as `H:MM:SS`, which is what
 *   `parseDurationToSeconds` already expects for calls over an hour. The
 *   one call shape this cannot recover is a genuine multi-hour duration
 *   whose minutes and seconds both happen to be exact — indistinguishable
 *   from Excel's mistyped `M:SS` by the time it is a `Date` — and it does
 *   not occur in the real data: every duration here is a phone call, and
 *   phone calls do not run for whole hours.
 *
 * A cell typed as a plain number (e.g. `Cost`) or string passes through as
 * `String(value)` / the string itself — no different from how a CSV cell
 * already arrives as text.
 */

import { readSheet } from 'read-excel-file/browser';

/** What `read-excel-file` resolves to for a single requested sheet. */
type Cell = string | number | boolean | Date | null;

/**
 * A workbook a browser cannot open: corrupt, password-protected, or not
 * actually a `.xlsx` (a renamed `.xls`/`.csv`, for instance). Carries a
 * message already phrased for the reader.
 */
export class WorkbookReadError extends Error {}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `Date` -> `"YYYY-MM-DD HH:MM:SS"`, read off UTC fields (see module docblock). */
function formatTimestampCell(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const h = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const s = pad2(d.getUTCSeconds());
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

/**
 * `Date` -> duration text `parseDurationToSeconds` parses back to the
 * intended seconds count. See the module docblock: zero seconds means
 * Excel mistook a `"M:SS"` text entry for `H:MM:SS`, so the stored hours
 * and minutes are re-labelled as minutes and seconds to undo that. A
 * genuine nonzero-seconds cell is trusted literally as `H:MM:SS`.
 */
function formatDurationCell(d: Date): string {
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  if (s === 0) return `${h}:${pad2(mi)}`;
  return `${h}:${pad2(mi)}:${pad2(s)}`;
}

/**
 * A `Date` cell whose date component is the Excel epoch (1899-12-30, or
 * the following day when the serial rounds up to a full 24h) is a
 * time-of-day / duration value with no real calendar date attached, not a
 * timestamp. Excel's epoch, not year-1900 in general, so a genuine
 * appointment on New Year's Eve 1899 is not misread — nothing in this
 * dataset could produce that date any other way.
 */
function isTimeOfDayCell(d: Date): boolean {
  const y = d.getUTCFullYear();
  if (y !== 1899 && y !== 1900) return false;
  if (y === 1899) return d.getUTCMonth() === 11 && d.getUTCDate() === 30;
  return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
}

function cellToText(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return isTimeOfDayCell(value) ? formatDurationCell(value) : formatTimestampCell(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Read the first worksheet of an `.xlsx` workbook into `string[][]` —
 * header row, then data rows, exactly the shape `parseCsv` produces.
 *
 * Uses `readSheet` rather than the module's default export: the default
 * export resolves to an array of `{ sheet, data }` — one per worksheet in
 * the workbook — which is the right shape for reading every sheet but not
 * for reading "the first one", and this import deliberately only ever
 * wants the first worksheet, matching a CSV's single implicit sheet.
 * `readSheet(buffer, 1)` resolves directly to that sheet's rows.
 *
 * @throws {WorkbookReadError} for a file the browser cannot parse as an
 *   Office Open XML workbook (corrupt, password-protected, or not really
 *   `.xlsx`). Never rejects with anything else.
 */
export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  let rows: Array<Array<Cell>>;
  try {
    rows = (await readSheet(buffer, 1)) as Array<Array<Cell>>;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new WorkbookReadError(
      `This workbook could not be read (${detail}). It may be corrupt, password-protected, ` +
        'or not a valid .xlsx file.',
    );
  }

  return rows.map((row) => row.map(cellToText));
}
