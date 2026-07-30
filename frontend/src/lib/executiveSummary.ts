/**
 * The executive summary, derived from the payload a selection is showing.
 *
 * `selection.ts` answers "what did the reader choose"; `selectionView.ts`
 * answers "which slice of the payload does that name". This module answers the
 * last question in that chain: **what are the eight numbers an executive reads
 * before they read a chart.** It is the third and last layer, and it is built
 * on the second rather than beside it — every horizon trim, every anomaly
 * scope and every "does this target belong on the page" test comes from
 * `selectionView.ts` and `selection.ts`, so a card and the chart under it
 * cannot disagree about what is being shown.
 *
 * ***Nothing here models anything.*** Forecasting, evaluation, anomaly
 * detection and model selection all happened in Python; this file selects,
 * compares and labels numbers the payload already carries. The one place that
 * is worth stating out loud is `growthMetric`, which divides two
 * Python-produced means — see its doc comment for why that is a derivation
 * rather than an analytic, and for the payload field whose absence forces it.
 *
 * Everything is pure: payload in, `ExecutiveMetric[]` out. No DOM, no
 * `location`, no React, no formatting decisions the section could not have
 * made itself — the strings are built here precisely so that the label and the
 * number cannot drift apart, which is the same argument `headlineRollup`
 * makes about writing a tile's label from the row it quotes.
 */

import type {
  AnomalySection,
  DashboardPayload,
  ForecastSection,
  HorizonRollup,
  LeaderboardRow,
} from '../data/types';
import { formatCount, formatCurrency, formatDate, formatNumber, EMPTY } from './format';
import { isTargetVisible } from './selection';
import { headlineRollup, selectAnomalies, trimDaily } from './selectionView';

/**
 * The horizon a headline figure quotes when the reader has not narrowed past
 * it. 30 for the same reason `AtAGlanceSection` prefers 30 — it is the figure
 * this dashboard is read for — and resolved through the same `headlineRollup`,
 * so the executive card and the at-a-glance tile above it quote one row.
 */
const PREFERRED_DAYS = 30;

/**
 * A tone is carried only when the *number itself* is the finding.
 *
 * Deliberately the same narrow set `StatTile` allows, and used just as
 * sparingly: a grid where several cards are tinted is a grid where none of
 * them reads as exceptional.
 */
export type MetricTone = 'critical' | 'good';

/**
 * One executive card's content, fully resolved.
 *
 * `value === null` is the unavailable state and `unavailable` then carries the
 * reason. **The two are a pair on purpose**: a card that says "—" without
 * saying why is indistinguishable from a bug, and the brief's rule against
 * inventing data only holds if the absence is legible. Every branch below that
 * cannot produce a number names its missing dependency in prose.
 */
export interface ExecutiveMetric {
  /** Stable across renders and selections — the React key and the test handle. */
  id: string;
  label: string;
  /** Pre-formatted, or `null` when the payload cannot answer. */
  value: string | null;
  /** The supporting line: a horizon, a period, a category, an interval. */
  detail?: string;
  /** Why there is no value. Present exactly when `value` is `null`. */
  unavailable?: string;
  tone?: MetricTone;
}

/** What the section knows, which is what `App` already holds. */
export interface ExecutiveSummaryInput {
  payload: DashboardPayload;
  /** The rail's target, or `null` for "All". */
  selectedTarget: string | null;
  /** The forecast horizon in days; `Infinity` when the run configured none. */
  horizon: number;
  /**
   * Whether a pipeline actually analysed this data.
   *
   * A CSV imported in the browser produces forecasts of nothing and anomalies
   * of nothing; `App` holds this flag beside the payload for exactly that case
   * (see its doc comment there), and the risk card reads it rather than
   * reporting "no anomalies" about a detector that never ran.
   */
  analysisAvailable: boolean;
}

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** A target's display label, falling back to its key. */
function labelFor(payload: DashboardPayload, target: string): string {
  return payload.targetMeta[target]?.label ?? target;
}

