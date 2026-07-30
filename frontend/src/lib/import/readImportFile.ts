/**
 * The one file in this module allowed to touch DOM APIs — `File`,
 * `File.text()` and `File.arrayBuffer()` — so every other file here stays
 * a pure function testable without jsdom.
 */

import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from './types';
import type { ImportProgress, ImportResult } from './types';
import { buildFromCsv } from './buildFromCsv';
import { buildFromPayloadJson } from './buildFromPayloadJson';
import { readXlsx, WorkbookReadError } from './readXlsx';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

/** RFC 4180 field escaping: quote a field that needs it, doubling embedded quotes. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Re-serialise the rows a workbook produced back into CSV text, so the
 * xlsx path can hand off to `buildFromCsv` — the single, audited
 * implementation of column mapping, duration/currency parsing and the
 * daily rollup — rather than duplicating any of it here.
 */
function rowsToCsvText(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

export async function readImportFile(
  file: File,
  onProgress?: ImportProgress,
): Promise<ImportResult> {
  onProgress?.('reading');

  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      errors: [{ message: `This file is ${mb} MB, above the ${limitMb} MB import limit.` }],
    };
  }

  const ext = extensionOf(file.name);
  if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    return {
      ok: false,
      errors: [
        {
          message: `Unsupported file type "${ext || file.name}". Accepted types: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
        },
      ],
    };
  }

  if (ext === '.xlsx') {
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { ok: false, errors: [{ message: `Could not read this file (${detail}).` }] };
    }

    onProgress?.('decoding');
    let rows: string[][];
    try {
      rows = await readXlsx(buffer);
    } catch (e) {
      if (e instanceof WorkbookReadError) {
        return { ok: false, errors: [{ message: e.message }] };
      }
      const detail = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        errors: [
          {
            message:
              `This workbook could not be read (${detail}). It may be corrupt, ` +
              'password-protected, or not a valid .xlsx file.',
          },
        ],
      };
    }

    onProgress?.('parsing');
    onProgress?.('aggregating');
    return buildFromCsv(rowsToCsvText(rows), file.name, file.size);
  }

  const text = await file.text();

  if (ext === '.json') {
    onProgress?.('parsing');
    return buildFromPayloadJson(text, file.name, file.size);
  }
  onProgress?.('parsing');
  onProgress?.('aggregating');
  return buildFromCsv(text, file.name, file.size);
}
