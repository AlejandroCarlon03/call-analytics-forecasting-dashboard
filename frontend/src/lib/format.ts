/**
 * Value formatting, ported from `dashboard.py`.
 *
 * The em dash for missing values, the `$` and `s` suffixes and the thousands
 * separators all match the Python renderer, so a reader comparing the two
 * dashboards side by side sees the same numbers written the same way.
 */

import type { Maybe } from '../data/types';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** What the Python renderer prints for a value that is not finite. */
export const EMPTY = '—';

/**
 * Parse an ISO `YYYY-MM-DD` as a *local* date.
 *
 * `new Date('2026-05-18')` is specified to parse as UTC midnight, so anywhere
 * west of Greenwich it formats as the 17th. Every date in this payload is a
 * calendar day with no time zone attached, so the parts are read directly and
 * a local Date is constructed from them.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return null;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** `"2026-05-18"` -> `"18 May 2026"`, matching Python's `%d %b %Y`. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = parseIsoDate(value);
  if (!date) return value;
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `"2026-05-18T14:26:03"` -> `"18 May 2026, 14:26"`, matching `%d %b %Y, %H:%M`. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
}

function isFinite_(value: Maybe): value is number {
  return value !== null && Number.isFinite(value);
}

/** Thousands-separated integer, or the em dash. */
export function formatCount(value: Maybe): string {
  return isFinite_(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : EMPTY;
}

/** Fixed-precision number with thousands separators. */
export function formatNumber(value: Maybe, digits = 1): string {
  return isFinite_(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : EMPTY;
}

/** `1234.5` -> `"$1,234.50"`. */
export function formatCurrency(value: Maybe): string {
  return isFinite_(value)
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : EMPTY;
}

/** `0.8` -> `"80%"`. */
export function formatPercent(value: Maybe, digits = 0): string {
  return isFinite_(value) ? `${(value * 100).toFixed(digits)}%` : EMPTY;
}

/**
 * Format a value in the units of its target — the port of `_fmt()`.
 *
 * Cost carries two decimals and a dollar sign, duration is whole seconds with
 * an `s`, and everything else gets one decimal.
 */
export function formatTargetValue(value: Maybe, target: string): string {
  if (!isFinite_(value)) return EMPTY;
  if (target === 'total_cost') return formatCurrency(value);
  if (target === 'avg_duration_sec') return `${formatCount(Math.round(value))}s`;
  return formatNumber(value, 1);
}

/** `8` -> `"08:00"`. */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
