import type { KeyboardEvent } from 'react';
import { DOC_PAGE_IDS, type DocPageId } from '../../lib/docs/types';
import { DOC_PAGES } from '../../content/docs';
import { ExternalLinks } from '../shell/ExternalLinks';
import styles from './DocsNav.module.css';

interface DocsNavProps {
  current: DocPageId;
  onSelect: (page: DocPageId) => void;
  onExit: () => void;
}

/**
 * The documentation sidebar — the docs view's sibling to the model rail
 * (`SideNav`), occupying the same grid slot and built from the same technique
 * for the same reasons. See `SideNav.tsx` for the rationale this file ports:
 * real buttons (not anchors, because selecting a page filters the view in
 * place rather than navigating to a document), arrow keys that move focus
 * without selecting, and an active bar drawn as `background-size` so
 * selection never shifts a label.
 *
 * Unlike `SideNav` there is no synthetic "All" entry — every doc page is a
 * real, permanent entry from `DOC_PAGE_IDS`, so the list here is exactly that
 * list, labelled from content.
 */
export function DocsNav({ current, onSelect, onExit }: DocsNavProps) {
  const active = DOC_PAGES[current];
  const status = `Showing ${active.navLabel ?? active.title}.`;

  return (
    <nav className={styles.docsnav} aria-label="Documentation">
      <div className={styles.title}>Documentation</div>
      <div className={styles.tabs} onKeyDown={moveFocus}>
        {DOC_PAGE_IDS.map((id) => {
          const page = DOC_PAGES[id];
          const label = page.navLabel ?? page.title;
          return (
            <button
              key={id}
              type="button"
              className={styles.tab}
              data-label={label}
              {...(id === current ? { 'aria-current': 'page' as const } : {})}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button type="button" className={styles.exit} onClick={onExit}>
        Back to report
      </button>
      {/* The same section the model rail carries, so the shortcuts do not
          vanish when the reader is in the docs view — the one place they are
          most likely to want the repository. Rendered from the same component
          and the same config; nothing about it is docs-specific. */}
      <ExternalLinks />
      {/* Visually hidden: sighted readers see the change through the tab's own
          weight, surface and bar, but a screen-reader user needs it spoken. */}
      <div aria-live="polite" className={styles.liveRegion}>
        {status}
      </div>
    </nav>
  );
}

/** Same axes as `SideNav`'s rail: a column above 900px, a horizontal strip at
 *  or below it. */
const STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * Arrow / Home / End focus movement across the nav, wrapping at both ends.
 *
 * Ported from `SideNav.tsx`'s `moveFocus` verbatim in approach: the buttons
 * are read off the DOM rather than tracked in a parallel array, and selection
 * is untouched here — Enter/Space on the focused button is what commits,
 * through the native button click.
 */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index === -1) return;

  let next: number;
  if (event.key in STEP) {
    const step = STEP[event.key] as number;
    next = (index + step + buttons.length) % buttons.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = buttons.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  buttons[next]?.focus();
}
