/**
 * The anti-duplication core of the Export Center.
 *
 * Everything the six analytics can produce is computed here, in one pass per
 * analytic, from the same helpers the on-screen sections use — `isTargetVisible`,
 * `trimDaily`, `trimHorizons`, `selectAnomalies` for selection, and the pure
 * figure builders in `lib/chart/figures/` for PNG. An export that filtered or
 * charted its own way would be a second implementation of what the page already
 * does, and the first time the two disagreed the file would not match the
 * report it came from (see `types.ts`'s doc comment on `ExportContext`).
 */

import type { ExplanationSection } from '../../data/types';
import {
  buildAnomalyFigure,
  buildForecastFigure,
  buildHeatmapFigure,
  buildImportanceFigure,
  buildLeaderboardFigure,
  buildMonthlyCostFigure,
} from '../chart/figures';
import { isTargetVisible } from '../selection';
import { selectAnomalies, trimDaily, trimHorizons } from '../selectionView';
import { ANALYTICS, analyticById } from './types';
import type {
  AnalyticDescriptor,
  AnalyticExport,
  AnalyticId,
  ExportContext,
  ExportFigure,
  ExportRow,
} from './types';

// --------------------------------------------------------------------------
//  availableAnalytics — the UI's picker list
// --------------------------------------------------------------------------

const IMPORTANCE_METHODS = ['shap', 'permutation', 'native'] as const;

/**
 * Whether any feature in an explanation carries a finite score under any
 * method. Mirrors `pickMethod()` in `lib/chart/figures/importance.ts`: a
 * present key with a `null` value is a method that ran and found nothing, not
 * a usable score.
 */
function hasUsableImportance(explanation: ExplanationSection | undefined): boolean {
  if (!explanation) return false;
  return explanation.topFeatures.some((row) =>
    IMPORTANCE_METHODS.some((method) => {
      const value = row[method];
      return value !== undefined && value !== null && Number.isFinite(value);
    }),
  );
}

/** The analytics that are exportable for this context — the UI's picker list. */
export function availableAnalytics(
  ctx: Pick<ExportContext, 'payload' | 'analysisAvailable'>,
): AnalyticDescriptor[] {
  const { payload, analysisAvailable } = ctx;

  return ANALYTICS.filter((descriptor) => {
    if (descriptor.requiresAnalysis && !analysisAvailable) return false;

    switch (descriptor.id) {
      // Mirrors `ForecastsSection`'s `present.length === 0` guard.
      case 'forecasts':
        return payload.targets.some((target) => payload.forecasts[target] !== undefined);
      // Mirrors `MonthlyCostSection`'s `monthly.length === 0` guard.
      case 'monthlyCost':
        return (payload.forecasts['total_cost']?.monthly.length ?? 0) > 0;
      // Mirrors `ModelComparisonSection`'s per-target `leaderboard.length > 0` filter.
      case 'leaderboard':
        return payload.targets.some(
          (target) => (payload.evaluations[target]?.leaderboard.length ?? 0) > 0,
        );
      // Mirrors `ArrivalsSection`'s `hourly.length === 0` guard.
      case 'heatmap':
        return payload.hourly.length > 0;
      // Mirrors `buildImportanceFigure` returning null for every target.
      case 'importance':
        return payload.targets.some((target) => hasUsableImportance(payload.explanations[target]));
      // `AnomalySection.counts` is never partial (see `data/types.ts`), so the
      // section always has something to show, even if it is all zeroes.
      case 'anomalies':
        return true;
      default:
        return true;
    }
  });
}

// --------------------------------------------------------------------------
//  buildAnalyticExports — the six analytics, one pass each
// --------------------------------------------------------------------------

/** `payload.targets`, filtered to what the selection leaves visible, in payload order. */
function visibleTargets(ctx: ExportContext): readonly string[] {
  return ctx.payload.targets.filter((target) => isTargetVisible(target, ctx.selection.target));
}

const FORECAST_COLUMNS = [
  'target',
  'date',
  'yhat',
  'yhat_lower',
  'yhat_upper',
  'horizon_bucket',
] as const;

