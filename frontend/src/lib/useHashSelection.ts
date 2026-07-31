import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { formatHash, parseHash, type Selection, type SelectionDomain } from './selection';
import { applyDocsRoute, parseDocsRoute, type DocsRoute } from './docs/route';
import { isDeepLink } from './entry';

/**
 * The location fragment, as a React store.
 *
 * `useSyncExternalStore` over the DOM rather than `useState` mirrored into the
 * URL, for the same reason `useChartPalette` subscribes to `data-theme` instead
 * of reading `useTheme().mode`: the browser owns this value. Back, forward, a
 * hand-edited fragment and a reload all change it without React's involvement,
 * and a mirrored copy is a second source of truth that has to be kept in step
 * with each of those paths separately.
 *
 * There is exactly one subscriber — `App`. Sections receive the parsed
 * selection as props and never read `location` themselves.
 */

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // `hashchange` covers a fragment typed into the address bar and the back and
  // forward buttons; `popstate` covers a history entry this page did not
  // create. Both are cheap and neither fires for our own writes reliably
  // enough to rely on, hence the listener set as well.
  window.addEventListener('hashchange', onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('hashchange', onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
  };
}

/** A string primitive, so React's identity check needs no memoised cache. */
function getSnapshot(): string {
  return window.location.hash;
}

/**
 * Write a fragment.
 *
 * **Assignment to `location.hash`, deliberately not `history.pushState`.**
 * A `file://` document has an opaque origin, and `pushState` with a URL throws
 * a `SecurityError` there — which is precisely how this dashboard is opened,
 * as a single self-contained page mailed to someone. Assigning the fragment
 * works from `file://`, `http://` and a dev server alike.
 *
 * The cost is a bare `#` left in the address bar when the selection is cleared;
 * `location.hash` reads back as `''` either way, so nothing downstream can tell
 * the difference.
 */
function writeHash(hash: string): void {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
  // Assignment fires `hashchange` asynchronously, and only when the value
  // actually changed. Notifying directly keeps the render in the same tick as
  // the click, so the rail never paints a frame with the old selection.
  listeners.forEach((listener) => listener());
}

export interface HashSelection {
  selection: Selection;
  /** Select a target, or `null` for "All". */
  selectTarget: (target: string | null) => void;
  /** Trim every forecast card to this many days. */
  selectHorizon: (horizon: number) => void;
  /**
   * Which view the same fragment is showing, and which doc page.
   *
   * Returned from here rather than from a second hook so the page keeps
   * **one** `useSyncExternalStore` subscriber over `window.location` — the
   * property §8 states and the reason no component reads `location` itself. A
   * second hook would be a second subscription to the same value, and the two
   * would render from it independently.
   */
  route: DocsRoute;
  /** Open the documentation at a page, or return to the report. */
  navigate: (route: DocsRoute) => void;
  /**
   * Clear the fragment entirely — no target, no horizon, no view.
   *
   * This is what "return home" needs: the landing page shows on `!entered &&
   * !deepLink`, and a lingering `#model=…`/`#view=docs` would keep `deepLink`
   * true and hold the reader in the report. `App` pairs this with resetting its
   * own `entered` flag. It lives here, not in `App`, because this hook owns
   * `window.location` — no component reads or writes it directly (§8).
   */
  clear: () => void;
  /**
   * Whether the fragment names a view the reader asked for.
   *
   * Read from the same snapshot as everything else here, for the same reason
   * `route` is: a second subscriber to `window.location` would be a second
   * component rendering from the browser's value independently. `App` uses it
   * to let a shared link past the landing page — see `lib/entry.ts`.
   */
  deepLink: boolean;
}

export function useHashSelection(domain: SelectionDomain): HashSelection {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The domain comes from the payload, which never changes after load, but
  // destructuring keeps the dependency on the two arrays rather than on an
  // object literal a caller may rebuild each render.
  const { targets, horizons } = domain;
  const stableDomain = useMemo<SelectionDomain>(() => ({ targets, horizons }), [targets, horizons]);

  const selection = useMemo(() => parseHash(hash, stableDomain), [hash, stableDomain]);

  // `hash` is passed as the base so the docs' `view=`/`page=` keys survive a
  // rail click, and vice versa below.
  const write = useCallback(
    (next: Selection) => writeHash(formatHash(next, stableDomain, hash)),
    [stableDomain, hash],
  );

  const selectTarget = useCallback(
    (target: string | null) => write({ ...selection, target }),
    [selection, write],
  );

  const selectHorizon = useCallback(
    (horizon: number) => write({ ...selection, horizon }),
    [selection, write],
  );

  const route = useMemo(() => parseDocsRoute(hash), [hash]);

  const navigate = useCallback(
    (next: DocsRoute) => writeHash(applyDocsRoute(hash, next)),
    [hash],
  );

  const deepLink = useMemo(() => isDeepLink(hash), [hash]);

  const clear = useCallback(() => writeHash(''), []);

  return { selection, selectTarget, selectHorizon, route, navigate, deepLink, clear };
}