/**
 * The rollup a card should quote, or `undefined` when the rail filtered this
 * target away or the run produced no forecast for it.
 *
 * The `isTargetVisible` call is what makes the whole grid answer to the rail
 * in one place: a target-scoped card is *absent* under a selection that
 * excludes it rather than showing an unavailable state, because "not shown
 * here" and "the pipeline could not compute this" are different facts and a
 * grid that renders them identically teaches the reader to ignore both.
 */
function visibleRollup(
  input: ExecutiveSummaryInput,
  target: string,
): { forecast: ForecastSection; rollup: HorizonRollup } | undefined {
  if (!isTargetVisible(target, input.selectedTarget)) return undefined;
  const forecast = input.payload.forecasts[target];
  if (!forecast) return undefined;
  const rollup = headlineRollup(forecast, input.horizon, PREFERRED_DAYS);
  if (!rollup) return undefined;
  return { forecast, rollup };
}

/** `0.9` -> `"90%"`, truncated the way `dashboard.py` truncates it. */
function intervalLabel(forecast: ForecastSection): string {
  return `${Math.trunc(forecast.intervalLevel * 100)}%`;
}

// ---------------------------------------------------------------- volume ---

function callsMetric(input: ExecutiveSummaryInput): ExecutiveMetric | null {
  const target = 'call_volume';
  if (!isTargetVisible(target, input.selectedTarget)) return null;

  const found = visibleRollup(input, target);
  if (!found || !isNumber(found.rollup.forecast)) {
    return {
      id: 'forecast-calls',
      label: 'Forecasted calls',
      value: null,
      unavailable: 'No call-volume forecast in this payload.',
    };
  }

  const { forecast, rollup } = found;
  const band =
    isNumber(rollup.lower) && isNumber(rollup.upper)
      ? `${formatCount(rollup.lower)}–${formatCount(rollup.upper)} at ${intervalLabel(forecast)}`
      : undefined;

  return {
    id: 'forecast-calls',
    label: 'Forecasted calls',
    value: formatCount(rollup.forecast),
    detail: band === undefined ? `next ${rollup.days} days` : `next ${rollup.days} days · ${band}`,
  };
}

// ------------------------------------------------------------------ cost ---

function costMetric(input: ExecutiveSummaryInput): ExecutiveMetric | null {
  const target = 'total_cost';
  if (!isTargetVisible(target, input.selectedTarget)) return null;

  const found = visibleRollup(input, target);
  if (!found || !isNumber(found.rollup.forecast)) {
    return {
      id: 'forecast-cost',
      label: 'Forecasted cost',
      value: null,
      unavailable: 'No cost forecast in this payload.',
    };
  }

  const { forecast, rollup } = found;
  const band =
    isNumber(rollup.lower) && isNumber(rollup.upper)
      ? `${formatCurrency(rollup.lower)}–${formatCurrency(rollup.upper)} at ${intervalLabel(forecast)}`
      : undefined;

  return {
    id: 'forecast-cost',
    label: 'Forecasted cost',
    value: formatCurrency(rollup.forecast),
    detail: band === undefined ? `next ${rollup.days} days` : `next ${rollup.days} days · ${band}`,
  };
}

// -------------------------------------------------------------- duration ---

function durationMetric(input: ExecutiveSummaryInput): ExecutiveMetric | null {
  const target = 'avg_duration_sec';
  if (!isTargetVisible(target, input.selectedTarget)) return null;

  const found = visibleRollup(input, target);
  if (!found || !isNumber(found.rollup.forecast)) {
    return {
      id: 'forecast-duration',
      label: 'Average call duration',
      value: null,
      // The realistic cause, and it is a documented pipeline behaviour rather
      // than a failure: on the 71-day export every learned duration model is
      // skipped below the `min_observations` floor, so the section is right to
      // be empty and the reader should be told which of the two it is.
      unavailable: 'No duration forecast — the pipeline skipped this target.',
    };
  }

  const { rollup } = found;
  return {
    id: 'forecast-duration',
    label: 'Average call duration',
    value: `${formatCount(rollup.forecast)}s`,
    detail: `predicted ${rollup.measure}, next ${rollup.days} days`,
  };
}

// ----------------------------------------------------------------- model ---

