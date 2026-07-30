/**
 * Whether the reader arrived somewhere in particular.
 *
 * The dashboard now opens on a landing page rather than on the report, and the
 * one question that gate has to answer is "did this reader ask for a specific
 * view?". A link someone was sent — `#model=total_cost&horizon=30`, or
 * `#view=docs&page=metrics` — names one, and putting a welcome screen in front
 * of it would break the linkability PRs 7 and 14 built the fragment for.
 *
 * ***This module reads the fragment; it never writes one.*** The landing gate
 * is deliberately **not** a fragment key. Two writers already share this
 * fragment (`selection.ts` and `docs/route.ts`, each deleting and rewriting
 * only the keys it owns — see the header of `docs/route.ts` for why), and a
 * third that meant "has the reader entered yet" would put a piece of
 * session-shaped state into a URL that gets emailed around: the recipient of
 * `#entered=1` would skip the welcome screen they had never seen. Entering is
 * a fact about this visit, so it lives in `App`'s own state, and this function
 * is the only input it takes from the URL.
 *
 * Pure, and tested without a DOM.
 */

/**
 * The keys that name a view. `model` and `horizon` belong to `selection.ts`,
 * `view` and `page` to `docs/route.ts`; this list is the union and nothing
 * else reads it. A key added to either module and forgotten here costs a deep
 * link its bypass — the reader sees the landing page once and everything still
 * works — rather than corrupting any state, which is why one list is worth the
 * duplication over exporting private key constants from two modules.
 */
const VIEW_KEYS = ['model', 'horizon', 'view', 'page'] as const;

/**
 * Does this fragment name a view the reader asked for?
 *
 * Degrades the way `parseHash` and `parseDocsRoute` do: a fragment is
 * user-typed input, so anything unrecognised is simply not a deep link. An
 * empty fragment, a bare `#` (which `location.hash` reads back as `''` after a
 * cleared selection — see `useHashSelection`'s `writeHash`) and a fragment
 * carrying only keys this app does not own all read as "no particular view".
 */
export function isDeepLink(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return VIEW_KEYS.some((key) => params.has(key));
}
