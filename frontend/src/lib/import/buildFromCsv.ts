/**
 * Turn a raw call-export CSV into a `DashboardPayload`.
 *
 * This is a TypeScript port of two Python stages run back to back:
 * `call_forecast.ingest.load_call_files` (parse + validate call-level rows)
 * and `call_forecast.features.build_daily` (collapse to one row per
 * calendar day, including zero-call days). See those modules for the
 * behaviour being mirrored; deviations are called out inline.
 *
 * **One stage of `ingest.py` is deliberately not ported: de-duplication.**
 * Python de-duplicates because it reads a *directory* and two exports whose
 * date ranges overlap would double-count the calls in the overlap. A browser
 * import reads exactly one file and replaces the payload wholesale rather than
 * accumulating, so the cross-file case it exists for cannot arise here.
 * Re-importing the same file twice yields the same dashboard, not a doubled
 * one. Within-file duplicate rows are therefore left as the export wrote them —
 * if a future import ever merges files, this is the stage to port first.
 *
 * Every forecast-bearing section of the payload — `forecasts`, `evaluations`,
 * `explanations`, `targets` — is left empty on purpose. A raw CSV has no
 * models to report; the dashboard already treats an empty map as "this
 * section has nothing to show" (see `types.ts`'s docblock), so leaving them
 * empty here means the UI needs no CSV-specific branch to degrade
 * gracefully to Data Quality + At a Glance + Arrivals.
 */

import type {
  DashboardPayload,
  DailyRow,
  HourlyCell,
  ConfigSummary,
} from '../../data/types';
import { EXPECTED_SCHEMA_VERSION } from '../../data/types';
import { parseCsv } from './parseCsv';
import {
  COLUMN_ALIASES,
  mapColumns,
  parseCurrency,
  parseDurationToSeconds,
  parseTimestamp,
} from './callSchema';
import type { ImportProblem, ImportResult } from './types';
import { PREVIEW_ROW_LIMIT } from './types';

/**
 * Mirrors `AppConfig.data.max_bad_timestamp_share`, whose default is **0.05** —
 * see `config.py:69` and `config.yaml:22`.
 *
 * This was `0.2` until PR 19, under a comment asserting that 0.2 was the Python
 * default. It was not; the port had been four times more permissive than the
 * pipeline it mirrors since PR 12. The gate exists to catch "you exported the
 * wrong column" loudly, and at 20% a file where one row in six was unreadable
 * imported cleanly and produced a dashboard silently missing a sixth of its
 * data — the exact failure this constant is here to prevent.
 *
 * Tightening it is a real behaviour change: a file that imported before may now
 * be refused. That is the intended behaviour of the audited pipeline, and the
 * refusal names the count, the share and the limit.
 */
const MAX_BAD_TIMESTAMP_SHARE = 0.05;

/**
 * Mirrors `AppConfig.data.max_plausible_duration_sec` (4 hours) and
 * `max_plausible_cost` ($100) — `config.py:72,75`.
 *
 * Added in PR 19. `ingest.py`'s range-check block (lines 522–540) nulls a
 * duration over four hours or below zero and a cost over $100 or below zero,
 * counting each on the ingestion report; the port had none of it, so a corrupt
 * export that Python would have neutralised went straight into the browser's
 * daily means and totals. One negative duration is enough to drag a day's
 * average below every call in it.
 */
const MAX_PLAUSIBLE_DURATION_SEC = 4 * 3600;
const MAX_PLAUSIBLE_COST = 100;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function fail(message: string, extra?: Partial<ImportProblem>): ImportResult {
  return { ok: false, errors: [{ message, ...extra }] };
}

/** `YYYY-MM-DD` from a Date's *local* fields, so no UTC-shift surprises. */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * A minimal, honest placeholder `ConfigSummary`.
 *
 * A CSV carries no run configuration — no CV settings, no anomaly
 * thresholds, no model list — so there is nothing real to report here.
 * `forecast.horizons` and `forecast.targets` are empty arrays specifically
 * because sections that key off them (the forecast tabs) must see "no
 * horizons configured" rather than invent numbers nobody chose.
 */