/** The leaderboard row the pipeline selected for a target, if it named one. */
function selectedRow(
  payload: DashboardPayload,
  target: string,
): LeaderboardRow | undefined {
  const evaluation = payload.evaluations[target];
  if (!evaluation) return undefined;
  return (
    evaluation.leaderboard.find((row) => row.selected) ??
    evaluation.leaderboard.find((row) => row.model === evaluation.bestModel)
  );
}

/**
 * The best-performing model across everything the selection is showing.
 *
 * **Ranked on MASE, ascending, because that is what the pipeline selects on**
 * (§3) — re-ranking on MAE or R² here would put a card on the page disagreeing
 * with the leaderboard below it about which model won. Rows without a MASE are
 * eligible to be named but never to win a comparison: a skipped model has a
 * whole row of nulls, and treating a missing score as a good one is how a card
 * ends up crowning the model that never ran.
 */
function confidenceMetric(input: ExecutiveSummaryInput): ExecutiveMetric {
  const { payload } = input;

  let best: { target: string; row: LeaderboardRow } | undefined;
  let fallback: { target: string; row: LeaderboardRow } | undefined;

  for (const target of payload.targets) {
    if (!isTargetVisible(target, input.selectedTarget)) continue;
    const row = selectedRow(payload, target);
    if (!row) continue;
    fallback ??= { target, row };
    if (!isNumber(row.mase)) continue;
    if (best === undefined || row.mase < (best.row.mase as number)) {
      best = { target, row };
    }
  }

  const chosen = best ?? fallback;
  if (!chosen) {
    return {
      id: 'best-model',
      label: 'Highest confidence model',
      value: null,
      unavailable: 'No model was scored for this selection.',
    };
  }

  const { target, row } = chosen;
  const scope = labelFor(payload, target);

  if (!isNumber(row.mase)) {
    return {
      id: 'best-model',
      label: 'Highest confidence model',
      value: row.label,
      // Named, but honestly unscored — the model the pipeline selected with no
      // cross-validated metric to show for it.
      detail: `${scope} · no cross-validated score`,
    };
  }

  // Below 1 beats the seasonal-naive benchmark; at or above 1 it does not, and
  // that is the single most decision-relevant fact about this number. Tinting
  // it good only under 1 is the same honesty mechanism as the
  // `min_observations` floor: the card must not read as reassuring when the
  // model is losing to "repeat last week".
  const beats = row.mase < 1;
  return {
    id: 'best-model',
    label: 'Highest confidence model',
    value: row.label,
    detail: `${scope} · MASE ${formatNumber(row.mase, 2)} ${
      beats ? '(beats the seasonal-naive benchmark)' : '(does not beat seasonal-naive)'
    }`,
    ...(beats ? { tone: 'good' as const } : {}),
  };
}

// --------------------------------------------------------------- horizon ---

/** The forecast rows the current selection is showing, for any target. */
function anyTrimmedDaily(input: ExecutiveSummaryInput) {
  for (const target of input.payload.targets) {
    if (!isTargetVisible(target, input.selectedTarget)) continue;
    const forecast = input.payload.forecasts[target];
    if (!forecast) continue;
    const rows = trimDaily(forecast.daily, input.horizon);
    if (rows.length > 0) return rows;
  }
  return undefined;
}

function horizonMetric(input: ExecutiveSummaryInput): ExecutiveMetric {
  const rows = anyTrimmedDaily(input);
  const finite = Number.isFinite(input.horizon);

  // `Infinity` is the honest reading of a run that configured no horizons, and
  // it must not be printed as "Infinity days".
  const value = finite
    ? `${input.horizon} days`
    : rows === undefined
      ? null
      : `${rows.length} days`;

  if (value === null) {
    return {
      id: 'horizon',
      label: 'Prediction horizon',
      value: null,
      unavailable: 'This run configured no forecast horizon.',
    };
  }

  const first = rows?.[0];
  const last = rows?.[rows.length - 1];
  const range =
    first && last ? `${formatDate(first.date)} – ${formatDate(last.date)}` : undefined;

  return {
    id: 'horizon',
    label: 'Prediction horizon',
    value,
    ...(range === undefined ? {} : { detail: range }),
  };
}

