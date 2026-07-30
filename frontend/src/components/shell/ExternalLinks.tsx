import { EXTERNAL_LINKS } from '../../config/externalLinks';
import styles from './ExternalLinks.module.css';

/**
 * The sidebar's "External Resources" section — shortcuts off the page, not
 * navigation within it.
 *
 * ***These are `<a>` elements, and that is the whole safety argument.*** The
 * rails around this component are made of `<button>`s because selecting a
 * model or a doc page filters the view in place; these three go to another
 * document on another origin, which is the contract an anchor makes and a
 * button does not. Making them anchors means:
 *
 * - `target="_blank"` opens the new tab natively, with no click handler that
 *   could be reached by a keyboard path the handler forgot;
 * - Enter activates them and the browser's own "open in new tab" affordances
 *   work, so keyboard access is the platform's rather than ours to maintain;
 * - they carry no `aria-current` and no selected state exists to apply, so
 *   they can never render as the current dashboard page;
 * - `SideNav`/`DocsNav`'s `moveFocus` reads `querySelectorAll('button')`, so
 *   arrow-key movement across the rail does not see them at all. Adding this
 *   section could not change that behaviour even by accident.
 *
 * Nothing here reads or writes `location`. An `href` to an absolute `https:`
 * URL replaces the document rather than editing the fragment, so the model
 * selection, the horizon and the docs route are untouched by construction —
 * the collision `AppShell`'s skip link had to defend against does not exist
 * for a link that leaves the page.
 *
 * `rel="noopener noreferrer"`: `noopener` denies the opened page a handle on
 * `window.opener`, and `noreferrer` keeps this dashboard's `file://` or
 * intranet URL out of a third party's referrer log. Both matter more than
 * usual here — the shipped artefact is a single HTML file mailed around.
 *
 * The links come from `config/externalLinks.tsx` and this component knows
 * nothing about any individual one; repointing a URL never touches this file.
 */
export function ExternalLinks() {
  if (EXTERNAL_LINKS.length === 0) return null;

  return (
    <nav className={styles.external} aria-label="External resources">
      <div className={styles.title}>External Resources</div>
      <ul className={styles.list}>
        {EXTERNAL_LINKS.map((link) => (
          <li key={link.id}>
            <a
              className={styles.link}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              // Native tooltip on hover, no JS and no third state to manage.
              title={link.description}
            >
              <span className={styles.icon}>{link.icon}</span>
              <span className={styles.label}>{link.label}</span>
              {/* The external-link indicator. `aria-hidden` because the
                  destination is already spoken by the accessible name below;
                  this glyph is the sighted reader's version of the same fact. */}
              <svg
                className={styles.indicator}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable={false}
              >
                <path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5" />
              </svg>
              {/* Visually hidden tail on the accessible name. Three links that
                  all leave the page read identically without it, and "opens in
                  a new tab" is the part a screen-reader user cannot see coming
                  from the icon. */}
              <span className={styles.srOnly}>{` — ${link.description}`}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
