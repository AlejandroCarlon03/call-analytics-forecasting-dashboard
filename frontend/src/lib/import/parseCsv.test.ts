import { describe, it, expect } from 'vitest';
import { parseCsv } from './parseCsv';

describe('parseCsv', () => {
  it('parses a simple comma-separated file', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas inside', () => {
    expect(parseCsv('a,b\n"1,2",3')).toEqual([
      ['a', 'b'],
      ['1,2', '3'],
    ]);
  });

  it('handles escaped double quotes inside a quoted field', () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual([['a'], ['she said "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles LF line endings', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('ignores a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const bom = '﻿';
    expect(parseCsv(`${bom}a,b\n1,2`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('throws a descriptive error on an unterminated quote', () => {
    expect(() => parseCsv('a,b\n"1,2')).toThrow(/unterminated/i);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('handles a quoted field containing a CRLF', () => {
    expect(parseCsv('a\n"line1\r\nline2"')).toEqual([['a'], ['line1\r\nline2']]);
  });
});
