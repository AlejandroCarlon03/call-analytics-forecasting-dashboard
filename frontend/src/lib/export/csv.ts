/**
 * CSV writer — RFC 4180.
 *
 * The only formatting decision this module is allowed to make is *escaping*,
 * never *rounding or display*. `registry.ts` already put the raw payload
 * numbers in each row; running them through `lib/format.ts` here would produce
 * a file with `$1,234.50` in a cell a script tries to `parseFloat`, which is
 * display formatting bleeding into a machine-readable format. `String(n)`
 * keeps exactly the precision the payload — and therefore the JSON export —
 * delivered.
 */

import type { ExportCell, ExportTable } from './types';

const CRLF = '\r\n';

/**
 * A leading UTF-8 BOM (`﻿`).
 *
 * Excel — still the primary consumer of a CSV a reader downloads by hand —
 * assumes the system codepage for a BOM-less file and mangles anything
 * non-ASCII (a model label, a feature name) on open. Prepending the BOM is
 * the one-byte fix every other spreadsheet and CSV parser already tolerates.
 */
const BOM = '﻿';

/** Quote a field per RFC 4180 whenever it contains a comma, quote, or CR/LF. */
function csvField(cell: ExportCell): string {
  if (cell === null) return '';
  const text = typeof cell === 'boolean' ? (cell ? 'true' : 'false') : String(cell);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Render an `ExportTable` as CSV text, BOM included. */
export function toCsv(table: ExportTable): string {
  const lines: string[] = [];
  lines.push(table.columns.map(csvField).join(','));
  for (const row of table.rows) {
    lines.push(table.columns.map((column) => csvField(row[column] ?? null)).join(','));
  }
  return BOM + lines.join(CRLF) + CRLF;
}
