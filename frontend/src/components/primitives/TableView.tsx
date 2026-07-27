import type { ReactNode } from 'react';
import styles from './TableView.module.css';

interface TableViewProps {
  /** Summary text — `_table_view()`'s `label`. */
  label?: string;
  children: ReactNode;
}

/**
 * A table behind a disclosure triangle — the port of `_table_view()`.
 *
 * Every chart in this dashboard ships one of these. It is not a convenience:
 * a chart without a table view is unreadable to a screen reader and
 * un-copyable into a spreadsheet, and shipping one without it is called out in
 * the project's development guidelines.
 *
 * `<details>` is used rather than a React-managed open/closed state so the
 * disclosure keeps working with no JavaScript and is announced correctly
 * without any ARIA of our own.
 */
export function TableView({ label = 'View as table', children }: TableViewProps) {
  return (
    <details className={styles.tableview}>
      <summary className={styles.summary}>{label}</summary>
      {children}
    </details>
  );
}
