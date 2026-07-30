/**
 * The export contract.
 *
 * **This file is the seam between the three halves of the Export Center**, and
 * it is deliberately the only thing they share: the engine (`lib/export/*`)
 * produces these values, the UI (`components/export/*`) renders them, and `App`
 * supplies the dashboard state they are computed from. None of the three
 * imports anything else from the others, so the engine stays testable without a
 * DOM and the UI stays testable without a payload.
 *
 * This is the same shape `lib/import/types.ts` froze for PR 12, and for the
 * same reason. Four decisions are written down here rather than in any one
 * consumer.
 *
 * **An export is a view of the dashboard's existing state, never a second read
 * of it.** Everything an export emits is derived from the one `DashboardPayload`
 * `App` holds plus the `Selection` the URL fragment carries. There is no export
 * store, no snapshot slice and no re-fetch. A second copy would need keeping in
 * step with the rail, the horizon selector and every section, and §10 of
 * SESSION_CONTEXT is the record of what happens when two things that should
 * agree are computed twice.
 *
 * **Selection is applied by the same functions the sections use.** Which targets
 * an export covers is `isTargetVisible`; which forecast rows survive is
 * `trimDaily` / `trimHorizons`; which anomalies belong to a target is
 * `selectAnomalies`. An export that filtered its own way would be a second
 * filter, and the first time the two disagreed the file would not match the page
 * that produced it.
 *
 * **PNG reuses the pure figure builders, and so exports exactly what is on
 * screen.** `lib/chart/figures/` already returns `{ data, layout }` from payload
 * rows plus a palette (§8, PR 4). The engine passes those same figures to
 * Plotly rather than rebuilding traces, which is what makes "preserve theme" a
 * property of the architecture rather than a thing to remember.
 *
 * **The formats are open-ended on purpose.** `ExportFormat` is a union and the
 * engine dispatches on it; adding `pdf` or `xlsx` later means one new writer
 * module and one new member, with no change to the registry, the UI or `App`.
 * See `PDF_TODO` at the foot of this file.
 */

import type { ChartPalette } from '../chart/palette';
import type { PlotFigure } from '../chart/types';
import type { DashboardPayload } from '../../data/types';
import type { Selection } from '../selection';

// --------------------------------------------------------------------------
//  What can be exported
// --------------------------------------------------------------------------

/**
 * The six analytics the Export Center offers.
 *
 * These are the *reader's* units, not the payload's: "Forecasts" is one choice
 * even though it covers up to three targets, because that is how it reads on
 * the page. The mapping from a choice to the payload slices behind it is the
 * registry's job.
 */
export type AnalyticId =
  | 'forecasts'
  | 'monthlyCost'
  | 'leaderboard'
  | 'heatmap'
  | 'importance'
  | 'anomalies';

/** Export formats, in the order the selector offers them. */
export type ExportFormat = 'csv' | 'json' | 'png';

/**
 * Static facts about an analytic — no payload required.
 *
 * Held apart from the registry so the UI can render the picker, its labels and
 * its format affordances before any payload arrives, and so a test of the
 * catalogue does not need a fixture.
 */
export interface AnalyticDescriptor {
  id: AnalyticId;
  /** How the analytic reads on the page. Matches its section heading. */
  label: string;
  /** One line under the label in the picker. */
  description: string;
  /**
   * Filename stem, lower-kebab. Files are named
   * `call-forecast-<slug>[-<target>]-<YYYYMMDD-HHmmss>.<ext>`.
   */
  slug: string;
  /**
   * Formats this analytic can produce *in principle*.
   *
   * `heatmap` has no meaningful per-model split and every analytic has a table
   * behind it, so all six support all three today. This field exists so a
   * future analytic that is chart-only or table-only can say so once, here,
   * rather than in three consumers.
   */
  formats: readonly ExportFormat[];
  /**
   * Whether the analytic is a product of the Python pipeline's *analysis*
   * rather than of the raw data.
   *
   * PR 12's `analysisAvailable` is false after a CSV import, and the sections
   * behind these analytics are absent from the page then. An export offering
   * them would produce an empty file for something the reader cannot see —
   * which is exactly the fabricated all-clear §12 removed from the anomalies
   * section. The registry omits them; the UI never has to know why.
   */
  requiresAnalysis: boolean;
}

