/**
 * PNG writer.
 *
 * `Plotly.toImage` renders a figure off-screen and hands back a data URL — no
 * `<div>` to mount, unlike `PlotlyChart`, which is what keeps figure export out
 * of the component tree entirely (§ frozen contract). It takes the same
 * `{ data, layout }` shape the pure builders in `lib/chart/figures/` already
 * return, so this module never builds a trace of its own.
 */

import Plotly from 'plotly.js-cartesian-dist-min';
import { PNG_SCALE, PNG_WIDTH } from './types';
import type { ExportFigure } from './types';
import type { ChartPalette } from '../chart/palette';

const DEFAULT_HEIGHT = 340;

/** Data URL -> Blob, without a network round trip. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:([^;]+);base64/.exec(header ?? '')?.[1] ?? 'image/png';
  const binary = atob(base64 ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Render one `ExportFigure` to a PNG blob.
 *
 * The figure's own `layout.height` is kept as-is — every builder in
 * `lib/chart/figures/` sets an explicit height for exactly this reason (§8,
 * PR 4/5: `PlotlyChart` measures its container and never lets Plotly discard
 * either dimension), so reusing it at the fixed export width is what
 * "preserve the aspect ratio the reader saw" means here: the height a reader
 * would have seen for that chart, at the export's own width.
 *
 * The palette's surface/paper colours are stamped onto the layout so a
 * dark-theme export is not a transparent PNG that reads as black-on-black
 * when dropped into a light document — the on-screen figures are transparent
 * because the card underneath supplies the background, and there is no card
 * here.
 */
export async function toPng(figure: ExportFigure, palette: ChartPalette): Promise<Blob> {
  const height =
    typeof figure.figure.layout['height'] === 'number'
      ? (figure.figure.layout['height'] as number)
      : DEFAULT_HEIGHT;

  const layout = {
    ...figure.figure.layout,
    width: PNG_WIDTH,
    height,
    paper_bgcolor: palette.surface,
    plot_bgcolor: palette.surface,
  };

  const dataUrl = await Plotly.toImage(
    { data: figure.figure.data, layout },
    { format: 'png', width: PNG_WIDTH, height, scale: PNG_SCALE },
  );

  return dataUrlToBlob(dataUrl);
}