function buildForecasts(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('forecasts');
  const targets = visibleTargets(ctx).filter(
    (target) => ctx.payload.forecasts[target] !== undefined,
  );

  const rows: ExportRow[] = [];
  const json: Record<string, unknown> = {};
  const figures: ExportFigure[] = [];

  for (const target of targets) {
    const forecast = ctx.payload.forecasts[target]!;
    const meta = ctx.payload.targetMeta[target];
    const trimmedDaily = trimDaily(forecast.daily, ctx.selection.horizon);
    const trimmedHorizons = trimHorizons(forecast.horizons, ctx.selection.horizon);

    for (const day of trimmedDaily) {
      rows.push({
        target,
        date: day.date,
        yhat: day.yhat,
        yhat_lower: day.yhat_lower,
        yhat_upper: day.yhat_upper,
        horizon_bucket: day.horizon_bucket,
      });
    }

    json[target] = { ...forecast, daily: trimmedDaily, horizons: trimmedHorizons };

    // Same inputs `ForecastCard` passes: `daily` is the *whole* observed
    // history (the figure draws the full line), only the forecast half is
    // trimmed to the horizon.
    const figure = buildForecastFigure({
      daily: ctx.payload.daily,
      forecast: trimmedDaily,
      target,
      intervalLevel: forecast.intervalLevel,
      modelLabel: forecast.modelLabel,
      units: meta?.units ?? '',
      palette: ctx.palette,
    });
    figures.push({
      slug: target,
      label: `${meta?.label ?? target} — ${forecast.modelLabel}`,
      figure,
    });
  }

  return {
    id: 'forecasts',
    descriptor,
    table: { columns: FORECAST_COLUMNS, rows },
    json,
    figures,
  };
}

const MONTHLY_COST_TARGET = 'total_cost';

const MONTHLY_COST_COLUMNS = [
  'target',
  'month',
  'days_forecast',
  'partial_month',
  'yhat',
  'yhat_lower',
  'yhat_upper',
] as const;

function buildMonthlyCost(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('monthlyCost');
  const visible = isTargetVisible(MONTHLY_COST_TARGET, ctx.selection.target);
  const forecast = ctx.payload.forecasts[MONTHLY_COST_TARGET];
  const monthly = visible ? (forecast?.monthly ?? []) : [];

  const rows: ExportRow[] = monthly.map((row) => ({
    target: MONTHLY_COST_TARGET,
    month: row.month,
    days_forecast: row.days_forecast,
    partial_month: row.partial_month,
    yhat: row.yhat,
    yhat_lower: row.yhat_lower,
    yhat_upper: row.yhat_upper,
  }));

  const json: Record<string, unknown> =
    visible && forecast !== undefined
      ? { [MONTHLY_COST_TARGET]: { ...forecast, monthly } }
      : {};

  const figures: ExportFigure[] = [];
  if (visible && monthly.length > 0) {
    figures.push({
      slug: MONTHLY_COST_TARGET,
      label: descriptor.label,
      figure: buildMonthlyCostFigure({ monthly, palette: ctx.palette }),
    });
  }

  return {
    id: 'monthlyCost',
    descriptor,
    table: { columns: MONTHLY_COST_COLUMNS, rows },
    json,
    figures,
  };
}

const LEADERBOARD_COLUMNS = [
  'target',
  'label',
  'status',
  'n_folds',
  'mae',
  'rmse',
  'r2',
  'mape',
  'mape_n',
  'smape',
  'mase',
  'bias',
  'beats_baseline',
  'note',
] as const;

function buildLeaderboard(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('leaderboard');
  const targets = visibleTargets(ctx).filter(
    (target) => (ctx.payload.evaluations[target]?.leaderboard.length ?? 0) > 0,
  );

  const rows: ExportRow[] = [];
  const json: Record<string, unknown> = {};
  const figures: ExportFigure[] = [];

  for (const target of targets) {
    const evaluation = ctx.payload.evaluations[target]!;
    const meta = ctx.payload.targetMeta[target];

    for (const row of evaluation.leaderboard) {
      rows.push({
        target,
        label: row.label,
        status: row.status,
        n_folds: row.n_folds,
        mae: row.mae,
        rmse: row.rmse,
        r2: row.r2,
        mape: row.mape,
        mape_n: row.mape_n,
        smape: row.smape,
        mase: row.mase,
        bias: row.bias,
        beats_baseline: row.beats_baseline ?? null,
        note: row.note ?? null,
      });
    }

    json[target] = evaluation;

    const figure = buildLeaderboardFigure({
      leaderboard: evaluation.leaderboard,
      units: meta?.units ?? '',
      palette: ctx.palette,
    });
    if (figure !== null) {
      figures.push({ slug: target, label: meta?.label ?? target, figure });
    }
  }

  return {
    id: 'leaderboard',
    descriptor,
    table: { columns: LEADERBOARD_COLUMNS, rows },
    json,
    figures,
  };
}

