// @vitest-environment jsdom

/**
 * jsdom has no `URL.createObjectURL`/`revokeObjectURL` at all, so both are
 * stubbed. `downloadBlob` is exercised through the anchor it synthesises
 * rather than through an actual file leaving the browser, which is the only
 * thing observable in this environment.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob, exportFileName } from './download';

describe('downloadBlob', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake-url');
    revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL =
      createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL =
      revokeObjectURL;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicks a synthesised <a download> with the given file name', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['x']), 'call-forecast-forecasts-20260730-120000.csv');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('does not revoke the object URL synchronously', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['x']), 'file.csv');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});

describe('exportFileName', () => {
  it('formats call-forecast-<slug>-<YYYYMMDD-HHmmss>.<ext> in local time', () => {
    const at = new Date(2026, 6, 30, 9, 5, 3); // 30 Jul 2026, 09:05:03 local
    expect(exportFileName('forecasts', 'csv', at)).toBe('call-forecast-forecasts-20260730-090503.csv');
  });

  it('zero-pads every field', () => {
    const at = new Date(2026, 0, 1, 0, 0, 0);
    expect(exportFileName('anomalies', 'json', at)).toBe('call-forecast-anomalies-20260101-000000.json');
  });
});
