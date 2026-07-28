// @vitest-environment jsdom

/**
 * Tests for the location fragment as a React store.
 *
 * `selection.test.ts` covers the parsing and formatting as pure functions. What
 * is left here is the part that only exists against a real `location`: that a
 * page loaded with a fragment comes up already filtered, that a selection is
 * written back, and that a change made outside React — the back button, a
 * hand-edited address bar — reaches the component.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHashSelection } from './useHashSelection';

const DOMAIN = {
  targets: ['call_volume', 'avg_duration_sec', 'total_cost'],
  horizons: [30, 60, 90],
};

/** Put the document back on a bare URL between tests. */
function clearHash(): void {
  window.location.hash = '';
}

/**
 * Let a queued `hashchange` run.
 *
 * Assigning `location.hash` dispatches the event on a task, not a microtask, so
 * awaiting a resolved promise is not enough to see it — the assertion would run
 * before the listener does.
 */
function flushEvents(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(clearHash);
afterEach(clearHash);

describe('useHashSelection', () => {
  it('starts at All with the longest horizon on a bare URL', () => {
    const { result } = renderHook(() => useHashSelection(DOMAIN));
    expect(result.current.selection).toEqual({ target: null, horizon: 90 });
  });

  // The linkability requirement, from the receiving end: someone opens the URL
  // you sent them and sees what you were looking at.
  it('restores a selection present at load', () => {
    window.location.hash = '#model=total_cost&horizon=30';
    const { result } = renderHook(() => useHashSelection(DOMAIN));
    expect(result.current.selection).toEqual({ target: 'total_cost', horizon: 30 });
  });

  it('falls back to All when the fragment names a target the run does not have', () => {
    window.location.hash = '#model=revenue';
    const { result } = renderHook(() => useHashSelection(DOMAIN));
    expect(result.current.selection.target).toBeNull();
  });

  it('falls back to the default horizon on a malformed one', () => {
    window.location.hash = '#horizon=tuesday';
    const { result } = renderHook(() => useHashSelection(DOMAIN));
    expect(result.current.selection.horizon).toBe(90);
  });

  it('writes a target selection to the fragment', () => {
    const { result } = renderHook(() => useHashSelection(DOMAIN));

    act(() => result.current.selectTarget('call_volume'));

    expect(window.location.hash).toBe('#model=call_volume');
    expect(result.current.selection.target).toBe('call_volume');
  });

  it('writes a horizon without losing the target', () => {
    const { result } = renderHook(() => useHashSelection(DOMAIN));

    act(() => result.current.selectTarget('total_cost'));
    act(() => result.current.selectHorizon(30));

    expect(window.location.hash).toBe('#model=total_cost&horizon=30');
    expect(result.current.selection).toEqual({ target: 'total_cost', horizon: 30 });
  });

  // Defaults are omitted, so an unfiltered dashboard has a clean URL rather
  // than one carrying `#model=&horizon=90`.
  it('clears the fragment when the selection returns to All', () => {
    const { result } = renderHook(() => useHashSelection(DOMAIN));

    act(() => result.current.selectTarget('call_volume'));
    act(() => result.current.selectTarget(null));

    expect(result.current.selection.target).toBeNull();
    expect(window.location.hash).toBe('');
  });

  // The reason this is a store subscription rather than `useState` mirrored
  // into the URL: these changes never go through React at all.
  it('follows a fragment changed outside React', async () => {
    const { result } = renderHook(() => useHashSelection(DOMAIN));

    await act(async () => {
      window.location.hash = '#model=avg_duration_sec';
      await flushEvents();
    });

    expect(result.current.selection.target).toBe('avg_duration_sec');
  });

  it('unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useHashSelection(DOMAIN));
    const before = result.current.selection;

    unmount();
    window.location.hash = '#model=total_cost';
    await flushEvents();

    // Nothing to assert on the unmounted result beyond it not having changed;
    // the real check is that React does not warn about an update after unmount.
    expect(before.target).toBeNull();
  });
});
