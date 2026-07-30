import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import type { ExportTable } from './types';

describe('toCsv', () => {
  it('prepends a UTF-8 BOM', () => {
    const table: ExportTable = { columns: ['a'], rows: [{ a: 1 }] };
    expect(toCsv(table).startsWith('﻿')).toBe(true);
  });

  it('writes the header row verbatim from columns, in order', () => {
    const table: ExportTable = { columns: ['target', 'date', 'yhat'], rows: [] };
    const text = toCsv(table);
    expect(text).toContain('target,date,yhat\r\n');
  });

  it('renders null as an empty field, not the string "null"', () => {
    const table: ExportTable = { columns: ['a', 'b'], rows: [{ a: null, b: 2 }] };
    const lines = toCsv(table).split('\r\n');
    expect(lines[1]).toBe(',2');
  });

  it('quotes fields containing a comma, quote, CR or LF, escaping quotes', () => {
    const table: ExportTable = {
      columns: ['a'],
      rows: [{ a: 'has,comma' }, { a: 'has"quote' }, { a: 'has\nnewline' }],
    };
    const lines = toCsv(table).split('\r\n');
    expect(lines[1]).toBe('"has,comma"');
    expect(lines[2]).toBe('"has""quote"');
    expect(lines[3]).toBe('"has\nnewline"');
  });

  it('renders booleans as true/false', () => {
    const table: ExportTable = { columns: ['flag'], rows: [{ flag: true }, { flag: false }] };
    const lines = toCsv(table).split('\r\n');
    expect(lines[1]).toBe('true');
    expect(lines[2]).toBe('false');
  });

  it('preserves numeric precision byte-for-byte — no toFixed rounding', () => {
    const value = 0.1 + 0.2; // 0.30000000000000004
    const table: ExportTable = { columns: ['n'], rows: [{ n: value }] };
    const lines = toCsv(table).split('\r\n');
    expect(lines[1]).toBe(String(value));
    expect(lines[1]).toBe('0.30000000000000004');
  });

  it('uses CRLF line terminators throughout, including a trailing one', () => {
    const table: ExportTable = { columns: ['a'], rows: [{ a: 1 }, { a: 2 }] };
    const text = toCsv(table);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n')).toEqual(['﻿a', '1', '2', '']);
  });
});
