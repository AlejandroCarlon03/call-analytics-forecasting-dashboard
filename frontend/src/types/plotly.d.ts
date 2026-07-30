/**
 * Minimal ambient types for `plotly.js-cartesian-dist-min`.
 *
 * The dist bundles ship no type declarations, and `@types/plotly.js` is a very
 * large surface describing the *full* library — most of which this bundle does
 * not contain, so it would typecheck traces that fail at runtime. Declaring the
 * two entry points actually used keeps the dependency list short and keeps the
 * compiler honest about what this bundle can draw.
 *
 * Trace and layout objects are deliberately open (`unknown`-valued index
 * signatures on the known keys we set): Plotly's schema is enormous and the
 * value in typing it here is low, but the *builders* return the declared shapes
 * below, so a section cannot hand a chart something that is not a figure.
 */

declare module 'plotly.js-cartesian-dist-min' {
  import type { PlotFigure } from '../lib/chart/types';

  export function react(
    root: HTMLElement,
    data: PlotFigure['data'],
    layout: PlotFigure['layout'],
    config?: Record<string, unknown>,
  ): Promise<void>;

  export function purge(root: HTMLElement): void;

  /**
   * Render a figure off-screen and resolve a PNG/etc data URL.
   *
   * Takes the figure directly — no DOM node — which is exactly why `png.ts`
   * can generate export images without mounting a chart into the component
   * tree. `figure` is loosened to `{ data; layout }` rather than reusing
   * `PlotFigure` verbatim: `toImage` also accepts `Partial<PlotFigure>`-ish
   * inputs in practice, and the two fields are all this bundle's callers ever
   * pass.
   */
  export function toImage(
    figure: { data: PlotFigure['data']; layout: PlotFigure['layout'] },
    options: {
      format: 'png' | 'jpeg' | 'webp' | 'svg';
      width: number;
      height: number;
      scale?: number;
    },
  ): Promise<string>;
}
