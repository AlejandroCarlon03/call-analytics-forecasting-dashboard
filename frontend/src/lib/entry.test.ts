import { describe, expect, it } from 'vitest';
import { isDeepLink } from './entry';

/**
 * The landing gate's one input.
 *
 * What matters here is the *bypass*: a link someone was sent must reach the
 * view it names, and a plain open must not.
 */
describe('isDeepLink', () => {
  it('is false for a fragment that names nothing', () => {
    expect(isDeepLink('')).toBe(false);
    expect(isDeepLink('#')).toBe(false);
  });

  it('is true for a selection link', () => {
    expect(isDeepLink('#model=total_cost')).toBe(true);
    expect(isDeepLink('#horizon=30')).toBe(true);
    expect(isDeepLink('#model=total_cost&horizon=30')).toBe(true);
  });

  it('is true for a documentation link', () => {
    expect(isDeepLink('#view=docs')).toBe(true);
    expect(isDeepLink('#view=docs&page=metrics')).toBe(true);
  });

  it('is true for a fragment carrying both writers’ keys', () => {
    expect(isDeepLink('#model=total_cost&horizon=30&view=docs&page=models')).toBe(true);
  });

  it('is false for a fragment this app does not own', () => {
    // `#report` is the skip link's href, and a bare anchor from anywhere else
    // must not be mistaken for a view request.
    expect(isDeepLink('#report')).toBe(false);
    expect(isDeepLink('#something=else')).toBe(false);
  });

  it('accepts a fragment with or without its leading hash', () => {
    expect(isDeepLink('model=total_cost')).toBe(true);
    expect(isDeepLink('#model=total_cost')).toBe(true);
  });
});
