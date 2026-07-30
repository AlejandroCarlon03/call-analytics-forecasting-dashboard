/**
 * Parse a pipeline `outputs/dashboard_data.json` export.
 *
 * Unlike `buildFromCsv`, there is no aggregation to do here — the file
 * already *is* a `DashboardPayload`. The job is validating that it really
 * is one (friendly errors otherwise) and building the same `ImportPreview`
 * shape the CSV route builds, so the UI never has to know which route
 * produced a given `ImportResult`.
 */

import type { DashboardPayload } from '../../data/types';
import { EXPECTED_SCHEMA_VERSION } from '../../data/types';
import type { ImportProblem, ImportResult } from './types';
import { PREVIEW_ROW_LIMIT } from './types';

function fail(message: string): ImportResult {
  return { ok: false, errors: [{ message }] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function buildFromPayloadJson(
  text: string,
  fileName: string,
  fileSize: number,
): ImportResult {
  if (!text || !text.trim()) {
    return fail('This file is empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail(
      `This file is not valid JSON (${e instanceof Error ? e.message : String(e)}).`,
    );
  }

  if (!isPlainObject(parsed)) {
    return fail('This JSON is not a dashboard payload — the top level is not an object.');
  }
  if (typeof parsed.schemaVersion !== 'number') {
    return fail('This JSON is not a dashboard payload — it has no `schemaVersion`.');
  }
  if (!Array.isArray(parsed.daily)) {
    return fail('This JSON is not a dashboard payload — it has no `daily` array.');
  }
  if (!Array.isArray(parsed.targets)) {
    return fail('This JSON is not a dashboard payload — it has no `targets` array.');
  }
  if (!isPlainObject(parsed.ingestion)) {
    return fail('This JSON is not a dashboard payload — it has no `ingestion` object.');
  }

  const warnings: ImportProblem[] = [];
  if (parsed.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    warnings.push({
      message:
        `This file was generated with schema version ${parsed.schemaVersion}, but this ` +
        `dashboard expects version ${EXPECTED_SCHEMA_VERSION}. Some sections may not render as expected.`,
    });
  }

  const payload = parsed as unknown as DashboardPayload;
  const ingestion = payload.ingestion;

  return {
    ok: true,
    payload,
    preview: {
      kind: 'payload',
      fileName,
      fileSize,
      rowsRead: ingestion?.rows_read ?? payload.daily.length,
      rowsKept: ingestion?.rows_kept ?? payload.daily.length,
      dropped: ingestion?.dropped ?? {},
      dateMin: ingestion?.date_min ?? null,
      dateMax: ingestion?.date_max ?? null,
      columnMap: {},
      ignoredColumns: [],
      sampleDaily: payload.daily.slice(0, PREVIEW_ROW_LIMIT) as Array<
        Record<string, string | number | null>
      >,
      warnings,
    },
  };
}
