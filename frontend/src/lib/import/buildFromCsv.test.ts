import { describe, it, expect } from 'vitest';
import { buildFromCsv } from './buildFromCsv';

function csv(rows: string[]): string {
  return rows.join('\n');
}

describe('buildFromCsv', () => {
  it('fails on an empty file', () => {
    const result = buildFromCsv('', 'x.csv', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/empty/i);
  });

  it('fails on a whitespace-only file', () => {
    const result = buildFromCsv('   \n  \n', 'x.csv', 0);
    expect(result.ok).toBe(false);
  });

  it('fails on a header with no data rows', () => {
    const result = buildFromCsv('Start Timestamp,Call Duration,Combined Cost\n', 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/no data rows/i);
  });

  it('fails on duplicate headers', () => {
    const text = csv(['Cost,Total Cost,Start Timestamp', '$1,$2,2026-01-01 00:00:00']);
    const result = buildFromCsv(text, 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/duplicate/i);
  });

  it('fails when there is no timestamp column', () => {
    const text = csv(['Call Duration,Combined Cost', '1:00,$1']);
    const result = buildFromCsv(text, 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/timestamp/i);
  });

  it('fails when more than 5% of timestamps are unparseable', () => {
    const rows = ['Start Timestamp,Call Duration,Combined Cost'];
    for (let i = 0; i < 10; i += 1) {
      rows.push(i < 3 ? 'garbage,1:00,$1' : `2026-01-0${(i % 9) + 1} 09:00:00,1:00,$1`);
    }
    const result = buildFromCsv(csv(rows), 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/unparseable timestamp/i);
  });

  /*
   * The threshold itself, pinned at the value the Python pipeline uses. The
   * constant read 0.2 from PR 12 until PR 19 under a comment claiming that was
   * the Python default; it is 0.05 (`config.py:69`). A boundary test is what
   * stops that drifting again unnoticed, in either direction.
   */
  it('rejects a file 10% of whose timestamps are unparseable, as the pipeline would', () => {
    const rows = ['Start Timestamp,Call Duration,Combined Cost'];
    for (let i = 0; i < 20; i += 1) {
      rows.push(i < 2 ? 'garbage,1:00,$1' : `2026-01-01 09:00:00,1:00,$1`);
    }
    const result = buildFromCsv(csv(rows), 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The message must name the count, the share and the limit, so a reader
      // can tell "wrong column" from "a couple of bad rows".
      expect(result.errors[0]?.message).toMatch(/2\/20/);
      expect(result.errors[0]?.message).toMatch(/5%/);
    }
  });

  it('accepts a file below the threshold, dropping the bad rows with a warning', () => {
    const rows = ['Start Timestamp,Call Duration,Combined Cost'];
    for (let i = 0; i < 100; i += 1) {
      rows.push(i < 4 ? 'garbage,1:00,$1' : `2026-01-01 09:00:00,1:00,$1`);
    }
    const result = buildFromCsv(csv(rows), 'x.csv', 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.ingestion.rows_read).toBe(100);
      expect(result.payload.ingestion.rows_kept).toBe(96);
      expect(result.payload.ingestion.dropped['unparseable timestamp']).toBe(4);
      expect(result.payload.ingestion.warnings.join(' ')).toMatch(/unparseable timestamp/i);
    }
  });

  /*
   * `ingest.py`'s range-check block (lines 522–540), ported in PR 19. A value
   * failing a range check is nulled, not the row deleted — the call still
   * happened and still counts toward volume, which is what Python does.
   */
  describe('range checks', () => {
    it('nulls a duration over four hours and counts it, keeping the call', () => {
      const text = csv([
        'Start Timestamp,Call Duration,Combined Cost',
        '2026-01-01 09:00:00,5:00:00,$1.00',
        '2026-01-01 10:00:00,0:30,$0.10',
      ]);
      const result = buildFromCsv(text, 'x.csv', 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const day = result.payload.daily[0]!;
        expect(day.call_volume).toBe(2); // the row survives
        expect(day.avg_duration_sec).toBe(30); // the 5-hour value does not
        expect(day.max_duration_sec).toBe(30);
        expect(result.payload.ingestion.dropped['implausible duration']).toBe(1);
      }
    });

    it('nulls a negative duration rather than averaging it in', () => {
      const text = csv([
        'Start Timestamp,Call Duration,Combined Cost',
        '2026-01-01 09:00:00,-60,$0.10',
        '2026-01-01 10:00:00,0:30,$0.10',
      ]);
      const result = buildFromCsv(text, 'x.csv', 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Without the check this averaged to -15s, below every call in the day.
        expect(result.payload.daily[0]!.avg_duration_sec).toBe(30);
        expect(result.payload.ingestion.dropped['negative duration']).toBe(1);
      }
    });

    it('zeroes an implausible cost, matching the fill Python applies after nulling', () => {
      const text = csv([
        'Start Timestamp,Call Duration,Combined Cost',
        '2026-01-01 09:00:00,0:30,$500.00',
        '2026-01-01 10:00:00,0:30,$0.10',
      ]);
      const result = buildFromCsv(text, 'x.csv', 10);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.daily[0]!.total_cost).toBeCloseTo(0.1, 6);
        expect(result.payload.ingestion.dropped['implausible cost']).toBe(1);
      }
    });

    it('leaves an ordinary export with an empty dropped map', () => {
      const text = csv([
        'Start Timestamp,Call Duration,Combined Cost',
        '2026-01-01 09:00:00,1:48,$0.50',
      ]);
      const result = buildFromCsv(text, 'x.csv', 10);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.payload.ingestion.dropped).toEqual({});
    });
  });

  it('builds a payload with RetellAI-ish headers, inserting zero-call days', () => {
    const text = csv([
      'Start Timestamp,Call Duration,Combined Cost',
      '2026-01-01 09:00:00,1:48,$0.50',
      '2026-01-01 10:00:00,0:30,$0.10',
      // 2026-01-02 has no calls
      '2026-01-03 09:00:00,2:00,$1.00',
    ]);
    const result = buildFromCsv(text, 'calls.csv', 200);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.daily).toHaveLength(3);
    const [d1, d2, d3] = result.payload.daily;
    expect(d1?.date).toBe('2026-01-01');
    expect(d1?.call_volume).toBe(2);
    expect(d1?.avg_duration_sec).toBeCloseTo((108 + 30) / 2);
    expect(d1?.total_cost).toBeCloseTo(0.6);

    expect(d2?.date).toBe('2026-01-02');
    expect(d2?.call_volume).toBe(0);
    expect(d2?.total_cost).toBe(0);
    // The average duration of zero calls is undefined, not zero.
    expect(d2?.avg_duration_sec).toBeNull();

    expect(d3?.date).toBe('2026-01-03');
    expect(d3?.call_volume).toBe(1);

    expect(result.payload.schemaVersion).toBe(1);
    expect(result.payload.ingestion.rows_read).toBe(3);
    expect(result.payload.ingestion.rows_kept).toBe(3);
    expect(result.payload.ingestion.active_days).toBe(2);
    expect(result.payload.ingestion.calendar_days).toBe(3);
    expect(result.payload.targets).toEqual([]);
    expect(result.payload.forecasts).toEqual({});
    expect(result.preview.kind).toBe('csv');
  });

  it('emits a full 168-cell hourly grid with Monday = 0', () => {
    const text = csv([
      'Start Timestamp,Call Duration,Combined Cost',
      // 2026-01-05 is a Monday
      '2026-01-05 09:00:00,1:00,$1',
    ]);
    const result = buildFromCsv(text, 'calls.csv', 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.hourly).toHaveLength(168);
    const cell = result.payload.hourly.find((c) => c.weekday === 0 && c.hour === 9);
    expect(cell?.calls).toBe(1);
    expect(cell?.weekdayLabel).toBe('Mon');
    const emptyCell = result.payload.hourly.find((c) => c.weekday === 3 && c.hour === 5);
    expect(emptyCell?.calls).toBe(0);
  });

  it('leaves duration blank rows out of the average but counts them in volume', () => {
    const text = csv([
      'Start Timestamp,Call Duration,Combined Cost',
      '2026-02-01 09:00:00,,$0',
      '2026-02-01 10:00:00,1:00,$1',
    ]);
    const result = buildFromCsv(text, 'calls.csv', 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const day = result.payload.daily[0];
    expect(day?.call_volume).toBe(2);
    expect(day?.avg_duration_sec).toBe(60);
  });

  it('ignores unrecognised columns and reports them', () => {
    const text = csv([
      'Start Timestamp,Call Duration,Combined Cost,Weird Column',
      '2026-01-01 09:00:00,1:00,$1,foo',
    ]);
    const result = buildFromCsv(text, 'calls.csv', 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.ignoredColumns).toContain('Weird Column');
  });
});