function placeholderConfig(): ConfigSummary {
  return {
    forecast: { horizons: [], interval_level: 0, n_simulations: 0, targets: [] },
    cv: {
      horizon: 0,
      step: 0,
      initial_train_days: 0,
      min_folds: 0,
      selection_metric: '',
      selection_tiebreaker: '',
    },
    data: { holiday_country: '', holiday_subdiv: null },
    business_hours: {
      start_hour: 0,
      end_hour: 0,
      overnight_start_hour: 0,
      overnight_end_hour: 0,
    },
    anomalies: {
      cost_overrun_pct: 0,
      duration_sigma: 0,
      missed_spike_sigma: 0,
      robust_z_threshold: 0,
      baseline_window_days: 0,
    },
    scenarios: {
      current_agents: 0,
      target_answer_seconds: 0,
      service_level_pct: 0,
      staffed_hours_per_day: 0,
    },
    models: { enabled: [] },
  };
}

export function buildFromCsv(text: string, fileName: string, fileSize: number): ImportResult {
  if (!text || !text.trim()) {
    return fail('This file is empty.');
  }

  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  // Drop trailing/interior fully-blank lines (a single empty field), which a
  // trailing newline or stray blank line produces.
  rows = rows.filter((r) => !(r.length === 1 && r[0] === ''));

  if (rows.length === 0) {
    return fail('This file is empty.');
  }
  if (rows.length === 1) {
    return fail('This file has a header but no data rows.');
  }

  const header = rows[0]!;
  const dataRows = rows.slice(1);

  const { mapping, ignored, duplicates } = mapColumns(header);
  if (duplicates.length > 0) {
    return fail(`This file has duplicate columns. ${duplicates.join(' ')}`);
  }

  if (!('ts' in mapping)) {
    return fail(
      `No timestamp column found. Expected one of: ${(COLUMN_ALIASES.ts ?? []).join(', ')}.`,
    );
  }

  const colIndex: Record<string, number> = {};
  for (const [canonical, sourceHeader] of Object.entries(mapping)) {
    colIndex[canonical] = header.indexOf(sourceHeader);
  }

  const rowsRead = dataRows.length;
  let badTimestamps = 0;
  const warnings: ImportProblem[] = [];

  /*
   * Range-check tallies, keyed exactly as `ingest.py` names them on the
   * ingestion report so the browser's "dropped" list and the pipeline's read
   * the same. A *value* being dropped is not a *row* being dropped — the row
   * still counts toward `call_volume`, exactly as in Python, because a call
   * with an unusable duration is still a call that happened.
   */
  const valuesDropped: Record<string, number> = {};
  const dropValue = (reason: string) => {
    valuesDropped[reason] = (valuesDropped[reason] ?? 0) + 1;
  };

  interface Call {
    ts: Date;
    duration: number; // NaN when blank
    cost: number;
  }
  const calls: Call[] = [];

  for (const row of dataRows) {
    const rawTs = row[colIndex.ts!];
    const ts = parseTimestamp(rawTs);
    if (!ts) {
      badTimestamps += 1;
      continue;
    }
    let duration =
      'duration_sec' in colIndex ? parseDurationToSeconds(row[colIndex.duration_sec!]) : NaN;
    let cost = 'cost' in colIndex ? parseCurrency(row[colIndex.cost!]) : NaN;

    // Range checks, in `ingest.py`'s order — and, critically, *before* the
    // blank-cost fill below, so an implausible cost becomes 0 rather than
    // surviving as itself.
    if (duration > MAX_PLAUSIBLE_DURATION_SEC) {
      dropValue('implausible duration');
      duration = NaN;
    } else if (duration < 0) {
      dropValue('negative duration');
      duration = NaN;
    }
    if (cost > MAX_PLAUSIBLE_COST) {
      dropValue('implausible cost');
      cost = NaN;
    } else if (cost < 0) {
      dropValue('negative cost');
      cost = NaN;
    }

    if (Number.isNaN(cost)) cost = 0; // blank cost means "no charge", matching ingest.py
    calls.push({ ts, duration, cost });
  }

  if (rowsRead > 0) {
    const share = badTimestamps / rowsRead;
    if (share > MAX_BAD_TIMESTAMP_SHARE) {
      return fail(
        `${badTimestamps}/${rowsRead} rows (${(share * 100).toFixed(0)}%) have an ` +
          `unparseable timestamp, above the ${(MAX_BAD_TIMESTAMP_SHARE * 100).toFixed(0)}% ` +
          'limit. Check that the correct column/file is being imported.',
      );
    }
  }
  if (badTimestamps > 0) {
    warnings.push({ message: `${badTimestamps} row(s) had an unparseable timestamp and were dropped.` });
  }

  if (calls.length === 0) {
    return fail('No usable rows survived validation; check the export format.');
  }

  // -- aggregate to daily ---------------------------------------------------
  const byDate = new Map<string, Call[]>();
  for (const call of calls) {
    const key = dateKey(call.ts);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(call);
    else byDate.set(key, [call]);
  }

  const sortedKeys = [...byDate.keys()].sort();
  const minKey = sortedKeys[0]!;
  const maxKey = sortedKeys[sortedKeys.length - 1]!;
  const [minY, minM, minD] = minKey.split('-').map(Number) as [number, number, number];
  const [maxY, maxM, maxD] = maxKey.split('-').map(Number) as [number, number, number];
  const minDate = new Date(minY, minM - 1, minD);
  const maxDate = new Date(maxY, maxM - 1, maxD);

  const daily: DailyRow[] = [];
  let activeDays = 0;
  for (let d = new Date(minDate); d.getTime() <= maxDate.getTime(); d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const dayCalls = byDate.get(key) ?? [];
    const durations = dayCalls.map((c) => c.duration).filter((x) => !Number.isNaN(x));
    const totalCost = dayCalls.reduce((sum, c) => sum + c.cost, 0);
    const totalDurationMin = durations.reduce((sum, x) => sum + x / 60, 0);
    const callVolume = dayCalls.length;
    if (callVolume > 0) activeDays += 1;

    const avgDurationSec =
      durations.length > 0 ? durations.reduce((s, x) => s + x, 0) / durations.length : null;

    daily.push({
      date: key,
      call_volume: callVolume,
      avg_duration_sec: avgDurationSec,
      total_cost: totalCost,
      median_duration_sec: median(durations),
      max_duration_sec: durations.length > 0 ? Math.max(...durations) : null,
      total_duration_min: totalDurationMin,
      cost_per_call: callVolume > 0 ? totalCost / callVolume : null,
      cost_per_minute: totalDurationMin > 0 ? totalCost / totalDurationMin : null,
    });
  }

  // -- hourly grid: all 7 x 24 cells, Monday = 0 -----------------------------
  const hourlyCounts = new Map<string, number>();
  for (const call of calls) {
    const jsDay = call.ts.getDay(); // Sunday = 0
    const weekday = (jsDay + 6) % 7; // Monday = 0
    const hour = call.ts.getHours();
    const key = `${weekday}-${hour}`;
    hourlyCounts.set(key, (hourlyCounts.get(key) ?? 0) + 1);
  }
  const hourly: HourlyCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      hourly.push({
        weekday,
        weekdayLabel: WEEKDAY_LABELS[weekday]!,
        hour,
        calls: hourlyCounts.get(`${weekday}-${hour}`) ?? 0,
      });
    }
  }

  const calendarDays = daily.length;
  const coveragePct = calendarDays > 0 ? Math.round((activeDays / calendarDays) * 10000) / 100 : 0;
  if (coveragePct < 60) {
    warnings.push({
      message:
        `Only ${activeDays} of ${calendarDays} calendar days (${coveragePct.toFixed(0)}%) ` +
        'contain calls. The series is intermittent.',
    });
  }

  const missingColumns = Object.keys(COLUMN_ALIASES).filter((c) => !(c in mapping));

  const ingestion = {
    files: [fileName],
    rows_read: rowsRead,
    rows_kept: calls.length,
    dropped: {
      ...(badTimestamps > 0 ? { 'unparseable timestamp': badTimestamps } : {}),
      ...valuesDropped,
    },
    warnings: warnings.map((w) => w.message),
    missing_columns: missingColumns,
    date_min: minKey,
    date_max: maxKey,
    active_days: activeDays,
    calendar_days: calendarDays,
    coverage_pct: coveragePct,
  };

  const payload: DashboardPayload = {
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ingestion,
    config: placeholderConfig(),
    targets: [],
    targetMeta: {},
    forecasts: {},
    evaluations: {},
    explanations: {},
    daily,
    hourly,
    anomalies: { items: [], byRule: [], notes: [], counts: { critical: 0, warning: 0, info: 0 } },
    scenarios: { rows: [], notes: [] },
  };

  return {
    ok: true,
    payload,
    preview: {
      kind: 'csv',
      fileName,
      fileSize,
      rowsRead,
      rowsKept: calls.length,
      dropped: ingestion.dropped,
      dateMin: minKey,
      dateMax: maxKey,
      columnMap: mapping,
      ignoredColumns: ignored,
      sampleDaily: daily.slice(0, PREVIEW_ROW_LIMIT) as Array<
        Record<string, string | number | null>
      >,
      warnings,
    },
  };
}
