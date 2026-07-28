/**
 * Top drivers of the forecast — the port of `_importance_figure()`.
 *
 * Which importance column exists depends on what was available at explain
 * time: SHAP is an optional dependency, permutation importance is always
 * computable but slow, and only tabular models have a native importance. The
 * Python version picked the first present column off the DataFrame; the same
 * preference order is applied here, over rows whose keys are optional.
 *
 * Returns `null` when no feature carries a usable score under any method.
 */

import type { FeatureImportanceRow, Maybe } from '../../../data/types';
import { baseLayout } from '../layout';
import type { ChartPalette } from '../palette';
import { rankedSizing } from '../sizing';
import type { PlotFigure } from '../types';

interface ImportanceInput {
  /** `explanations[target].topFeatures`, already ranked by `rank_mean`. */
  topFeatures: readonly FeatureImportanceRow[];
  palette: ChartPalette;
}

/** How many bars the Python chart drew — `explanation.top_features(10)`. */
export const CHART_FEATURES = 10;

/** SHAP first: it is the only one that explains an individual day. */
const METHODS = ['shap', 'permutation', 'native'] as const;
type Method = (typeof METHODS)[number];

const PER_ROW = 30;
const MIN_HEIGHT = 260;

function isFinite_(value: Maybe | undefined): value is number {
  return value !== undefined && value !== null && Number.isFinite(value);
}

/**
 * The first method any of these rows actually scored.
 *
 * Presence of the *key* is not enough: the serializer emits `null` for a
 * method that ran and produced nothing, and choosing that column would draw a
 * chart of empty bars while a populated column sat unused.
 */
function pickMethod(rows: readonly FeatureImportanceRow[]): Method | null {
  return METHODS.find((method) => rows.some((row) => isFinite_(row[method]))) ?? null;
}

export function buildImportanceFigure({
  topFeatures,
  palette,
}: ImportanceInput): PlotFigure | null {
  const top = topFeatures.slice(0, CHART_FEATURES);
  const method = pickMethod(top);
  if (method === null) return null;

  // Ascending, so the strongest driver lands at the top — Plotly stacks the
  // first category at the bottom.
  const rows = top
    .filter((row) => isFinite_(row[method]))
    .sort((a, b) => (a[method] as number) - (b[method] as number));
  if (rows.length === 0) return null;

  const { labels, height, marginLeft } = rankedSizing(
    rows.map((row) => row.feature),
    { perRow: PER_ROW, minHeight: MIN_HEIGHT },
  );

  const data = [
    {
      type: 'bar',
      x: rows.map((row) => row[method] ?? null),
      y: labels,
      orientation: 'h',
      marker: { color: palette.series1, line: { width: 0 } },
      hovertemplate: '%{y}<br>relative importance: %{x:.3f}<extra></extra>',
      showlegend: false,
    },
  ];

  const layout = baseLayout(palette, height);
  layout['hovermode'] = 'closest';
  layout['margin'] = { ...(layout['margin'] as object), l: marginLeft };
  layout['xaxis'] = {
    ...(layout['xaxis'] as object),
    // The method is named on the axis because the numbers are not comparable
    // across methods — a SHAP value and a permutation delta are different units.
    title: { text: `relative importance (${method})` },
    showgrid: true,
  };
  layout['yaxis'] = { ...(layout['yaxis'] as object), type: 'category', showgrid: false };

  return { data, layout };
}
