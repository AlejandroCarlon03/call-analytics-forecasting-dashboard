/**
 * The figure shape passed between the pure builders and `PlotlyChart`.
 *
 * `dashboard.py` had `Figure(id, fig, roles)` — a Plotly figure plus a map of
 * which trace properties carry which theme role, because the Python dashboard
 * restyled live figures on a theme toggle. The React version does not need the
 * roles: the palette is an *argument* to every builder, so a theme change
 * rebuilds the figure from the new palette rather than patching the old one.
 * That is why `roles` has no counterpart here.
 */

/** One Plotly trace. Open by design — see `types/plotly.d.ts`. */
export type PlotTrace = Record<string, unknown>;

/** A Plotly layout. Open for the same reason. */
export type PlotLayout = Record<string, unknown>;

export interface PlotFigure {
  data: PlotTrace[];
  layout: PlotLayout;
}
