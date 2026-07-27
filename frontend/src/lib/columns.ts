/**
 * Deriving table columns from payload rows.
 *
 * Several payload tables are open-ended — `scenarios.rows` carries whatever
 * columns `scenarios.py` produced, and adding one there should surface here
 * without a frontend change, exactly as it did in the Python dashboard, which
 * simply iterated `frame.columns`.
 *
 * The one thing that cannot be derived is integer-ness. pandas knew
 * `current_agents` was `int64` and printed it as `1`; by the time the value
 * reaches JSON it is indistinguishable from a float that happens to be whole,
 * and `1.0` and `1` both arrive as `1`. Callers therefore name their integer
 * columns explicitly rather than have this module guess and print `0` where
 * the Python dashboard printed `0.00`.
 */

import type { CellValue, Column } from '../components/primitives/DataTable';

interface DeriveOptions {
  /** Columns that were integer-typed in pandas; rendered with no decimals. */
  integerKeys?: readonly string[];
  /** Restrict and order the output. Names absent from the rows are skipped. */
  only?: readonly string[];
}

/**
 * Build columns from the keys of `rows`, in first-appearance order.
 *
 * Header text is the raw payload key — `volume_uplift_pct`, not "Volume Uplift
 * Pct". These identifiers also name columns in the CSV deliverables, so a
 * reader cross-referencing the two should see the same word in both.
 */
export function deriveColumns<Row extends object>(
  rows: readonly Row[],
  options: DeriveOptions = {},
): Array<Column<Row>> {
  const { integerKeys = [], only } = options;

  const seen: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.includes(key)) seen.push(key);
    }
  }

  const keys = only ? only.filter((key) => seen.includes(key)) : seen;
  const integers = new Set(integerKeys);

  return keys.map((key) => ({
    key,
    header: key,
    // The single cast in the table path. Payload rows are plain JSON objects
    // whose declared interfaces do not carry an index signature, so a keyed
    // read has to be asserted somewhere; confining it here keeps every call
    // site fully checked.
    value: (row: Row) => (row as Record<string, unknown>)[key] as CellValue,
    ...(integers.has(key) ? { digits: 0 } : {}),
  }));
}
