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

  it('fails when more than 20% of timestamps are unparseable', () => {
    const rows = ['Start Timestamp,Call Duration,Combined Cost'];
    for (let i = 0; i < 10; i += 1) {
      rows.push(i < 3 ? 'garbage,1:00,$1' : `2026-01-0${(i % 9) + 1} 09:00:00,1:00,$1`);
    }
    const result = buildFromCsv(csv(rows), 'x.csv', 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/unparseable timestamp/i);
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