// ---------------------------------------------------------------- growth ---

/** The mean of a target's observed values over the last `days` calendar days. */
function trailingMean(
  payload: DashboardPayload,
  target: string,
  days: number,
): number | undefined {
  const window = payload.daily.slice(-days);
  let total = 0;
  let seen = 0;
  for (const row of window) {
    const value = row[target];
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      seen += 1;
    }
  }
  // A single day is not a baseline. Requiring most of the window guards the
  // ratio against the `avg_duration_sec` case, which is null on 59% of days.
  return seen >= Math.max(3, Math.ceil(days / 2)) ? total / seen : undefined;
}

/** A rollup's per-day figure, whichever way the serializer expressed it. */
function dailyMean(rollup: HorizonRollup): number | undefined {
  if (!isNumber(rollup.forecast)) return undefined;
  if (rollup.measure === 'daily average') return rollup.forecast;
  return rollup.days > 0 ? rollup.forecast / rollup.days : undefined;
}

/**
 * The largest movement between what was observed and what is forecast.
 *
 * ***This is the one card the payload does not carry, and the derivation is
 * deliberately the smallest one that answers the question.*** It divides two
 * numbers Python produced — the forecast's per-day figure over the chosen
 * horizon, and the observed per-day figure over the same number of trailing
 * days — and reports the percentage between them. No model, no fit, no
 * smoothing, no trend estimator: it is the comparison a reader would make by
 * eye between the two halves of the forecast chart, made once instead of three
 * times.
 *
 * **The missing dependency, stated plainly:** `serialize.py` emits no
 * growth, trend or period-over-period field, so there is nothing to display
 * instead. If a future PR wants a real trend — a fitted slope, a seasonal
 * decomposition, a significance test — that belongs in Python beside
 * `forecast.py` and arrives here as a payload field, and this function should
 * be deleted the day it does.
 *
 * Targets are compared on **relative** change precisely because they are not
 * commensurable: seconds, dollars and calls cannot be ranked by absolute
 * movement.
 */
function growthMetric(input: ExecutiveSummaryInput): ExecutiveMetric {
  const { payload } = input;

  let best: { target: string; pct: number; days: number } | undefined;

  for (const target of payload.targets) {
    const found = visibleRollup(input, target);
    if (!found) continue;
    const forecastMean = dailyMean(found.rollup);
    if (forecastMean === undefined) continue;
    const observedMean = trailingMean(payload, target, found.rollup.days);
    // A zero baseline makes the ratio meaningless rather than infinite, and a
    // card reading "+∞%" is worse than one target fewer in the comparison.
    if (observedMean === undefined || observedMean === 0) continue;

    const pct = (forecastMean - observedMean) / observedMean;
    if (best === undefined || Math.abs(pct) > Math.abs(best.pct)) {
      best = { target, pct, days: found.rollup.days };
    }
  }

  if (!best) {
    return {
      id: 'growth',
      label: 'Largest predicted change',
      value: null,
      unavailable: 'Not enough observed history to compare against the forecast.',
    };
  }

  const sign = best.pct >= 0 ? '+' : '−';
  return {
    id: 'growth',
    label: 'Largest predicted change',
    value: `${sign}${formatNumber(Math.abs(best.pct) * 100, 1)}%`,
    detail: `${labelFor(payload, best.target)} · next ${best.days} days vs the last ${best.days}`,
  };
}

// ------------------------------------------------------------- peak day ---

/**
 * The single busiest forecast day in the period on show.
 *
 * A `max` over rows the payload already contains, trimmed by the same
 * `trimDaily` the forecast chart uses — so the card names a day the reader can
 * find on the chart rather than one the horizon has scrolled past.
 */
