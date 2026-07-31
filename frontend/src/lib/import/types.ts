/**
 * The import contract.
 *
 * **This file is the seam between the three halves of the import feature**, and
 * it is deliberately the only thing they share: the parser (`lib/import/*`)
 * produces these values, the UI (`components/import/*`) renders them, and `App`
 * acts on them. None of the three imports anything else from the others, so the
 * parser stays testable without a DOM and the UI stays testable without a CSV.
 *
 * Two decisions are written down here rather than in any one consumer.
 *
 * **An import produces a `DashboardPayload`, not a new kind of state.** The
 * dashboard already has exactly one source of truth — the payload `App` holds —
 * and the whole point of the feature is to swap it. A parallel "imported data"
 * slice would need keeping in step with selection, theme and every section that
 * reads the payload, and §10 of SESSION_CONTEXT is the record of what happens
 * when two things that should agree are computed twice.
 *
 * **A raw call CSV cannot produce forecasts, and does not pretend to.** The
 * forecast, model-comparison, explainability and scenario sections are the
 * output of the Python pipeline — six cross-validated models, SHAP, Erlang-C.
 * A CSV import fills the descriptive half (`daily`, `hourly`, `ingestion`) and
 * leaves those maps empty, which makes every one of those sections return
 * `null` through the guard it already has. `kind` is how a caller tells the two
 * import routes apart so it can say so to the reader.
 */

import type { DashboardPayload } from '../../data/types';

/** Which route produced a payload, and therefore how complete it is. */
export type ImportKind =
  /** A raw call export. Descriptive sections only — no forecasts. */
  | 'csv'
  /** A pipeline `dashboard_data.json`. Every section, full fidelity. */
  | 'payload';

/**
 * One problem with the file the reader chose, phrased for the reader.
 *
 * `message` is user-facing and must name the fix, not the internal rule that
 * failed — "No timestamp column found. Expected one of: time, timestamp, …"
 * rather than "alias lookup failed". `row` is 1-based over *data* rows (the
 * header is row 0) and omitted for whole-file problems, so the UI can render
 * "row 412" only when there is one to point at.
 */
export interface ImportProblem {
  message: string;
  /** 1-based data row, absent for file-level problems. */
  row?: number;
  /** The offending column, when the problem is about one. */
  column?: string;
}

/**
 * What the reader is shown before committing to the swap.
 *
 * The preview exists so an import is never a surprise: it reports what was
 * understood, what was discarded and why, and shows real rows. Counts here
 * come from the same pass that builds the payload, never from a second
 * traversal that could disagree with it.
 */
export interface ImportPreview {
  kind: ImportKind;
  fileName: string;
  /** Bytes, for the "12.4 MB" line. */
  fileSize: number;
  /** Data rows seen, excluding the header. */
  rowsRead: number;
  /** Rows that survived validation and reached the payload. */
  rowsKept: number;
  /** Reason -> count, mirroring `ingestion.dropped`. */
  dropped: Record<string, number>;
  /** Inclusive date span of the kept rows, `null` when nothing survived. */
  dateMin: string | null;
  dateMax: string | null;
  /** Canonical column -> the source header it was matched to. */
  columnMap: Record<string, string>;
  /** Recognised headers that carry no meaning to the pipeline. */
  ignoredColumns: string[];
  /** Up to `PREVIEW_ROW_LIMIT` daily rows, for the preview table. */
  sampleDaily: Array<Record<string, string | number | null>>;
  /** Non-fatal advisories. An import can proceed with these outstanding. */
  warnings: ImportProblem[];
}

/** How many daily rows a preview carries. Enough to judge, short enough to scan. */
export const PREVIEW_ROW_LIMIT = 10;

/**
 * The result of reading a file.
 *
 * A discriminated union rather than `{ payload?, errors? }`: a caller that has
 * narrowed on `ok` cannot then reach for the field that is not there, which is
 * the mistake this shape exists to make unrepresentable.
 */
export type ImportResult =
  | { ok: true; payload: DashboardPayload; preview: ImportPreview }
  | { ok: false; errors: ImportProblem[] };

/** Extensions the picker offers and the drop zone accepts. */
export const ACCEPTED_EXTENSIONS = ['.csv', '.json', '.xlsx'] as const;

/**
 * Where a read has got to, for the progress UI.
 *
 * These are *observable* stages, not a percentage: reading a 172-row export is
 * instant and any percentage would be a lie animated to look like work. The UI
 * names the stage it is in and shows indeterminate motion, which is honest
 * about a duration nobody can predict from the file size alone.
 *
 * `decoding` exists only for `.xlsx` — unzipping a workbook is the one step
 * here that can take long enough on a large file to need saying out loud.
 */
export type ImportStage =
  /** Handed a file, checking size and extension. */
  | 'reading'
  /** Unzipping and walking a workbook. `.xlsx` only. */
  | 'decoding'
  /** Tokenising rows and mapping columns. */
  | 'parsing'
  /** Aggregating to the daily grain and building the payload. */
  | 'aggregating'
  /** A payload is built and the preview is on screen. */
  | 'previewing'
  /** The reader pressed Import and the swap has happened. */
  | 'done';

/**
 * Human-readable label per stage. Kept here rather than in the component so the
 * parser and the UI cannot disagree about what a stage is called.
 */
export const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  reading: 'Reading file…',
  decoding: 'Decoding workbook…',
  parsing: 'Parsing rows…',
  aggregating: 'Building daily summary…',
  previewing: 'Ready to import',
  done: 'Imported',
};

/** Optional progress sink. A caller that does not care passes nothing. */
export type ImportProgress = (stage: ImportStage) => void;

/**
 * Refuse absurd files before reading them into memory.
 *
 * A browser tab that reads a 2 GB file to discover it is not a CSV has already
 * lost. 25 MB is comfortably above the largest plausible export — the 210-day
 * sample is 130 KB — and far below what would hurt.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
