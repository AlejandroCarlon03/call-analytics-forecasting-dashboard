import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  header: ReactNode;
  /** The model rail. Omitted when there is nothing to name a tab after. */
  nav?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Page frame: centred column, header, optional rail, main content, footer.
 *
 * With no rail the report falls back to a single full-width column rather than
 * rendering an empty 248px gutter — the same fallback the Python renderer
 * makes when a run produced no forecasts.
 */
export function AppShell({ header, nav, children, footer }: AppShellProps) {
  return (
    <div className={styles.wrap}>
      {header}
      {nav ? (
        <div className={styles.layout}>
          {nav}
          <main className={styles.main}>{children}</main>
        </div>
      ) : (
        <main className={styles.main}>{children}</main>
      )}
      {footer}
    </div>
  );
}
