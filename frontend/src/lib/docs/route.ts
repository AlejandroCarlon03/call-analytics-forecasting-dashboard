/**
 * Which view the reader is in, expressed in the same URL fragment as the
 * report's selection.
 *
 * The dashboard is one page with two views — the report and the documentation —
 * and the fragment already carries the report's state. Documentation joins it
 * rather than sitting beside it in component state, for the reason PR 7 put the
 * selection there in the first place: this file is emailed around, and a link
 * to "the page explaining feature importance" has to survive being pasted into
 * a message.
 *
 * ```
 * dashboard.html                                   the report, all models
 * dashboard.html#model=total_cost                  the report, cost only
 * dashboard.html#view=docs                         the docs, About
 * dashboard.html#view=docs&page=models             the docs, Models
 * dashboard.html#view=docs&page=models&model=…     the docs, with the report's
 *                                                    selection still remembered
 * ```
 *
 * ***The two writers must not erase each other, and that is the whole reason
 * this file has a merge function instead of a formatter.*** `formatHash` in
 * `selection.ts` rebuilds the fragment from scratch, so a naive docs writer that
 * did the same would drop `model=`/`horizon=` the moment a reader opened the
 * docs — and they would come back to an unfiltered report. Both writers compose
 * onto the existing fragment through `mergeParams` below.
 *
 * Everything here is pure. `useHashSelection` remains the single subscriber to
 * `window.location`, per §8.
 */

import { DEFAULT_DOC_PAGE, DOC_PAGE_IDS, type DocPageId } from './types';

/** The two things this page can be showing. */
export type DocsView = 'report' | 'docs';

/** Where the reader is. */
export interface DocsRoute {
  view: DocsView;
  /**
   * The open documentation page.
   *
   * Always a valid id, even in the report view, so a component never has to
   * handle "in docs but on no page". In `report` it is simply the page the docs
   * will open on next, which is the default until the reader picks one.
   */
  page: DocPageId;
}

const VIEW_KEY = 'view';
const PAGE_KEY = 'page';

/** The route a page with no fragment shows: the report, as it always has. */
export const DEFAULT_ROUTE: DocsRoute = { view: 'report', page: DEFAULT_DOC_PAGE };

function isDocPageId(value: string | null): value is DocPageId {
  return value !== null && (DOC_PAGE_IDS as readonly string[]).includes(value);
}

/**
 * Read a route out of a location fragment.
 *
 * Degrades rather than throws, exactly as `parseHash` does and for the same
 * reason: a fragment is user-typed input and an emailed link outlives the build
 * that produced it. An unknown view is the report; an unknown or absent page is
 * About. A reader who mistypes a page name gets the documentation's front door,
 * not a blank panel.
 */
export function parseDocsRoute(hash: string): DocsRoute {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  const view: DocsView = params.get(VIEW_KEY) === 'docs' ? 'docs' : 'report';

  const raw = params.get(PAGE_KEY);
  const page: DocPageId = isDocPageId(raw) ? raw : DEFAULT_DOC_PAGE;

  return { view, page };
}

/**
 * Apply a route to an existing fragment, leaving every other key alone.
 *
 * This is the merge described at the top of the file. `model=` and `horizon=`
 * are not this module's to write, and they are not its to delete either — the
 * reader's model selection survives a trip through the documentation and is
 * waiting for them when they come back.
 *
 * Defaults are omitted, so the report has an empty fragment and the docs' front
 * page is `#view=docs` rather than `#view=docs&page=about`. Returns `''` rather
 * than `'#'` when nothing is left, so a caller can clear the fragment.
 */
export function applyDocsRoute(hash: string, route: DocsRoute): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  if (route.view === 'docs') {
    params.set(VIEW_KEY, 'docs');
  } else {
    // Leaving the docs drops the page with the view. A `page=` on a report URL
    // would be a key that names nothing the reader can see, and it would come
    // back with them the next time they opened the docs — pinning them to a
    // page they visited once rather than to the front door.
    params.delete(VIEW_KEY);
    params.delete(PAGE_KEY);
  }

  if (route.view === 'docs' && route.page !== DEFAULT_DOC_PAGE) {
    params.set(PAGE_KEY, route.page);
  } else if (route.view === 'docs') {
    params.delete(PAGE_KEY);
  }

  const query = params.toString();
  return query === '' ? '' : `#${query}`;
}
