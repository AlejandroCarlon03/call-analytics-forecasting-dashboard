/**
 * A TypeScript port of the column-matching and value-parsing rules in
 * `call_forecast/ingest.py`.
 *
 * Kept as close to the Python source as a straight port allows, so that a
 * change on one side is easy to notice on the other. The one deliberate
 * divergence is duplicate-header handling: Python's `_map_columns` silently
 * takes the first alias match and moves on, but a spreadsheet a person
 * actually exports rarely has two "cost" columns on purpose — for a
 * one-shot browser import (no ingestion report to double-check against) a
 * silent pick is more likely to hide a mistake than reflect one, so this
 * port treats it as an error instead.
 */

// --------------------------------------------------------------------------
//  Header normalisation and column aliases
// --------------------------------------------------------------------------

/** Exact port of `_normalise` in `ingest.py`: lowercase, strip non-alphanumerics. */
export function normaliseHeader(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Verbatim port of `_COLUMN_ALIASES` in `ingest.py`. */
export const COLUMN_ALIASES: Record<string, readonly string[]> = {
  ts: [
    'time', 'timestamp', 'starttime', 'startedat', 'date', 'datetime',
    'calltime', 'startTimestamp', 'starttimestamp',
  ],
  duration_sec: [
    'callduration', 'duration', 'durationsec', 'durationseconds',
    'talktime', 'length',
  ],
  cost: ['cost', 'callcost', 'totalcost', 'combinedcost', 'price', 'amount'],
  disconnection_reason: [
    'disconnectionreason', 'disconnectreason', 'endreason', 'hangupcause', 'reason',
  ],
  call_status: ['callstatus', 'status', 'state'],
  sentiment: ['usersentiment', 'sentiment', 'callersentiment'],
  successful: [
    'callsuccessful', 'successful', 'success', 'issuccessful',
    'calloutcome', 'outcome',
  ],
  latency_ms: [
    'endtoendlatency', 'latency', 'latencyms', 'e2elatency', 'endtoendlatencyms',
  ],
  direction: [
    'direction', 'calldirection', 'calltype', 'type',
    'inboundoutbound', 'phonecalldirection',
  ],
  call_id: ['callid', 'id', 'conversationid', 'sessionid'],
  from_number: ['from', 'fromnumber', 'caller', 'fromphonenumber'],
  to_number: ['to', 'tonumber', 'callee', 'tophonenumber'],
  agent: ['agent', 'agentname', 'agentid'],
};

export interface ColumnMapResult {
  /** canonical -> the source header it was matched to. */
  mapping: Record<string, string>;
  /** Source headers that matched no canonical column. */
  ignored: string[];
  /** Human-readable descriptions of ambiguous headers (two -> one canonical). */
  duplicates: string[];
}

/**
 * Match source headers onto canonical column names.
 *
 * Unlike Python, two source headers that normalise to the same canonical
 * name are reported as a duplicate rather than silently resolved to the
 * first match — see the module docblock.
 */
export function mapColumns(headers: string[]): ColumnMapResult {
  const normToCanonical = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      normToCanonical.set(normaliseHeader(alias), canonical);
    }
  }

  const canonicalToHeaders = new Map<string, string[]>();
  const ignored: string[] = [];

  for (const header of headers) {
    const norm = normaliseHeader(header);
    const canonical = normToCanonical.get(norm);
    if (canonical) {
      const list = canonicalToHeaders.get(canonical) ?? [];
      list.push(header);
      canonicalToHeaders.set(canonical, list);
    } else {
      ignored.push(header);
    }
  }

  const mapping: Record<string, string> = {};
  const duplicates: string[] = [];
  for (const [canonical, hs] of canonicalToHeaders) {
    mapping[canonical] = hs[0]!;
    if (hs.length > 1) {
      duplicates.push(
        `Columns ${hs.map((h) => `"${h}"`).join(', ')} all map to "${canonical}" — remove the duplicates.`,
      );
    }
  }

  return { mapping, ignored, duplicates };
}

// --------------------------------------------------------------------------
//  Value parsers
// --------------------------------------------------------------------------

const BLANK_TOKENS = new Set(['nan', 'none', 'null', '-']);

/**
 * Convert a call-duration cell to seconds. Port of `parse_duration_to_seconds`.
 *
 * >>> parseDurationToSeconds("1:48")
 * 108
 * >>> parseDurationToSeconds("1:02:03")
 * 3723
 * >>> parseDurationToSeconds("")
 * NaN
 */
export function parseDurationToSeconds(val: string | null | undefined): number {
  if (val === null || val === undefined) return NaN;

  const text = String(val).trim();
  if (!text || BLANK_TOKENS.has(text.toLowerCase())) return NaN;

  if (text.includes(':')) {
    const parts = text.split(':');
    const nums = parts.map((p) => Number(p.trim()));
    if (nums.some((x) => Number.isNaN(x))) return NaN;
    if (parts.length === 2) return nums[0]! * 60 + nums[1]!; // MM:SS
    if (parts.length === 3) return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!; // HH:MM:SS
    return NaN;
  }

  const n = Number(text);
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Convert a currency cell to a number. Port of `parse_currency`.
 *
 * Strips everything except digits, `.` and `-`, exactly like the Python
 * regex — so, like Python, a parenthesised negative such as `"(1.50)"`
 * loses its parens (and its sign) rather than becoming `-1.5`.
 *
 * >>> parseCurrency("$0.039")
 * 0.039
 * >>> parseCurrency("1,234.50")
 * 1234.5
 * >>> parseCurrency("")
 * NaN
 */
export function parseCurrency(val: string | null | undefined): number {
  if (val === null || val === undefined) return NaN;

  const text = String(val).trim().replace(/[^0-9.\-]/g, '');
  if (!text || text === '-' || text === '.' || text === '-.') return NaN;

  const n = Number(text);
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Parse a timestamp cell tolerantly, the way `pd.to_datetime(..., format="mixed")`
 * does for the common export shapes: full ISO 8601, `YYYY-MM-DD HH:MM:SS`,
 * `YYYY-MM-DD`, and US `MM/DD/YYYY[ HH:MM:SS]`.
 *
 * Timezone-naive: a string with no offset is read as local wall-clock time
 * (matching pandas, which does not attach a timezone unless one is present
 * in the text), not coerced through UTC.
 */
export function parseTimestamp(val: string | null | undefined): Date | null {
  if (val === null || val === undefined) return null;
  const text = String(val).trim();
  if (!text || BLANK_TOKENS.has(text.toLowerCase())) return null;

  // ISO 8601 with an explicit offset or "Z": safe to hand to Date() as-is.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text) && /^\d{4}-\d{2}-\d{2}[T ]/.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM-DD[ T]HH:MM[:SS[.sss]] — build as local time explicitly.
  let m = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/,
  );
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const date = new Date(
      Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // YYYY-MM-DD
  m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    const date = new Date(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // MM/DD/YYYY[ HH:MM[:SS]]
  m = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (m) {
    const [, mo, d, y, h, mi, s] = m;
    const date = new Date(
      Number(y), Number(mo) - 1, Number(d),
      Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Last resort: let the JS engine try (handles month names, etc.), still local.
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
