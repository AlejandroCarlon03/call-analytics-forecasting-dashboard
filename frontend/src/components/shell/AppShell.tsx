import type { MouseEvent, ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  header: ReactNode;
  /** The model rail. Omitted when there is nothing to name a tab after. */
  nav?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/** Skip-link target, and the id the link's `href` names. */
const MAIN_ID = 'report';

/**
 * Move focus into the report without letting the browser navigate to `#report`.
 *
 * ***The default action would clear the reader's model selection.*** The
 * fragment is not decoration on this page — it *is* the selection, read by the
 * single `useHashSelection` subscriber in `App`. Following `#report` replaces
 * `#model=total_cost` with a fragment that parses to no target, so a reader who
 * had filtered to one model and then skipped past the rail would arrive in an
 * unfiltered report. This is the same collision PR 7 avoided by choosing
 * `key=value` over bare anchors, arriving from the other direction: there a
 * bare anchor would have been *scrolled to*, here one would be *written*.
 *
 * `href` stays `#report` regardless, because that is what tells assistive
 * technology and the status bar where the link goes. `focus()` on the
 * `tabIndex={-1}` main does both jobs the default would have — it moves focus
 * and scrolls the element into view, smoothly, per `html { scroll-behavior }`.
 */
function skipToReport(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.getElementById(MAIN_ID);
  // No target means nothing to preventDefault *for*; leave the browser to it.
  if (main === null) return;

  event.preventDefault();
  main.focus();
}

/**
 * Page frame: centred column, header, optional rail, main content, footer.
 *
 * With no rail the report falls back to a single full-width column rather than
 * rendering an empty 248px gutter — the same fallback the Python renderer
 * makes when a run produced no forecasts.
 *
 * **The skip link is the rail's cost paid back.** A keyboard reader arriving
 * on the page meets the theme toggle and then every model tab before the first
 * card, on every load; the link is the standard way out and is the first thing
 * in the tab order. It is not hidden from screen readers — it is *visually*
 * hidden until focused, which is why it uses the clip pattern rather than
 * `display: none`.
 *
 * `main` carries `tabIndex={-1}` because that is what makes the jump actually
 * move focus. Without it the browser scrolls to the fragment but leaves focus
 * on the link, so the next Tab goes back to the rail — the reader lands in the
 * report visually and nowhere at all for the keyboard. `-1` keeps it out of
 * the tab sequence; only the link puts focus there.
 */
export function AppShell({ header, nav, children, footer }: AppShellProps) {
  const main = (
    <main id={MAIN_ID} className={styles.main} tabIndex={-1}>
      {children}
    </main>
  );

  return (
    <div className={styles.wrap}>
      <a className={styles.skipLink} href={`#${MAIN_ID}`} onClick={skipToReport}>
        Skip to report
      </a>
      {header}
      {nav ? (
        <div className={styles.layout}>
          {nav}
          {main}
        </div>
      ) : (
        main
      )}
      {footer}
    </div>
  );
}
