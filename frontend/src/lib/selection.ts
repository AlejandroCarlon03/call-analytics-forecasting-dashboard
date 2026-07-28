/**
 * Dashboard selection, expressed as a URL fragment.
 *
 * The rail filters the report to one target and the forecast cards trim
 * themselves to one horizon. Both live in the URL rather than in component
 * state, which is what makes a filtered view linkable — the whole point of a
 * report that gets emailed around as a single file.
 *
 * Everything here is pure. Reading and writing `window.location` is
 * `useHashSelection`'s job, and it is the only caller.
 *
 * **The fragment is `key=value`, not a bare anchor.** `#model=call_volume`
 * rather than `#model-call_volume`, because the forecast cards already carry
 * `id="model-<target>"` — a bare anchor would collide with them and make the
 * browser scroll the card into view on every selection, including the ones
 * that filter it off the page.
 */

/** What the reader has chosen. */
export interface Selection {
  /** The selected target key, or `null` for "All". */
  target: string | null;
  /**
   * How far into the forecast to show, in days.
   *
   * `Number.POSITIVE_INFINITY` when a run configured no horizons at all —
   * "unfiltered", which is the only honest reading of an empty horizon list.
   */
  horizon: number;
}

/** The values a selection is allowed to take, read from the payload. */
export interface SelectionDomain {
  /** `payload.targets` — configured order, restricted to what produced output. */
  targets: readonly string[];
  /** `payload.config.forecast.horizons` — 30/60/90 as shipped. */
  horizons: readonly number[];
}

const MODEL_KEY = 'model';
const HORIZON_KEY = 'horizon';

/**
 * The horizon a fresh load shows: the longest configured one.
 *
 * Chosen so the unfiltered dashboard renders exactly what it rendered before
 * this PR — the selector starts at "everything" and only ever removes.
 */
export function defaultHorizon(horizons: readonly number[]): number {
  return horizons.length > 0 ? Math.max(...horizons) : Number.POSITIVE_INFINITY;
}

/** The selection a page with no fragment shows. */
export function defaultSelection(domain: SelectionDomain): Selection {
  return { target: null, horizon: defaultHorizon(domain.horizons) };
}

/**
 * Read a selection out of a location fragment.
 *
 * Anything unrecognised falls back rather than throwing: a hash is user-typed
 * input and an emailed link outlives the run that produced it, so a target that
 * no longer exists in the payload has to degrade to "All" instead of rendering
 * an empty report. Same for a horizon the run was not configured for.
 */
export function parseHash(hash: string, domain: SelectionDomain): Selection {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  const model = params.get(MODEL_KEY);
  const target = model !== null && domain.targets.includes(model) ? model : null;

  const raw = params.get(HORIZON_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const horizon = domain.horizons.includes(parsed) ? parsed : defaultHorizon(domain.horizons);

  return { target, horizon };
}

/**
 * Render a selection as a location fragment, `#` included.
 *
 * Defaults are omitted, so the unfiltered dashboard has an empty fragment and
 * the URL only carries what the reader actually chose. Returns `''` — not
 * `'#'` — when nothing is selected, so a caller can clear the fragment.
 */
export function formatHash(selection: Selection, domain: SelectionDomain): string {
  const params = new URLSearchParams();

  if (selection.target !== null && domain.targets.includes(selection.target)) {
    params.set(MODEL_KEY, selection.target);
  }
  if (
    domain.horizons.includes(selection.horizon) &&
    selection.horizon !== defaultHorizon(domain.horizons)
  ) {
    params.set(HORIZON_KEY, String(selection.horizon));
  }

  const query = params.toString();
  return query === '' ? '' : `#${query}`;
}

/**
 * Whether a target's cards belong on the page under this selection.
 *
 * The one predicate every target-scoped section filters through, so "All shows
 * everything" is asserted once rather than four times.
 */
export function isTargetVisible(target: string, selectedTarget: string | null): boolean {
  return selectedTarget === null || selectedTarget === target;
}
