/**
 * A hand-written RFC 4180 CSV tokenizer.
 *
 * No `split(',')` — quoted fields can contain commas, newlines and escaped
 * `""` quotes, none of which a naive split handles. This walks the text
 * character by character instead, which is the only way to get quoting
 * right without pulling in a dependency (the lead's constraint: no new
 * npm packages).
 *
 * Handles: quoted fields, `""` escaped quotes inside quotes, commas and
 * newlines inside quotes, CRLF and LF line endings, a trailing newline, and
 * a leading UTF-8 BOM. Throws a descriptive `Error` on an unterminated
 * quoted field.
 */
export function parseCsv(text: string): string[][] {
  // Strip a leading UTF-8 BOM, which Excel and many export tools prepend.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"' && field === '' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }

    if (c === ',') {
      endField();
      i += 1;
      continue;
    }

    if (c === '\r') {
      if (text[i + 1] === '\n') {
        endRow();
        i += 2;
        continue;
      }
      endRow();
      i += 1;
      continue;
    }

    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += c;
    fieldStarted = true;
    i += 1;
  }

  if (inQuotes) {
    throw new Error(
      `Unterminated quoted field: a "\"" was opened but never closed (row ${rows.length + 1}).`,
    );
  }

  // Flush a trailing field/row, unless the file ended cleanly on a newline
  // (in which case there is nothing left to flush).
  if (field !== '' || fieldStarted || row.length > 0) {
    endRow();
  }

  return rows;
}
