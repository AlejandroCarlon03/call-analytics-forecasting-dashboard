import styles from './SideNav.module.css';

export interface NavTab {
  /** Anchor id of the card this tab points at. */
  id: string;
  label: string;
}

interface SideNavProps {
  tabs: NavTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/**
 * The left-hand model rail.
 *
 * **Presentational**, exactly as in the Python dashboard it replaces:
 * selecting a tab marks it current and scrolls its card into view. It does not
 * yet filter the page down to one model — that behaviour is PR 7, and it is
 * the first thing this migration actually buys.
 *
 * The rail is part of the shell rather than a later addition because the
 * two-column grid, and the 900px collapse that keeps the page from scrolling
 * sideways, are defined by it.
 */
export function SideNav({ tabs, activeId, onSelect }: SideNavProps) {
  if (tabs.length === 0) return null;

  return (
    <nav className={styles.sidenav} aria-label="Models">
      <div className={styles.title}>Models</div>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={styles.tab}
            {...(tab.id === activeId ? { 'aria-current': 'true' as const } : {})}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
