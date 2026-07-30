import { describe, expect, it } from 'vitest';
import { applyDocsRoute, DEFAULT_ROUTE, parseDocsRoute } from './route';
import { DEFAULT_DOC_PAGE, DOC_PAGE_IDS } from './types';
import { formatHash, parseHash, type SelectionDomain } from '../selection';

/**
 * The routing contract, and — the part that actually matters — the guarantee
 * that the two writers sharing this fragment do not erase each other.
 */

const DOMAIN: SelectionDomain = {
  targets: ['call_volume', 'avg_duration_sec', 'total_cost'],
  horizons: [30, 60, 90],
};

describe('parseDocsRoute', () => {
  it('reads the report from an empty fragment', () => {
    expect(parseDocsRoute('')).toEqual(DEFAULT_ROUTE);
  });

  it('reads the docs, defaulting to the front page', () => {
    expect(parseDocsRoute('#view=docs')).toEqual({ view: 'docs', page: DEFAULT_DOC_PAGE });
  });

  it('reads a named page', () => {
    expect(parseDocsRoute('#view=docs&page=models')).toEqual({ view: 'docs', page: 'models' });
  });

  it('reads every declared page id', () => {
    for (const id of DOC_PAGE_IDS) {
      expect(parseDocsRoute(`#view=docs&page=${id}`).page).toBe(id);
    }
  });

  it('tolerates a leading hash being absent', () => {
    expect(parseDocsRoute('view=docs&page=metrics')).toEqual({ view: 'docs', page: 'metrics' });
  });

  // A fragment is user-typed input and an emailed link outlives the build that
  // produced it, so both of these degrade rather than throwing or blanking.
  it('degrades an unknown view to the report', () => {
    expect(parseDocsRoute('#view=wat').view).toBe('report');
  });

  it('degrades an unknown page to the front page', () => {
    expect(parseDocsRoute('#view=docs&page=nope').page).toBe(DEFAULT_DOC_PAGE);
  });

  it('ignores the report selection keys entirely', () => {
    expect(parseDocsRoute('#model=total_cost&horizon=30')).toEqual(DEFAULT_ROUTE);
  });
});

describe('applyDocsRoute', () => {
  it('omits defaults, so the report has an empty fragment', () => {
    expect(applyDocsRoute('#view=docs&page=models', { view: 'report', page: 'models' })).toBe('');
  });

  it('omits the page on the docs front door', () => {
    expect(applyDocsRoute('', { view: 'docs', page: DEFAULT_DOC_PAGE })).toBe('#view=docs');
  });

  it('writes a named page', () => {
    expect(applyDocsRoute('', { view: 'docs', page: 'metrics' })).toBe('#view=docs&page=metrics');
  });

  it('drops the page when leaving the docs', () => {
    expect(applyDocsRoute('#view=docs&page=metrics', { view: 'report', page: 'metrics' })).toBe('');
  });

  it('round-trips every page', () => {
    for (const id of DOC_PAGE_IDS) {
      const hash = applyDocsRoute('', { view: 'docs', page: id });
      expect(parseDocsRoute(hash)).toEqual({ view: 'docs', page: id });
    }
  });
});

/**
 * ***The regression this PR could most easily have shipped.***
 *
 * `formatHash` rebuilds the fragment from scratch and `applyDocsRoute` writes
 * into the same one. Without the merge, opening the docs would silently clear
 * the reader's model filter, and clicking a rail tab would eject them from the
 * docs. Neither would throw; both would just quietly lose state.
 */
describe('the two writers share one fragment', () => {
  it('entering the docs preserves the report selection', () => {
    const hash = formatHash({ target: 'total_cost', horizon: 30 }, DOMAIN);
    const next = applyDocsRoute(hash, { view: 'docs', page: 'models' });

    expect(parseDocsRoute(next)).toEqual({ view: 'docs', page: 'models' });
    expect(parseHash(next, DOMAIN)).toEqual({ target: 'total_cost', horizon: 30 });
  });

  it('leaving the docs returns the reader to the selection they left', () => {
    const inDocs = '#model=total_cost&horizon=30&view=docs&page=models';
    const next = applyDocsRoute(inDocs, { view: 'report', page: 'models' });

    expect(parseDocsRoute(next).view).toBe('report');
    expect(parseHash(next, DOMAIN)).toEqual({ target: 'total_cost', horizon: 30 });
  });

  it('writing a selection preserves the docs route', () => {
    const inDocs = '#view=docs&page=metrics';
    const next = formatHash({ target: 'call_volume', horizon: 60 }, DOMAIN, inDocs);

    expect(parseDocsRoute(next)).toEqual({ view: 'docs', page: 'metrics' });
    expect(parseHash(next, DOMAIN)).toEqual({ target: 'call_volume', horizon: 60 });
  });

  it('rewrites its own keys rather than merging them', () => {
    // A stale `model=` in the base must lose to the value being written, or
    // clearing a filter would be impossible.
    const next = formatHash({ target: null, horizon: 90 }, DOMAIN, '#model=total_cost&view=docs');

    expect(parseHash(next, DOMAIN).target).toBeNull();
    expect(parseDocsRoute(next).view).toBe('docs');
  });

  it('omitting the base keeps the original behaviour exactly', () => {
    const selection = { target: 'total_cost', horizon: 30 };
    expect(formatHash(selection, DOMAIN)).toBe(formatHash(selection, DOMAIN, ''));
  });
});
