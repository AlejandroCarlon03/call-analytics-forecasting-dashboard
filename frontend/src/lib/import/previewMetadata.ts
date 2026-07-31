/**
 * The six-field dashboard summary shown at the top of the import preview.
 *
 * The preview already reported *ingestion* facts — rows read, rows kept, what
 * was dropped, the column map. This module answers the other question a reader
 * has before replacing their dashboard: **is this the right dashboard?** Name,
 * when it was generated, how far it forecasts, which models it carries, the
 * period it covers and how much data is behind it.
 *
 * Two rules, both learned the hard way in this codebase, shape every field:
 *
 * 1. **Reuse metadata already in the payload; derive nothing the payload can
 *    answer.** Generation time, horizons, models and the reporting period are
 *    all fields the Python serializer already emits. No `SCHEMA_VERSION` bump,
 *    no new payload contract — this is presentation over data that exists.
 *
 * 2. **A CSV import has no forecast run, and must not pretend to.** `buildFromCsv`
 *    fills `config` with `placeholderConfig()` — every number zero — and stamps
 *    `generatedAt` with the *import* time, not a generation time. Reading those
 *    as facts is exactly the §19 footer bug that published "Interval level: 0%"
 *    as methodology. So the forecast-only fields branch on `preview.kind`: for a
 *    raw CSV they carry an honest "not applicable" note, never a fabricated zero.
 *
 * Pure: preview + payload in, `PreviewField[]` out. No DOM, no React — the
 * assertions that matter run without jsdom, the way `executiveSummary.ts` does.
 */

import type { DashboardPayload } from '../../data/types';
import { formatDate, formatDateTime } from '../format';
import type { ImportPreview } from './types';

/** One labelled row of the summary. */
export interface PreviewField {
  label: string;
  /** Display-ready value — already formatted, already placeheld. Never empty. */
  value: string;
  /**
   * False when `value` is a placeholder standing in for metadata this import
   * genuinely does not carry (a raw CSV has no forecast horizon), so the UI can
   * mute it rather than present it as a real datum.
   */
  available: boolean;
}

/** Placeholder for a field a raw CSV cannot answer, worded to say *why*. */
const CSV_PLACEHOLDER = 'Not applicable — raw CSV has no forecast run';
/** Placeholder for a payload field that is expected but missing/malformed. */
const UNKNOWN = 'Unknown';

/** `12345` -> `"12.1 KB"`. Local to the importer; the only byte formatter here. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return UNKNOWN;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** `[30, 60, 90]` -> `"30, 60, 90 days"`; `[90]` -> `"90 days"`. */
function formatHorizons(horizons: number[]): string {
  const valid = horizons.filter((h) => Number.isFinite(h) && h > 0);
  if (valid.length === 0) return UNKNOWN;
  return `${valid.join(', ')} days`;
}

/**
 * The models this dashboard carries, as display labels.
 *
 * The leaderboard's `label` is human-readable ("Random Forest") and names the
 * models actually evaluated, so it is preferred; `config.models.enabled` is the
 * configured key list ("random_forest") and is the fallback when no evaluation
 * ran. Order is preserved and duplicates removed, so a model appearing under
 * several targets is listed once.
 */
function collectModels(payload: DashboardPayload): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const evaluations = payload.evaluations ?? {};
  for (const target of Object.keys(evaluations)) {
    for (const row of evaluations[target]?.leaderboard ?? []) {
      const label = row.label ?? row.model;
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  if (labels.length > 0) return labels;
  for (const key of payload.config?.models?.enabled ?? []) {
    if (key && !seen.has(key)) {
      seen.add(key);
      labels.push(key);
    }
  }
  return labels;
}

/**
 * Build the six summary fields for the preview, in a fixed reading order.
 *
 * `preview` supplies the file identity and the ingestion span (the same pass
 * that built the payload, so the numbers cannot disagree with it); `payload`
 * supplies the forecast metadata. Both are needed because "is this the right
 * dashboard?" spans both halves.
 */
export function buildPreviewFields(
  preview: ImportPreview,
  payload: DashboardPayload,
): PreviewField[] {
  const isPayload = preview.kind === 'payload';

  // Generation time — real only for a pipeline run. A CSV's `generatedAt` is the
  // moment of import, which is not a generation time and must not read as one.
  const generationTime: PreviewField = isPayload
    ? { label: 'Generation Time', value: formatDateTime(payload.generatedAt), available: Boolean(payload.generatedAt) }
    : { label: 'Generation Time', value: CSV_PLACEHOLDER, available: false };

  const horizons = payload.config?.forecast?.horizons ?? [];
  const forecastHorizon: PreviewField = isPayload
    ? { label: 'Forecast Horizon', value: formatHorizons(horizons), available: horizons.some((h) => h > 0) }
    : { label: 'Forecast Horizon', value: CSV_PLACEHOLDER, available: false };

  const models = collectModels(payload);
  const availableModels: PreviewField = isPayload
    ? { label: 'Available Models', value: models.length > 0 ? models.join(', ') : UNKNOWN, available: models.length > 0 }
    : { label: 'Available Models', value: CSV_PLACEHOLDER, available: false };

  // Reporting period and dataset size are true for *both* routes — a CSV has a
  // date span and rows just as a pipeline export does.
  const hasSpan = Boolean(preview.dateMin && preview.dateMax);
  const reportingPeriod: PreviewField = {
    label: 'Reporting Period',
    value: hasSpan ? `${formatDate(preview.dateMin)} – ${formatDate(preview.dateMax)}` : 'No dated rows',
    available: hasSpan,
  };

  const days = payload.ingestion?.calendar_days;
  const rowsPart = `${preview.rowsKept.toLocaleString('en-US')} row${preview.rowsKept === 1 ? '' : 's'}`;
  const daysPart = Number.isFinite(days) && (days as number) > 0 ? ` · ${days} days` : '';
  const datasetSize: PreviewField = {
    label: 'Dataset Size',
    value: `${rowsPart}${daysPart} · ${formatBytes(preview.fileSize)}`,
    available: true,
  };

  return [
    { label: 'Dashboard Name', value: preview.fileName, available: true },
    generationTime,
    forecastHorizon,
    availableModels,
    reportingPeriod,
    datasetSize,
  ];
}
