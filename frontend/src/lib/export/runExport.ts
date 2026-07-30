/**
 * The export orchestrator.
 *
 * Dispatches on `request.format`, computes every requested analytic in one
 * `buildAnalyticExports` pass (registry.ts), then writes files sequentially —
 * no ZIP, per the frozen contract. An analytic that throws or has nothing to
 * write contributes an `ExportProblem` carrying its id while the rest of the
 * run continues; only something that makes the whole run impossible (a
 * `buildAnalyticExports` throw) propagates.
 */

import { downloadBlob, exportFileName } from './download';
import { toCsv } from './csv';
import { toJson } from './json';
import { toPng } from './png';
import { buildAnalyticExports } from './registry';
import type {
  AnalyticExport,
  ExportArtifact,
  ExportContext,
  ExportOutcome,
  ExportProblem,
  ExportRequest,
} from './types';

/** One CSV file per selected analytic. */
function writeCsv(entry: AnalyticExport, at: Date): ExportArtifact {
  const text = toCsv(entry.table);
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const fileName = exportFileName(entry.descriptor.slug, 'csv', at);
  downloadBlob(blob, fileName);
  return { fileName, size: blob.size };
}

/** One PNG file per figure, across every selected analytic. */
async function writePngs(
  entry: AnalyticExport,
  ctx: ExportContext,
  at: Date,
): Promise<ExportArtifact[]> {
  const artifacts: ExportArtifact[] = [];
  for (const figure of entry.figures) {
    const blob = await toPng(figure, ctx.palette);
    // The figure's own slug distinguishes per-target files — `forecasts-call_volume`
    // vs `forecasts-total_cost` — rather than every target overwriting the same name.
    const slug =
      entry.figures.length > 1 || figure.slug !== entry.descriptor.slug
        ? `${entry.descriptor.slug}-${figure.slug}`
        : entry.descriptor.slug;
    const fileName = exportFileName(slug, 'png', at);
    downloadBlob(blob, fileName);
    artifacts.push({ fileName, size: blob.size });
  }
  return artifacts;
}

/**
 * Run one export request against a context, downloading sequentially and
 * accumulating problems rather than stopping at the first one — an export is
 * genuinely partial-able (`types.ts`'s doc comment on `ExportOutcome`).
 */
export async function runExport(
  request: ExportRequest,
  ctx: ExportContext,
): Promise<ExportOutcome> {
  const at = new Date();
  const artifacts: ExportArtifact[] = [];
  const problems: ExportProblem[] = [];

  // A failure computing every analytic's data is the one case that makes the
  // whole run impossible — there is nothing left to iterate. Everything after
  // this point is per-analytic and never propagates.
  let entries: AnalyticExport[];
  try {
    entries = buildAnalyticExports(ctx, request.analytics);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { artifacts: [], problems: [{ message: `Export failed: ${message}` }] };
  }

  switch (request.format) {
    case 'csv': {
      for (const entry of entries) {
        // Nothing to write is a problem, not a zero-byte file — a target
        // filtered down to an empty table would otherwise download silently.
        if (entry.table.rows.length === 0) {
          problems.push({
            message: `${entry.descriptor.label} had no rows for this selection.`,
            analytic: entry.id,
          });
          continue;
        }
        try {
          artifacts.push(writeCsv(entry, at));
        } catch (cause) {
          problems.push(problemFor(entry, cause));
        }
      }
      break;
    }
    case 'json': {
      // Exactly one file for the whole request, not one per analytic.
      try {
        const text = toJson(entries, ctx);
        const blob = new Blob([text], { type: 'application/json' });
        const fileName = exportFileName('export', 'json', at);
        downloadBlob(blob, fileName);
        artifacts.push({ fileName, size: blob.size });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        problems.push({ message: `Could not build the JSON export: ${message}` });
      }
      break;
    }
    case 'png': {
      for (const entry of entries) {
        // A builder that legitimately drew nothing (§8: a skipped leaderboard,
        // an unscored importance panel) leaves `figures` empty; that is a
        // problem to report, not a run that silently wrote zero files.
        if (entry.figures.length === 0) {
          problems.push({
            message: `${entry.descriptor.label} had no chart to export for this selection.`,
            analytic: entry.id,
          });
          continue;
        }
        try {
          const written = await writePngs(entry, ctx, at);
          artifacts.push(...written);
        } catch (cause) {
          problems.push(problemFor(entry, cause));
        }
      }
      break;
    }
    // Adding `pdf` later is one branch here plus one writer module — see
    // `PDF_TODO` in `types.ts`. Nothing above this switch changes.
    default: {
      problems.push({ message: `Unsupported export format: ${String(request.format)}` });
    }
  }

  return { artifacts, problems };
}

function problemFor(entry: AnalyticExport, cause: unknown): ExportProblem {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    message: `Could not export ${entry.descriptor.label}: ${message}`,
    analytic: entry.id,
  };
}