/** The catalogue, in the order the Export Center lists it — page order. */
export const ANALYTICS: readonly AnalyticDescriptor[] = [
  {
    id: 'forecasts',
    label: 'Forecasts',
    description: 'Daily forecast with calibrated intervals, trimmed to the selected horizon.',
    slug: 'forecasts',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: true,
  },
  {
    id: 'monthlyCost',
    label: 'Monthly cost',
    description: 'Projected cost per calendar month, partial months included.',
    slug: 'monthly-cost',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: true,
  },
  {
    id: 'leaderboard',
    label: 'Model comparison',
    description: 'Cross-validated accuracy for every model, selected one marked.',
    slug: 'leaderboard',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: true,
  },
  {
    id: 'heatmap',
    label: 'Arrivals heatmap',
    description: 'Observed call volume by weekday and hour. Describes the whole run.',
    slug: 'arrivals-heatmap',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: false,
  },
  {
    id: 'importance',
    label: 'Feature importance',
    description: 'Top drivers of the forecast, by SHAP, permutation or native importance.',
    slug: 'feature-importance',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: true,
  },
  {
    id: 'anomalies',
    label: 'Anomalies',
    description: 'Flagged days with rule, severity and deviation.',
    slug: 'anomalies',
    formats: ['csv', 'json', 'png'],
    requiresAnalysis: true,
  },
];

