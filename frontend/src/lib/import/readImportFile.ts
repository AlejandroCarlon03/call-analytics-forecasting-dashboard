/**
 * The one file in this module allowed to touch DOM APIs — `File` and
 * `File.text()` — so every other file here stays a pure function testable
 * without jsdom.
 */

import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES } from './types';
import type { ImportResult } from './types';
import { buildFromCsv } from './buildFromCsv';
import { buildFromPayloadJson } from './buildFromPayloadJson';

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

export async function readImportFile(file: File): Promise<ImportResult> {
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

  const text = await file.text();

  if (ext === '.json') {
    return buildFromPayloadJson(text, file.name, file.size);
  }
  return buildFromCsv(text, file.name, file.size);
}
