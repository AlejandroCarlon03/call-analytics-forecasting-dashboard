/**
 * Pure figure builders — one per chart in the Python dashboard.
 *
 * Nothing here touches the DOM or Plotly itself: each function takes payload
 * rows plus a palette and returns `{ data, layout }`. That is what makes chart
 * behaviour testable at all, and it is the seam the remaining charts (monthly
 * cost, heatmap, leaderboard, importance, anomalies) plug into in PR 5.
 */

export { buildForecastFigure } from './forecast';
