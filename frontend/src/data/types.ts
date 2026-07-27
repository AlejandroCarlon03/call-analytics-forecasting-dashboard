/**
 * The dashboard payload contract.
 *
 * This mirrors `call_forecast/serialize.py`. The two are kept in step by hand,
 * so when the Python side bumps `SCHEMA_VERSION` this file changes with it.
 *
 * Two conventions carried over from the serializer, both deliberate:
 *
 * 1. **Structural keys are camelCase; data identifiers are not.** `modelLabel`
 *    is structure. `call_volume`, `yhat_lower` and `call_volume_roll7_vs_roll30`
 *    are domain identifiers that also appear in the CSV deliverables, in
 *    `config.yaml` and in the feature specification — renaming them here only
 *    would break that correspondence.
 *
 * 2. **Every number can be `null`.** The serializer turns NaN and Infinity into
 *    `null` rather than emitting invalid JSON. This is not a rare edge case:
 *    `avg_duration_sec` is null on every zero-call day (59% of the real
 *    export), and a model skipped by the `min_observations` floor has a whole
 *    row of null metrics. Code that assumes a number here will break on real
 *    data, which is why the type says so.
 */

/** Dates are ISO `YYYY-MM-DD` at daily grain. */
export type IsoDate = string;
/** Timestamps are full ISO 8601, local time, seconds precision. */
export type IsoDateTime = string;
/** A metric that may be undefined for legitimate reasons. */
export type Maybe = number | null;

export type TargetKey = 'call_volume' | 'avg_duration_sec' | 'total_cost';
export type Severity = 'critical' | 'warning' | 'info';
export type Aggregate = 'sum' | 'mean';

// --------------------------------------------------------------------------
//  Envelope
// --------------------------------------------------------------------------
export interface IngestionReport {
  files: string[];
  rows_read: number;
  rows_kept: number;
  dropped: Record<string, number>;
  warnings: string[];
  missing_columns: string[];
  date_min: IsoDate | null;
  date_max: IsoDate | null;
  active_days: number;
  calendar_days: number;
  coverage_pct: number;
}

export interface ConfigSummary {
  forecast: {
    horizons: number[];
    interval_level: number;
    n_simulations: number;
    targets: string[];
  };
  cv: {
    horizon: number;
    step: number;
    initial_train_days: number;
    min_folds: number;
    selection_metric: string;
    selection_tiebreaker: string;
  };
  data: {
    holiday_country: string;
    holiday_subdiv: string | null;
  };
  business_hours: {
    start_hour: number;
    end_hour: number;
    overnight_start_hour: number;
    overnight_end_hour: number;
  };
  anomalies: {
    cost_overrun_pct: number;
    duration_sigma: number;
    missed_spike_sigma: number;
    robust_z_threshold: number;
    baseline_window_days: number;
  };
  scenarios: {
    current_agents: number;
    target_answer_seconds: number;
    service_level_pct: number;
    staffed_hours_per_day: number;
  };
  models: { enabled: string[] };
}

export interface TargetMeta {
  label: string;
  units: string;
  aggregate: Aggregate;
}

// --------------------------------------------------------------------------
//  Forecasts
// --------------------------------------------------------------------------
export interface ForecastDayRow {
  date: IsoDate;
  yhat: Maybe;
  yhat_lower: Maybe;
  yhat_upper: Maybe;
  step: number;
  /** `"30d"` | `"60d"` | `"90d"` — a pandas Categorical, serialized as text. */
  horizon_bucket: string | null;
}

export interface ForecastMonthRow {
  month: string;
  month_start: IsoDate;
  days_forecast: number;
  days_in_month: number;
  /** True when the forecast covers only part of the calendar month. */
  partial_month: boolean;
  yhat: Maybe;
  yhat_lower: Maybe;
  yhat_upper: Maybe;
  aggregate: Aggregate;
}

/**
 * A headline 30/60/90 figure.
 *
 * Carried explicitly because it is *not* derivable from `daily`: the bounds
 * come from the distribution of simulated trajectory sums, not from summing
 * daily bounds.
 */
export interface HorizonRollup {
  days: number;
  measure: 'total' | 'daily average';
  forecast: Maybe;
  lower: Maybe;
  upper: Maybe;
}

