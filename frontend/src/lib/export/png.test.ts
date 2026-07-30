// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('plotly.js-cartesian-dist-min', () => ({
  default: { react: vi.fn(), purge: vi.fn(), toImage: vi.fn() },
}));

import Plotly from 'plotly.js-cartesian-dist-min';
import { toPng } from './png';
import { TEST_PALETTE } from '../chart/testPalette';
import { PNG_SCALE, PNG_WIDTH } from './types';
import type { ExportFigure } from './types';

const mockToImage = vi.mocked(Plotly.toImage);

// A 1x1 transparent PNG data URL — small, real base64, decodes cleanly.
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function figureWithHeight(height: number | undefined): ExportFigure {
  return {
    slug: 'call_volume',
    label: 'Call volume',
    figure: {
      data: [{ type: 'scatter', x: [1], y: [2] }],
      layout: height === undefined ? {} : { height },
    },
  };
}

describe('toPng', () => {
  beforeEach(() => {
    mockToImage.mockClear();
  });


  it('calls Plotly.toImage with format png, the fixed export width and scale', async () => {
    mockToImage.mockResolvedValue(TINY_PNG_DATA_URL);
    await toPng(figureWithHeight(360), TEST_PALETTE);

    expect(mockToImage).toHaveBeenCalledTimes(1);
    const [, options] = mockToImage.mock.calls[0]!;
    expect(options).toMatchObject({ format: 'png', width: PNG_WIDTH, scale: PNG_SCALE, height: 360 });
  });

  it('keeps the figure’s own layout height rather than inventing one', async () => {
    mockToImage.mockResolvedValue(TINY_PNG_DATA_URL);
    await toPng(figureWithHeight(220), TEST_PALETTE);
    const [figureArg] = mockToImage.mock.calls[0]!;
    expect(figureArg.layout['height']).toBe(220);
  });

  it('falls back to a default height when the layout has none', async () => {
    mockToImage.mockResolvedValue(TINY_PNG_DATA_URL);
    await toPng(figureWithHeight(undefined), TEST_PALETTE);
    const [, options] = mockToImage.mock.calls[0]!;
    expect(options.height).toBeGreaterThan(0);
  });

  it('stamps the palette surface color onto paper/plot background', async () => {
    mockToImage.mockResolvedValue(TINY_PNG_DATA_URL);
    await toPng(figureWithHeight(300), TEST_PALETTE);
    const [figureArg] = mockToImage.mock.calls[0]!;
    expect(figureArg.layout['paper_bgcolor']).toBe(TEST_PALETTE.surface);
    expect(figureArg.layout['plot_bgcolor']).toBe(TEST_PALETTE.surface);
  });

  it('resolves a Blob of type image/png', async () => {
    mockToImage.mockResolvedValue(TINY_PNG_DATA_URL);
    const blob = await toPng(figureWithHeight(300), TEST_PALETTE);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });
});
