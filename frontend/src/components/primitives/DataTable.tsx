import { useMemo, useState } from 'react';
import { EMPTY, formatNumber } from '../../lib/format';
import styles from './DataTable.module.css';

/** Anything a payload row can hold in a cell. */
export type CellValue = number | string | boolean | null | undefined;

export interface Column<Row> {
  /** Stable identity for sort state and React keys. */
  key: string;
  /** Header text. The Python tables print the raw column name; so do we. */
  header: string;
  /**
   * Read the raw value.
   *
   * An accessor rather than a string key lookup: payload rows are declared as
   * interfaces, and an interface is not assignable to `Record<string, …>` under
   * `strict`. The accessor keeps the whole table typed with no casting at the
   * call site.
   */
  value: (row: Row) => CellValue;
  /** Decimal places for numeric cells. Falls back to the table's `digits`. */
  digits?: number;
  /** Full override of the rendered text. Receives the raw value. */
  format?: (value: CellValue, row: Row) => string;
  /**
   * Force alignment. By default a cell is right-aligned when its value is a
   * number or a boolean, matching `_table()`'s `td.num` class.
   */
  align?: 'left' | 'right';
}

interface DataTableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  /**
   * Describes the table for screen readers. Rendered visually hidden — the
   * surrounding section heading already names it on screen.
   */
  caption: string;
  /** Row cap, with a note beneath when it bites. Matches `_table(max_rows=…)`. */
  maxRows?: number;
  /** Default decimal places for numeric cells — `_table(numeric_format=…)`. */
  digits?: number;
  /** Adds sortable column headers. Default order is always the payload's. */
  sortable?: boolean;
  emptyMessage?: string;
}

type SortDirection = 'ascending' | 'descending';
interface SortState {
  key: string;
  direction: SortDirection;
}

/**
 * Render one cell exactly as `_table()` does.
 *
 * The rules are worth stating because JSON has already destroyed some of the
 * information Python had: pandas knew a column was `int64`, but `0.0` and `0`
 * both arrive here as `0`. Integer columns therefore declare `digits: 0`
 * rather than being detected — sniffing would print `0` where the Python
 * dashboard prints `0.00`.
 */
function renderCell(value: CellValue, digits: number): string {
  if (value === null || value === undefined) return EMPTY;
  // Python's `_table` tests `isinstance(value, int)`, and `bool` subclasses
  // `int`, so `True` formats as `1` and right-aligns. Reproduced, not improved.
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return formatNumber(value, digits);
  return value;
}

function isNumericCell(value: CellValue): boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

function isMissing(value: CellValue): boolean {
  return value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value));
}

/** Order two present values. Missing ones are handled before this is reached. */
function compareCells(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en-US', { numeric: true });
}

/**
 * An accessible data table — the port of `_table()` in `dashboard.py`.
 *
 * Sorting is opt-in and never applies on first render, so an unsorted table
 * shows the payload's own order and matches the Python dashboard row for row.
 * The sort is stable: rows comparing equal keep their payload order rather
 * than being shuffled by the engine's sort.
 */
export function DataTable<Row>({
  columns,
  rows,
  caption,
  maxRows = 400,
  digits = 3,
  sortable = false,
  emptyMessage = 'No rows.',
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState | null>(null);

  const ordered = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return rows;
    const sign = sort.direction === 'ascending' ? 1 : -1;
    // Decorate with the original index so equal rows keep payload order.
    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const a = column.value(left.row);
        const b = column.value(right.row);

        // Missing values sort last in *both* directions, so the direction sign
        // is deliberately not applied here. Ordering them like any other value
        // would float a column's gaps to the top of a descending sort, reading
        // as "these are the largest" — the opposite of what null means.
        const aMissing = isMissing(a);
        const bMissing = isMissing(b);
        if (aMissing || bMissing) {
          if (aMissing && bMissing) return left.index - right.index;
          return aMissing ? 1 : -1;
        }

        const ranking = compareCells(a, b) * sign;
        return ranking !== 0 ? ranking : left.index - right.index;
      })
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

  if (rows.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  const view = ordered.slice(0, maxRows);

  const toggle = (key: string) => {
    setSort((current) =>
      current?.key === key && current.direction === 'ascending'
        ? { key, direction: 'descending' }
        : { key, direction: 'ascending' },
    );
  };

  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <caption className={styles.caption}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    {...(sortable
                      ? { 'aria-sort': active && sort ? sort.direction : ('none' as const) }
                      : {})}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => toggle(column.key)}
                      >
                        {column.header}
                        <span className={styles.sortMark} aria-hidden="true">
                          {active && sort ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.map((row, rowIndex) => (
              // Payload rows carry no id, and the array is immutable for the
              // life of the page, so the index is a sound key here.
              <tr key={rowIndex}>
                {columns.map((column) => {
                  const raw = column.value(row);
                  const numeric = (column.align ?? (isNumericCell(raw) ? 'right' : 'left')) === 'right';
                  const text = column.format
                    ? column.format(raw, row)
                    : renderCell(raw, column.digits ?? digits);
                  return (
                    <td key={column.key} className={numeric ? styles.num : undefined}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > maxRows ? (
        <p className={styles.empty}>
          Showing first {maxRows} of {rows.length} rows.
        </p>
      ) : null}
    </>
  );
}