const HEATMAP_COLUMNS = ['weekday', 'hour', 'calls'] as const;

function buildHeatmap(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('heatmap');

  // Run-wide and never filtered by target — `ArrivalsSection` takes no
  // selection prop at all. The table matches what the section lists: only the
  // cells with calls in them, busiest first, rather than all 168.
  const ranked = ctx.payload.hourly
    .filter((cell) => cell.calls > 0)
    .sort((a, b) => b.calls - a.calls);

  const rows: ExportRow[] = ranked.map((cell) => ({
    weekday: cell.weekdayLabel,
    hour: cell.hour,
    calls: cell.calls,
  }));

  const figure = buildHeatmapFigure({ hourly: ctx.payload.hourly, palette: ctx.palette });

  return {
    id: 'heatmap',
    descriptor,
    table: { columns: HEATMAP_COLUMNS, rows },
    // The chart draws the whole 7x24 grid, empty cells included, so the JSON
    // export carries the same full grid rather than the ranked table's subset.
    json: ctx.payload.hourly,
    figures: [{ slug: descriptor.slug, label: descriptor.label, figure }],
  };
}

const IMPORTANCE_COLUMNS = ['target', 'feature', 'rank_mean', 'shap', 'permutation', 'native'] as const;

function buildImportance(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('importance');
  const targets = visibleTargets(ctx).filter(
    (target) => ctx.payload.explanations[target] !== undefined,
  );

  const rows: ExportRow[] = [];
  const json: Record<string, unknown> = {};
  const figures: ExportFigure[] = [];

  for (const target of targets) {
    const explanation = ctx.payload.explanations[target]!;
    const meta = ctx.payload.targetMeta[target];

    for (const row of explanation.topFeatures) {
      rows.push({
        target,
        feature: row.feature,
        rank_mean: row.rank_mean,
        shap: row.shap ?? null,
        permutation: row.permutation ?? null,
        native: row.native ?? null,
      });
    }

    json[target] = explanation;

    const figure = buildImportanceFigure({
      topFeatures: explanation.topFeatures,
      palette: ctx.palette,
    });
    if (figure !== null) {
      figures.push({
        slug: target,
        label: `${meta?.label ?? target} — ${explanation.modelLabel}`,
        figure,
      });
    }
  }

  return {
    id: 'importance',
    descriptor,
    table: { columns: IMPORTANCE_COLUMNS, rows },
    json,
    figures,
  };
}

const ANOMALY_COLUMNS = [
  'date',
  'rule',
  'metric',
  'actual',
  'expected',
  'deviation',
  'severity',
  'message',
] as const;

function buildAnomalies(ctx: ExportContext): AnalyticExport {
  const descriptor = analyticById('anomalies');
  const scoped = selectAnomalies(ctx.payload.anomalies, ctx.selection.target);

  const rows: ExportRow[] = scoped.items.map((item) => ({
    date: item.date,
    rule: item.rule,
    metric: item.metric,
    actual: item.actual,
    expected: item.expected,
    deviation: item.deviation,
    severity: item.severity,
    message: item.message,
  }));

  const figure = buildAnomalyFigure({
    daily: ctx.payload.daily,
    anomalies: scoped.items,
    palette: ctx.palette,
  });

  return {
    id: 'anomalies',
    descriptor,
    table: { columns: ANOMALY_COLUMNS, rows },
    json: scoped,
    figures: [{ slug: descriptor.slug, label: descriptor.label, figure }],
  };
}

const BUILDERS: Record<AnalyticId, (ctx: ExportContext) => AnalyticExport> = {
  forecasts: buildForecasts,
  monthlyCost: buildMonthlyCost,
  leaderboard: buildLeaderboard,
  heatmap: buildHeatmap,
  importance: buildImportance,
  anomalies: buildAnomalies,
};

/**
 * Compute `table`, `json` and `figures` for each requested analytic, in one
 * pass per analytic, so the three views of one analytic cannot disagree about
 * what the selection includes.
 */
export function buildAnalyticExports(
  ctx: ExportContext,
  ids: readonly AnalyticId[],
): AnalyticExport[] {
  return ids.map((id) => BUILDERS[id](ctx));
}
