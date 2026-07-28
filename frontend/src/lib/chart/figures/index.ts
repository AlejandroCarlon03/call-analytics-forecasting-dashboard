/**
 * Pure figure builders — one per chart in the Python dashboard.
 *
 * Nothing here touches the DOM or Plotly itself: each function takes payload
 * rows plus a palette and returns `{ data, layout }`. That is what makes chart
 * behaviour testable at all — and chart failures are overwhelmingly silent (a
 * dropped bar, an upside-down week, a label clipped to its first character), so
 * an assertion is the only thing that catches them.
 *
 * A builder that can legitimately have nothing to draw returns `null` rather
 * than an empty figure; its section then omits the chart and keeps the table.
 */

export { buildForecastFigure } from './forecast';
export { buildMonthlyCostFigure } from './monthlyCost';
export { buildHeatmapFigure } from './heatmap';
export { buildLeaderboardFigure } from './leaderboard';
export { buildImportanceFigure, CHART_FEATURES } from './importance';
export { buildAnomalyFigure } from './anomalies';
