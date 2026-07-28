/**
 * Tests for the URL-fragment selection contract.
 *
 * The behaviour worth pinning is the degradation. A fragment is user-typed
 * input, and a link to a filtered view outlives the run that produced it — a
 * target that has since dropped out of the payload has to fall back to "All"
 * rather than render a report with nothing in it.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultHorizon,
  defaultSelection,
  formatHash,
  isTargetVisible,
  parseHash,
} from './selection';

const DOMAIN = {
  targets: ['call_volume', 'avg_duration_sec', 'total_cost'],
  horizons: [30, 60, 90],
};

describe('defaultHorizon', () => {
  it('is the longest configured horizon', () => {
    expect(defaultHorizon([30, 60, 90])).toBe(90);
  });

  it('is unbounded when a run configured none', () => {
    expect(defaultHorizon([])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('parseHash', () => {
  it('reads All from an empty fragment', () => {
    expect(parseHash('', DOMAIN)).toEqual({ target: null, horizon: 90 });
  });

  it('reads All from a bare hash', () => {
    expect(parseHash('#', DOMAIN)).toEqual({ target: null, horizon: 90 });
  });

  it('reads a target', () => {
    expect(parseHash('#model=total_cost', DOMAIN).target).toBe('total_cost');
  });

  it('reads a target and a horizon together', () => {
    expect(parseHash('#model=call_volume&horizon=30', DOMAIN)).toEqual({
      target: 'call_volume',
      horizon: 30,
    });
  });

  it('tolerates a missing leading hash', () => {
    expect(parseHash('model=call_volume', DOMAIN).target).toBe('call_volume');
  });

  it('is order-independent', () => {
    expect(parseHash('#horizon=60&model=total_cost', DOMAIN)).toEqual({
      target: 'total_cost',
      horizon: 60,
    });
  });

  // The whole point of the fallback: an emailed link outlives its run.
  it('falls back to All for a target the payload does not carry', () => {
    expect(parseHash('#model=revenue', DOMAIN).target).toBeNull();
  });

  it('falls back to All for an empty target', () => {
    expect(parseHash('#model=', DOMAIN).target).toBeNull();
  });

  it('falls back to the default horizon for one that was not configured', () => {
    expect(parseHash('#horizon=45', DOMAIN).horizon).toBe(90);
  });

  it('falls back to the default horizon for a non-numeric one', () => {
    expect(parseHash('#horizon=soon', DOMAIN).horizon).toBe(90);
  });

  it('ignores keys it does not know', () => {
    expect(parseHash('#model=total_cost&theme=dark', DOMAIN)).toEqual({
      target: 'total_cost',
      horizon: 90,
    });
  });

  // A card anchor is `model-<target>`; the fragment is `model=<target>`. If the
  // two ever converge, selecting a model would scroll the page as a side effect.
  it('does not read a card anchor as a selection', () => {
    expect(parseHash('#model-call_volume', DOMAIN).target).toBeNull();
  });

  it('survives a payload with no targets at all', () => {
    expect(parseHash('#model=call_volume', { targets: [], horizons: [] })).toEqual({
      target: null,
      horizon: Number.POSITIVE_INFINITY,
    });
  });
});

describe('formatHash', () => {
  it('is empty for the default selection', () => {
    expect(formatHash(defaultSelection(DOMAIN), DOMAIN)).toBe('');
  });

  it('carries a target', () => {
    expect(formatHash({ target: 'total_cost', horizon: 90 }, DOMAIN)).toBe('#model=total_cost');
  });

  it('omits the horizon at its default', () => {
    expect(formatHash({ target: null, horizon: 90 }, DOMAIN)).toBe('');
  });

  it('carries a non-default horizon', () => {
    expect(formatHash({ target: null, horizon: 30 }, DOMAIN)).toBe('#horizon=30');
  });

  it('carries both', () => {
    expect(formatHash({ target: 'call_volume', horizon: 60 }, DOMAIN)).toBe(
      '#model=call_volume&horizon=60',
    );
  });

  it('drops a target the payload does not carry', () => {
    expect(formatHash({ target: 'revenue', horizon: 90 }, DOMAIN)).toBe('');
  });

  it('drops a horizon that was not configured', () => {
    expect(formatHash({ target: null, horizon: 45 }, DOMAIN)).toBe('');
  });
});

describe('round trip', () => {
  it('parses back everything it formats', () => {
    for (const target of [null, ...DOMAIN.targets]) {
      for (const horizon of DOMAIN.horizons) {
        const selection = { target, horizon };
        expect(parseHash(formatHash(selection, DOMAIN), DOMAIN)).toEqual(selection);
      }
    }
  });
});

describe('isTargetVisible', () => {
  it('shows every target under All', () => {
    expect(DOMAIN.targets.every((target) => isTargetVisible(target, null))).toBe(true);
  });

  it('shows only the selected target', () => {
    expect(isTargetVisible('call_volume', 'call_volume')).toBe(true);
    expect(isTargetVisible('total_cost', 'call_volume')).toBe(false);
  });
});
