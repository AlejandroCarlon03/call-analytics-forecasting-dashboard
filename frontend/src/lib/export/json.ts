/**
 * JSON writer — one document for the whole export session.
 *
 * Deliberately a single file even when several analytics were requested: the
 * reader asked for one export, and `meta` needs somewhere to say what was in
 * it. Splitting per-analytic would mean repeating `meta` in every file or
 * dropping it, and either loses the "what was this a snapshot of" question a
 * script re-reading the export later needs answered.
 */

import type { AnalyticExport, ExportContext } from './types';

const SCHEMA_VERSION = 1;

/**
 * Envelope + one entry per requested analytic, pretty-printed.
 *
 * `selection.horizon` can be `Number.POSITIVE_INFINITY` — a run configured no
 * horizons at all (`selection.ts`). `JSON.stringify` already turns `Infinity`
 * into `null` on its own (the same substitution `serialize.py` makes for NaN
 * and Infinity on the Python side, per `data/types.ts`), so no replacer is
 * needed here — this comment is the deliberate acknowledgement that the
 * behaviour is relied on rather than accidental.
 */
export function toJson(exports: readonly AnalyticExport[], ctx: ExportContext): string {
  const now = new Date();
  const document = {
    meta: {
      generatedAt: ctx.payload.generatedAt,
      exportedAt: now.toISOString(),
      schemaVersion: SCHEMA_VERSION,
      selection: {
        target: ctx.selection.target,
        // See doc comment: Infinity serializes to `null` via JSON.stringify.
        horizon: ctx.selection.horizon,
      },
      analytics: exports.map((entry) => entry.id),
    },
    analytics: Object.fromEntries(exports.map((entry) => [entry.id, entry.json])),
  };
  return JSON.stringify(document, null, 2);
}