/** Look a descriptor up by id. Throws on an unknown id — the union prevents one. */
export function analyticById(id: AnalyticId): AnalyticDescriptor {
  const found = ANALYTICS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unknown analytic: ${id}`);
  return found;
}

// --------------------------------------------------------------------------
//  What an export is computed from
// --------------------------------------------------------------------------

/**
 * Everything the engine needs, and nothing it could use to reach further.
 *
 * Passed by value from `App`, which already holds all four. The engine takes no
 * React, reads no `location` and imports no hook — the palette in particular is
 * resolved by `useChartPalette()` at the call site and handed in, because
 * reading it here would mean touching `documentElement` from a pure module and
 * would lose the DOM subscription that keeps charts in step with the theme
 * (§8, PR 4: **do not read the palette off `mode`**).
 */
export interface ExportContext {
  payload: DashboardPayload;
  /** The live selection — the rail's target and the horizon. Applied, not ignored. */
  selection: Selection;
  /** PR 12's flag. Gates every `requiresAnalysis` analytic out of the registry. */
  analysisAvailable: boolean;
  /** Resolved from the DOM by the caller, so PNG output carries the live theme. */
  palette: ChartPalette;
}

// --------------------------------------------------------------------------
//  What an analytic yields
// --------------------------------------------------------------------------

/** A CSV cell. `null` renders as an empty field, never as the string "null". */
export type ExportCell = string | number | boolean | null;

/** One row of a flat export table. */
export type ExportRow = Record<string, ExportCell>;

/**
 * The tabular form of one analytic, across every target the selection leaves
 * visible.
 *
 * **One table, not one per target.** Under "All Models" the forecasts table
 * carries a leading `target` column and the three targets' rows in payload
 * order — that is what "'All Models' exports aggregate data" means, and it
 * keeps a multi-model export to one file without a ZIP. Under a single-model
 * selection the same table has one target's rows; the column stays, so the two
 * files have the same shape and a script that reads one reads the other.
 *
 * `columns` is authoritative and explicit rather than derived from the rows'
 * keys. Key order in a JSON object is insertion order and would silently
 * reorder a CSV the day a builder changed; a reader diffing two exports would
 * see every column move. It also pins the *leading* columns — `target`, then
 * `date` — which is the order the on-screen table uses.
 */
export interface ExportTable {
  /** Column order, authoritative. Every key here must exist on every row. */
  columns: readonly string[];
  rows: readonly ExportRow[];
}

/**
 * One chart to render as a PNG.
 *
 * An analytic yields as many of these as the selection leaves visible — three
 * forecast charts under "All Models", one under a single-model selection.
 * `figure` is the *same* object the on-screen card renders, from the same pure
 * builder with the same palette, so the file and the screen cannot disagree.
 *
 * A builder that legitimately has nothing to draw returns `null` upstream
 * (§8, PR 5: a skipped `avg_duration_sec` leaderboard); those are dropped from
 * this list rather than emitted as an empty image.
 */
export interface ExportFigure {
  /** Filename discriminator — the target key, or the analytic slug when run-wide. */
  slug: string;
  /** Human label, used in the success notification and as the image's title. */
  label: string;
  figure: PlotFigure;
}

/**
 * Everything one analytic can produce, computed once.
 *
 * The three views are built together from a single pass over the payload so
 * they cannot disagree about what the selection includes — a CSV covering three
 * targets beside a PNG set covering one would be the same class of bug §10
 * exists to prevent.
 *
 * `json` is the payload's own structure, sliced — `ForecastSection`,
 * `EvaluationSection` and friends, verbatim, with only the selection's filtering
 * applied. It is deliberately **not** the flattened `table`: the JSON route's
 * job is to preserve the payload contract so an export can be re-imported
 * through PR 12's JSON path or read by a script that already knows the schema.
 */
export interface AnalyticExport {
  id: AnalyticId;
  descriptor: AnalyticDescriptor;
  table: ExportTable;
  /** Payload-shaped, selection-filtered. Structure preserved, not flattened. */
  json: unknown;
  figures: readonly ExportFigure[];
}

// --------------------------------------------------------------------------
//  Running an export
// --------------------------------------------------------------------------

/** What the reader asked for. */
export interface ExportRequest {
  /** One or more analytics, in catalogue order. Never empty — the UI disables Export. */
  analytics: readonly AnalyticId[];
  format: ExportFormat;
}

/** One file that was written to the reader's disk. */
export interface ExportArtifact {
  fileName: string;
  /** Bytes, for the "3 files · 412 KB" line in the success notification. */
  size: number;
}

/**
 * A problem the reader can act on.
 *
 * `analytic` is present when one analytic failed and others may have
 * succeeded — a partial export is reported as such rather than as a blanket
 * failure, because the files that did land are on disk either way and telling
 * the reader otherwise would be false.
 */
export interface ExportProblem {
  message: string;
  analytic?: AnalyticId;
}

/**
 * The outcome of one export run.
 *
 * Not a discriminated union, unlike `ImportResult`, because an export is
 * genuinely partial-able: three PNGs requested, two written, one figure absent.
 * `artifacts` and `problems` are both meaningful at once, and a union would
 * force that state to be reported as one or the other.
 */
export interface ExportOutcome {
  artifacts: readonly ExportArtifact[];
  problems: readonly ExportProblem[];
}

// --------------------------------------------------------------------------
//  File naming and image quality
// --------------------------------------------------------------------------

/** Filename prefix, so an export is identifiable in a downloads folder. */
export const FILE_PREFIX = 'call-forecast';

/**
 * PNG pixel scale.
 *
 * 2x the on-screen geometry: legible when dropped into a slide or a document at
 * full width, and still a file small enough to email. The figures carry their
 * own explicit width and height (§8, PR 4 — Plotly's autosize paths delete both,
 * which is why every builder sets them), so scaling is the only lever that
 * raises resolution without re-laying out the chart and changing what the reader
 * saw.
 */
export const PNG_SCALE = 2;

/** Width in CSS pixels the exported figures are rendered at before scaling. */
export const PNG_WIDTH = 1000;

/**
 * `sessionStorage` key for the last format used.
 *
 * Session rather than local, and a *format* only: the analytics chosen are a
 * question about one task and remembering them would pre-tick boxes the reader
 * did not tick this time, but the format is a durable preference for the
 * length of a sitting. Cleared when the tab closes, which is the intent.
 */
export const FORMAT_MEMORY_KEY = 'call-forecast:export-format';

/**
 * PDF is deliberately not implemented, and this is where it would go.
 *
 * Every prerequisite is already in place: `ANALYTICS` would gain `'pdf'` in the
 * relevant `formats` arrays, `ExportFormat` would gain the member, and one new
 * writer beside `csv.ts` / `json.ts` / `png.ts` would consume the same
 * `AnalyticExport` the other three do — the registry, the UI and `App` would not
 * change. What stops it being in this PR is the dependency: a real PDF means
 * jsPDF or pdf-lib in the bundle, and the generated dashboard is a single
 * self-contained file sitting at ~1.97 MB against a 2 MB advisory (§12). That is
 * a size argument to make in its own PR, with its own advisory bump, rather than
 * a line item in this one.
 *
 * ZIP is excluded on the same grounds and additionally by scope: multi-file
 * exports issue sequential downloads, which every browser this dashboard is
 * opened in supports from `file://`.
 */
export const PDF_TODO =
  'PDF export: add the format member, one writer module, and a bundle-size argument. See the note above.';