function peakDayMetric(input: ExecutiveSummaryInput): ExecutiveMetric | null {
  const target = 'call_volume';
  if (!isTargetVisible(target, input.selectedTarget)) return null;

  const forecast = input.payload.forecasts[target];
  const rows = forecast ? trimDaily(forecast.daily, input.horizon) : [];

  let peak: { date: string; yhat: number } | undefined;
  for (const row of rows) {
    if (!isNumber(row.yhat)) continue;
    if (peak === undefined || row.yhat > peak.yhat) peak = { date: row.date, yhat: row.yhat };
  }

  if (!peak) {
    return {
      id: 'peak-day',
      label: 'Peak call day',
      value: null,
      unavailable: 'No daily call-volume forecast in this payload.',
    };
  }

  return {
    id: 'peak-day',
    label: 'Peak call day',
    value: formatDate(peak.date),
    detail: `${formatNumber(peak.yhat, 1)} calls forecast — the busiest day on show`,
  };
}

// ------------------------------------------------------------------ risk ---

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** `"2026-05-18"` -> `"May 2026"`. Grouping key and label in one. */
function monthLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return date;
  const [, year, month] = match;
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name} ${year}` : date;
}

/**
 * The period carrying the most flagged days.
 *
 * ***This is a historical concentration, not a predicted one, and the card
 * says so.*** `anomalies.py` evaluates observed days; nothing in the payload
 * scores a *future* period for risk, and inventing one from interval widths
 * would be exactly the fabricated finding §10 exists to remove. The honest
 * answer to "what period needs attention" from this payload is "the one that
 * has been going wrong", so that is what it reports, labelled as observed.
 *
 * Ranked on critical days first and warning days only as a tiebreak: five
 * warnings are not one critical, and summing them would say they were.
 */
function riskMetric(input: ExecutiveSummaryInput): ExecutiveMetric {
  const base: Pick<ExecutiveMetric, 'id' | 'label'> = {
    id: 'risk-period',
    label: 'Highest risk period',
  };

  if (!input.analysisAvailable) {
    return {
      ...base,
      value: null,
      // "We checked and found nothing" and "nothing was checked" are different
      // findings — the distinction `analysisAvailable` exists for.
      unavailable: 'Nothing analysed this data — anomaly detection is a pipeline step.',
    };
  }

  const scoped: AnomalySection = selectAnomalies(input.payload.anomalies, input.selectedTarget);
  const buckets = new Map<string, { critical: number; warning: number }>();
  for (const item of scoped.items) {
    if (item.severity === 'info') continue;
    const key = monthLabel(item.date);
    const bucket = buckets.get(key) ?? { critical: 0, warning: 0 };
    bucket[item.severity] += 1;
    buckets.set(key, bucket);
  }

  let worst: { period: string; critical: number; warning: number } | undefined;
  for (const [period, bucket] of buckets) {
    if (
      worst === undefined ||
      bucket.critical > worst.critical ||
      (bucket.critical === worst.critical && bucket.warning > worst.warning)
    ) {
      worst = { period, ...bucket };
    }
  }

  if (!worst) {
    return {
      ...base,
      value: EMPTY,
      detail: 'No critical or warning alerts were raised for this selection.',
      tone: 'good',
    };
  }

  return {
    ...base,
    value: worst.period,
    detail: `${worst.critical} critical · ${worst.warning} warning (observed, not forecast)`,
    ...(worst.critical > 0 ? { tone: 'critical' as const } : {}),
  };
}

// ------------------------------------------------------------------ all ---

/**
 * The executive summary for a selection.
 *
 * **Order is fixed** — the three forecast figures, then the model, the
 * horizon, the change, the peak and the risk — rather than following
 * `payload.targets`. A reader who opens this every morning should find the
 * cost card in the same place each time, which is the same argument
 * `AtAGlanceSection` makes about its tiles.
 *
 * A `null` entry is a card the *rail* removed; an entry with `value: null` is
 * a card the *payload* could not fill. Both are meaningful and they are not
 * the same, so only the first is dropped here.
 */
export function executiveMetrics(input: ExecutiveSummaryInput): ExecutiveMetric[] {
  const metrics: (ExecutiveMetric | null)[] = [
    callsMetric(input),
    costMetric(input),
    durationMetric(input),
    confidenceMetric(input),
    horizonMetric(input),
    growthMetric(input),
    peakDayMetric(input),
    riskMetric(input),
  ];
  return metrics.filter((metric): metric is ExecutiveMetric => metric !== null);
}

/** Exported for the test that pins the horizon a headline figure prefers. */
export { PREFERRED_DAYS };
