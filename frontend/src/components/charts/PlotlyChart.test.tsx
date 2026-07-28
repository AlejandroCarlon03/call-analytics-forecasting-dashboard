// @vitest-environment jsdom

/**
 * Tests for `PlotlyChart`'s size-driven redraw logic.
 *
 * The component measures its own container rather than trusting Plotly's
 * `responsive` autosize (see the docblock on the component for why), which
 * means the DOM stands in for what would otherwise be pure-function
 * assertions. Two things about jsdom get in the way of that:
 *
 * - `HTMLElement.prototype.clientWidth` is hard-wired to `0` — jsdom has no
 *   layout engine, so nothing this component measures ever looks "real"
 *   without a stub. `stubClientWidth` below replaces the getter for the
 *   whole prototype (fine here: nothing in this file cares about any other
 *   element's width) and every test restores the original afterward.
 * - `ResizeObserver` does not exist at all. `PlotlyChart` already guards
 *   `typeof ResizeObserver === 'undefined'` for exactly this environment, so
 *   `FakeResizeObserver` below is installed on `globalThis` to take that
 *   branch, and its `trigger()` stands in for the browser delivering a
 *   notification — nothing here can reproduce the actual timing of one.
 *
 * `Plotly` itself is mocked outright: these tests are about *when* and *with
 * what arguments* this component calls `react`/`purge`, never about what a
 * real chart renders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PlotlyChart } from './PlotlyChart';
import type { PlotFigure } from '../../lib/chart/types';

vi.mock('plotly.js-cartesian-dist-min', () => ({
  default: { react: vi.fn(), purge: vi.fn() },
}));

import Plotly from 'plotly.js-cartesian-dist-min';

const mockReact = vi.mocked(Plotly.react);
const mockPurge = vi.mocked(Plotly.purge);

function makeFigure(marker: string, layoutOverrides: PlotFigure['layout'] = {}): PlotFigure {
  return {
    data: [{ type: 'scatter', mode: 'lines', x: [1, 2, 3], y: [1, 2, 3], name: marker }],
    layout: { height: 340, ...layoutOverrides },
  };
}

/** Mutated per test to move a mounted chart between hidden and revealed. */
let currentWidth = 0;

function setWidth(width: number): void {
  currentWidth = width;
}

const nativeClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

/**
 * Stands in for a real `ResizeObserver`. Tests reach into
 * `FakeResizeObserver.instances` to get at the one `PlotlyChart` created —
 * there is only ever one, since the component observes once on mount and
 * never re-subscribes — and call `.trigger()` to simulate a notification.
 */
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];

  private readonly callback: ResizeObserverCallback;
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}

  trigger(): void {
    this.callback([], this);
  }
}

beforeEach(() => {
  currentWidth = 0;
  FakeResizeObserver.instances = [];
  mockReact.mockClear();
  mockPurge.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => currentWidth,
  });
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (nativeClientWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', nativeClientWidth);
  }
});

describe('PlotlyChart', () => {
  it('draws once at a real width, passing that width to Plotly.react', () => {
    setWidth(640);
    render(<PlotlyChart figure={makeFigure('a')} description="d" />);

    expect(mockReact).toHaveBeenCalledTimes(1);
    const [, data, layout] = mockReact.mock.calls[0]!;
    expect(data[0]!['name']).toBe('a');
    expect(layout['width']).toBe(640);
  });

  it('does not draw a chart mounted at zero width', () => {
    setWidth(0);
    render(<PlotlyChart figure={makeFigure('a')} description="d" />);

    // The graph would have no usable dimensions; drawing it anyway is worse
    // than leaving it undrawn until the observer below reports a real size.
    expect(mockReact).not.toHaveBeenCalled();
  });

  it('draws once revealed: the observer firing at a real width triggers Plotly.react', () => {
    setWidth(0);
    render(<PlotlyChart figure={makeFigure('a')} description="d" />);
    expect(mockReact).not.toHaveBeenCalled();

    setWidth(720);
    FakeResizeObserver.instances[0]!.trigger();

    expect(mockReact).toHaveBeenCalledTimes(1);
    const [, , layout] = mockReact.mock.calls[0]!;
    expect(layout['width']).toBe(720);
  });

  it('draws the new figure, not a stale one, when the figure changed while hidden', () => {
    setWidth(0);
    const { rerender } = render(<PlotlyChart figure={makeFigure('first')} description="d" />);

    // The figure changes while the container is still zero-width — `draw`
    // must skip this too, but remember it owes a redraw once revealed.
    rerender(<PlotlyChart figure={makeFigure('second')} description="d" />);
    expect(mockReact).not.toHaveBeenCalled();

    setWidth(900);
    FakeResizeObserver.instances[0]!.trigger();

    expect(mockReact).toHaveBeenCalledTimes(1);
    const [, data, layout] = mockReact.mock.calls[0]!;
    expect(data[0]!['name']).toBe('second');
    expect(layout['width']).toBe(900);
  });

  it('keeps the explicit height from the figure layout', () => {
    // This is the regression that would collapse the ranked charts: they
    // derive `height` from their row count, and `Plots.resize()`-style
    // autosizing discards it. `PlotlyChart` must merge width in without
    // touching height.
    setWidth(500);
    render(<PlotlyChart figure={makeFigure('a', { height: 727 })} description="d" />);

    const [, , layout] = mockReact.mock.calls[0]!;
    expect(layout['height']).toBe(727);
    expect(layout['width']).toBe(500);
  });

  it('purges the right node and disconnects the observer on unmount', () => {
    setWidth(500);
    // Spies go on before mount so the `addEventListener` call made by the
    // resize/observer effect is captured — that is how the assertion below
    // confirms the *same* handler reference is the one removed, not merely
    // that something called 'resize' was removed.
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { container, unmount } = render(<PlotlyChart figure={makeFigure('a')} description="d" />);
    const node = container.querySelector('[role="img"]');
    expect(node).not.toBeNull();

    const observer = FakeResizeObserver.instances[0]!;
    const resizeCall = addSpy.mock.calls.find(([type]) => type === 'resize');
    expect(resizeCall).toBeDefined();
    const resizeHandler = resizeCall![1];

    unmount();

    expect(mockPurge).toHaveBeenCalledTimes(1);
    expect(mockPurge).toHaveBeenCalledWith(node);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('resize', resizeHandler);
  });

  it('puts the description and id on the container', () => {
    setWidth(500);
    const { container, rerender } = render(
      <PlotlyChart figure={makeFigure('a')} description="Calls forecast" id="chart-call-volume" />,
    );

    const node = container.querySelector('[role="img"]');
    expect(node?.getAttribute('aria-label')).toBe('Calls forecast');
    expect(node?.getAttribute('id')).toBe('chart-call-volume');

    // No `id` prop means no `id` attribute at all, not an empty one — this is
    // what `exactOptionalPropertyTypes` plus the `{...(id ? { id } : {})}`
    // spread in the component is guarding against.
    rerender(<PlotlyChart figure={makeFigure('a')} description="Calls forecast" />);
    const rerendered = container.querySelector('[role="img"]');
    expect(rerendered?.hasAttribute('id')).toBe(false);
  });
});
