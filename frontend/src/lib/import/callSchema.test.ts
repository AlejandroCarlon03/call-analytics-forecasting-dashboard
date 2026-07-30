import { describe, it, expect } from 'vitest';
import {
  normaliseHeader,
  mapColumns,
  parseDurationToSeconds,
  parseCurrency,
  parseTimestamp,
} from './callSchema';

describe('normaliseHeader', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normaliseHeader('Call Duration')).toBe('callduration');
    expect(normaliseHeader('Start Timestamp')).toBe('starttimestamp');
    expect(normaliseHeader('Combined Cost')).toBe('combinedcost');
    expect(normaliseHeader('  From_Number  ')).toBe('fromnumber');
  });
});

describe('mapColumns', () => {
  it('maps RetellAI-ish headers onto canonical columns', () => {
    const { mapping, ignored } = mapColumns([
      'Start Timestamp',
      'Call Duration',
      'Combined Cost',
      'Some Random Column',
    ]);
    expect(mapping.ts).toBe('Start Timestamp');
    expect(mapping.duration_sec).toBe('Call Duration');
    expect(mapping.cost).toBe('Combined Cost');
    expect(ignored).toEqual(['Some Random Column']);
  });

  it('flags two headers mapping to the same canonical as duplicates', () => {
    const { duplicates } = mapColumns(['Cost', 'Total Cost']);
    expect(duplicates.length).toBe(1);
    expect(duplicates[0]).toMatch(/cost/i);
  });

  it('has no duplicates for a clean header set', () => {
    const { duplicates } = mapColumns(['timestamp', 'duration', 'cost']);
    expect(duplicates).toEqual([]);
  });
});

describe('parseDurationToSeconds', () => {
  it('parses MM:SS', () => {
    expect(parseDurationToSeconds('1:48')).toBe(108);
  });
  it('parses HH:MM:SS', () => {
    expect(parseDurationToSeconds('1:02:03')).toBe(3723);
  });
  it('parses plain seconds', () => {
    expect(parseDurationToSeconds('95')).toBe(95);
  });
  it('returns NaN for blank', () => {
    expect(Number.isNaN(parseDurationToSeconds(''))).toBe(true);
    expect(Number.isNaN(parseDurationToSeconds(undefined))).toBe(true);
    expect(Number.isNaN(parseDurationToSeconds(null))).toBe(true);
  });
  it('returns NaN for garbage', () => {
    expect(Number.isNaN(parseDurationToSeconds('abc'))).toBe(true);
    expect(Number.isNaN(parseDurationToSeconds('1:2:3:4'))).toBe(true);
  });
});

describe('parseCurrency', () => {
  it('strips a dollar sign', () => {
    expect(parseCurrency('$0.039')).toBeCloseTo(0.039);
  });
  it('strips thousands commas', () => {
    expect(parseCurrency('1,234.50')).toBeCloseTo(1234.5);
  });
  it('returns NaN for blank', () => {
    expect(Number.isNaN(parseCurrency(''))).toBe(true);
    expect(Number.isNaN(parseCurrency(undefined))).toBe(true);
  });
});

describe('parseTimestamp', () => {
  it('parses YYYY-MM-DD HH:MM:SS as local time', () => {
    const d = parseTimestamp('2026-03-15 14:30:00');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });

  it('parses a date-only string', () => {
    const d = parseTimestamp('2026-03-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it('parses MM/DD/YYYY', () => {
    const d = parseTimestamp('3/15/2026');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });

  it('returns null for blank or garbage', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('not a date at all !!')).toBeNull();
  });
});