export interface ForecastSection {
  target: string;
  model: string;
  modelLabel: string;
  intervalLevel: number;
  /** False when no CV residuals were available; the intervals are then narrow. */
  calibrated: boolean;
  aggregate: Aggregate;
  notes: string[];
  horizons: HorizonRollup[];
  daily: ForecastDayRow[];
  monthly: ForecastMonthRow[];
}

// --------------------------------------------------------------------------
//  Evaluation
// --------------------------------------------------------------------------
export interface LeaderboardRow {
  model: string;
  label: string;
  /** `"ok"` for a model that ran; anything else means it was skipped. */
  status: string;
  selected: boolean;
  n_folds: number;
  fit_seconds: Maybe;
  mae: Maybe;
  rmse: Maybe;
  r2: Maybe;
  mape: Maybe;
  /** How many days the MAPE was computed over. A MAPE from 4 days is not a MAPE from 40. */
  mape_n: Maybe;
  smape: Maybe;
  /** Below 1 beats a seasonal-naive forecast; at or above 1 it does not. */
  mase: Maybe;
  bias: Maybe;
  beats_baseline?: boolean | null;
  note?: string | null;
}

export interface EvaluationSection {
  target: string;
  bestModel: string | null;
  selectionMetric: string;
  nFolds: number;
  horizon: number;
  notes: string[];
  leaderboard: LeaderboardRow[];
}

// --------------------------------------------------------------------------
//  Explainability
// --------------------------------------------------------------------------
/**
 * One feature's importance.
 *
 * `shap`, `permutation` and `native` are each optional: which are present
 * depends on what was available at explain time (SHAP is an optional
 * dependency, and non-tabular models have no native importance).
 */
export interface FeatureImportanceRow {
  feature: string;
  rank_mean: Maybe;
  shap?: Maybe;
  permutation?: Maybe;
  native?: Maybe;
}

export interface ExplanationSection {
  target: string;
  model: string;
  modelLabel: string;
  method: string;
  summary: string;
  nTrainRows: number;
  expectedValue: Maybe;
  notes: string[];
  topFeatures: FeatureImportanceRow[];
}

// --------------------------------------------------------------------------
//  History, arrivals, anomalies, scenarios
// --------------------------------------------------------------------------
/**
 * One day of observed history.
 *
 * The three targets are always present; the remaining ~24 columns of the base
 * daily frame come through as well, hence the index signature. The engineered
 * feature matrix is deliberately *not* here.
 */
export interface DailyRow {
  date: IsoDate;
  call_volume: Maybe;
  avg_duration_sec: Maybe;
  total_cost: Maybe;
  [column: string]: Maybe | string;
}

export interface HourlyCell {
  /** Monday is 0, matching `Timestamp.dayofweek`. */
  weekday: number;
  weekdayLabel: string;
  hour: number;
  calls: number;
}

export interface AnomalyRow {
  date: IsoDate;
  rule: string;
  metric: string;
  actual: Maybe;
  expected: Maybe;
  deviation: Maybe;
  severity: Severity;
  message: string;
}

export interface AnomalyRuleTally {
  rule: string;
  severity: Severity;
  count: number;
}

export interface AnomalySection {
  items: AnomalyRow[];
  byRule: AnomalyRuleTally[];
  notes: string[];
  /** Always carries all three keys, zeroed — never partial. */
  counts: Record<Severity, number>;
}

export interface ScenarioRow {
  scenario: string;
  [column: string]: Maybe | string | boolean;
}

export interface ScenarioSection {
  rows: ScenarioRow[];
  notes: string[];
}

// --------------------------------------------------------------------------
//  Root
// --------------------------------------------------------------------------
export interface DashboardPayload {
  schemaVersion: number;
  generatedAt: IsoDateTime;
  ingestion: IngestionReport;
  config: ConfigSummary;
  /** Configured order, restricted to targets that actually produced output. */
  targets: string[];
  targetMeta: Record<string, TargetMeta>;
  forecasts: Record<string, ForecastSection>;
  evaluations: Record<string, EvaluationSection>;
  explanations: Record<string, ExplanationSection>;
  daily: DailyRow[];
  /** All 7 x 24 cells, including empty ones. */
  hourly: HourlyCell[];
  anomalies: AnomalySection;
  scenarios: ScenarioSection;
}

/** The version this frontend was written against. */
export const EXPECTED_SCHEMA_VERSION = 1;
