import type { KeyboardEvent } from 'react';
import { ExternalLinks } from './ExternalLinks';
import styles from './SideNav.module.css';

export interface NavTab {
  /** Target key this tab selects, or `null` for the "All" tab. */
  target: string | null;
  label: string;
}

interface SideNavProps {
  tabs: NavTab[];
  selected: string | null;
  onSelect: (target: string | null) => void;
}

/** The tab `SideNav` prepends to whatever `App` hands it — see below. */
const ALL_TAB: NavTab = { target: null, label: 'All' };

/**
 * The left-hand model rail — a real filter, not a scrollspy.
 *
 * Selecting a tab no longer just marks it current and scrolls its card into
 * view: it hands `target` to `onSelect`, `App` writes it into the URL
 * fragment, and every target-scoped section on the page trims itself down to
 * it. `SideNav` is a controlled component over `selected` and never reads
 * the selection back — the same separation `useHashSelection`'s docblock
 * describes for the rest of the tree.
 *
 * **`SideNav` prepends its own "All" tab rather than requiring `App` to
 * include one in `tabs`.** "All" never appears in `payload.targets` — it is
 * not a target the run produced, it is the state of filtering by none of
 * them, which is a fact about having a filter control at all, not about the
 * payload. Putting it here means "All" exists exactly once, and every future
 * caller of `SideNav` gets it for free instead of having to remember to
 * synthesize the same entry `App` currently would.
 *
 * Real `<button type="button">` elements, not anchors: a button fires its
 * click handler on both Space and Enter, and this rail filters the report in
 * place rather than taking the reader to a document, which is the contract
 * an anchor makes.
 *
 * The rail is part of the shell rather than a later addition because the
 * two-column grid, and the 900px collapse that keeps the page from scrolling
 * sideways, are defined by it.
 *
 * **Arrow keys move focus; they do not select.** `moveFocus` below adds
 * Up/Down/Left/Right/Home/End on top of the tab sequence rather than in place
 * of it — every tab keeps its natural `tabindex`, so Tab still walks the rail
 * one button at a time. That is deliberate and it is not the ARIA tabs
 * pattern: this is a `nav` of buttons, not a tablist, and a roving tabindex
 * would make Tab skip the whole rail in a single press while also implying
 * (through the tablist role it belongs to) that arrowing onto a tab selects
 * it. PR 7 rejected a radiogroup here for the same reason. Focus and
 * selection stay separate, and Enter or Space is what commits.
 */
export function SideNav({ tabs, selected, onSelect }: SideNavProps) {
  if (tabs.length === 0) return null;

  const allTabs = [ALL_TAB, ...tabs];
  const active = allTabs.find((tab) => tab.target === selected) ?? ALL_TAB;
  const status = selected === null ? 'Showing all models.' : `Showing ${active.label} only.`;

  return (
    <nav className={styles.sidenav} aria-label="Models">
      <div className={styles.title}>Models</div>
      <div className={styles.tabs} onKeyDown={moveFocus}>
        {allTabs.map((tab) => (
          <button
            // `target` (not array index) so React keeps the same DOM node —
            // and the same focus — across a selection change; re-keying on
            // index would let the browser silently reassign focus to
            // whichever tab lands in that slot next.
            key={tab.target ?? '__all__'}
            type="button"
            className={styles.tab}
            // Read back by the stylesheet's `::after` sizer, which reserves the
            // width the label takes once selection bolds it. Presentational,
            // and hidden from the accessibility tree there.
            data-label={tab.label}
            {...(tab.target === selected ? { 'aria-current': 'page' as const } : {})}
            onClick={() => onSelect(tab.target)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Outside `.tabs`, which is what keeps `moveFocus` — and every
          `[aria-current]` rule in the stylesheet — scoped to the model tabs
          alone. Its own `<nav>` with its own label, because these are not
          models and not pages of this report. */}
      <ExternalLinks />
      {/* Visually hidden: sighted readers see the change through the tab's
          own weight, surface and left bar, but a screen-reader user gets
          nothing from those and needs the change spoken instead. */}
      <div aria-live="polite" className={styles.liveRegion}>
        {status}
      </div>
    </nav>
  );
}

/** Keys that step focus, and by how much. Both axes, because the rail is a
 *  column above 900px and a horizontal strip below it — a reader arrowing
 *  along the direction they can see the tabs in should not have to know which
 *  layout they are looking at. */
const STEP: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * Arrow / Home / End focus movement across the rail, wrapping at both ends.
 *
 * The buttons are read off the DOM rather than tracked in a ref array. They
 * are the container's only element children and their DOM order *is* the
 * order focus should follow, so the list already exists; a parallel array
 * would be a second copy to keep in step with `tabs` on every render, and the
 * first time the two disagreed the rail would move focus to the wrong tab.
 *
 * Selection is untouched here — see the component docblock.
 */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  // A key pressed while focus is somewhere else in the container is not ours
  // to interpret.
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

  // Only once a key is known to be handled: an unclaimed key must keep its
  // default, and Home/End in particular still have to scroll the page when
  // the rail is not what the reader is driving.
  event.preventDefault();
  buttons[next]?.focus();
}
