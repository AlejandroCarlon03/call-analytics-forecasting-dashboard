import { useCallback, useEffect, useRef } from 'react';
import Plotly from 'plotly.js-cartesian-dist-min';
import { PLOT_CONFIG } from '../../lib/chart/layout';
import type { PlotFigure } from '../../lib/chart/types';
import styles from './PlotlyChart.module.css';

interface PlotlyChartProps {
  figure: PlotFigure;
  /**
   * What the chart shows, for a reader who cannot see it.
   *
   * Plotly renders an SVG with no accessible name, so without this the chart is
   * an unlabelled graphic. Every chart in this dashboard also ships a
   * `TableView` with the same numbers; this description is what tells a screen
   * reader that the table is there and worth opening.
   */
  description: string;
  /** DOM id, so the model rail can scroll a chart's card into view. */
  id?: string;
}

/**
 * The one place Plotly is touched.
 *
 * A thin wrapper over `Plotly.react()` rather than `react-plotly.js`, which is
 * thinly maintained and pulls the full 4.9 MB bundle by default; this imports
 * `plotly.js-cartesian-dist-min` (scatter + bar + heatmap, ~1.1 MB), which is
 * every trace type this dashboard draws.
 *
 * `react()` rather than `newPlot()` on update: it diffs against the existing
 * graph instead of tearing it down, so a theme change restyles in place with no
 * flash. This is the React equivalent of the `roles` map the Python dashboard
 * carried — except the figure is rebuilt from the new palette upstream, so
 * there is no property-patching table to keep in step with the traces.
 *
 * **Width is passed explicitly, and that is not incidental.** Plotly's own
 * resize paths — `config.responsive` and `Plots.resize()` — both work by
 * deleting `layout.width` *and* `layout.height` and re-running an autosize
 * (see `Plots.resize` in the dist bundle: it early-returns unless it can drop
 * both). Every figure here sets an explicit height, and the ranked charts in
 * PR 5 will derive theirs from their row count, so letting Plotly discard it
 * would collapse them to the default. Measuring the container and redrawing
 * keeps both dimensions under this component's control.
 */
export function PlotlyChart({ figure, description, id }: PlotlyChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const node = containerRef.current;
    // Zero width means the chart is inside something hidden — a collapsed
    // `<details>`, or the filtered-out half of the rail once PR 7 lands.
    // Drawing then produces a graph with no usable dimensions; the observer
    // below fires again when it is revealed.
    if (node === null || node.clientWidth === 0) return;

    void Plotly.react(
      node,
      figure.data,
      { ...figure.layout, width: node.clientWidth },
      PLOT_CONFIG,
    );
  }, [figure]);

  useEffect(draw, [draw]);

  // Held in a ref so the observer is attached once, rather than torn down and
  // re-established on every theme change.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  // Two triggers, because they catch different things. `ResizeObserver` is the
  // one that sees a *container* change without the window changing — a
  // `<details>` opening, and the rail filtering that PR 7 adds. The window
  // listener covers the ordinary case and any environment where observer
  // notifications are unreliable. Redrawing twice is harmless: `Plotly.react()`
  // diffs, and an unchanged width is a no-op.
  //
  // NOTE: neither path could be exercised in the embedded browser used to
  // verify the rest of this component — it changes the viewport without
  // dispatching `resize`, and its `ResizeObserver` never fires even for a
  // directly restyled element. A fresh load at any width is correct, and both
  // triggers are standard; live resizing wants a check in a real browser.
  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;

    const redraw = () => drawRef.current();
    window.addEventListener('resize', redraw);

    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', redraw);
    }
    const observer = new ResizeObserver(redraw);
    observer.observe(node);
    return () => {
      window.removeEventListener('resize', redraw);
      observer.disconnect();
    };
  }, []);

  // Purge on unmount only. Folding this into the draw effect would tear the
  // graph down and rebuild it on every figure change, losing the in-place
  // restyle that using `react()` bought.
  useEffect(() => {
    const node = containerRef.current;
    return () => {
      if (node !== null) Plotly.purge(node);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.plot}
      role="img"
      aria-label={description}
      {...(id ? { id } : {})}
    />
  );
}
