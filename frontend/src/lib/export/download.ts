/**
 * The browser download primitive.
 *
 * This dashboard is opened from `file://` as often as it is served, so nothing
 * here can depend on an origin — no `fetch`, no relative navigation, no
 * `window.open` to a blob URL (Safari and some file:// contexts refuse to
 * navigate to one). A synthesised, clicked `<a download>` is the one download
 * mechanism that works identically in both contexts.
 */

import { FILE_PREFIX } from './types';

/**
 * Trigger a browser download of `blob` as `fileName`.
 *
 * The object URL is revoked on a later tick (`setTimeout`, not immediately)
 * because revoking synchronously — before the click has been dispatched to the
 * browser's download machinery — cancels the download in some browsers. A
 * macrotask is enough of a delay for the click to have been acted on.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  // Not attached to the document: `click()` on a detached anchor still fires
  // the browser's download handling in every engine this dashboard targets,
  // and skipping the attach/detach avoids a layout it does not need.
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Two-digit zero pad, for the filename's date/time parts. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `call-forecast-<slug>-<YYYYMMDD-HHmmss>.<ext>`.
 *
 * Local time, deliberately: `data/types.ts` documents that every timestamp in
 * the payload is local with no zone attached, and a file stamped in UTC would
 * read as being from a different hour than the report it was exported from.
 */
export function exportFileName(slug: string, ext: string, at: Date): string {
  const y = at.getFullYear();
  const mo = pad2(at.getMonth() + 1);
  const d = pad2(at.getDate());
  const h = pad2(at.getHours());
  const mi = pad2(at.getMinutes());
  const s = pad2(at.getSeconds());
  return `${FILE_PREFIX}-${slug}-${y}${mo}${d}-${h}${mi}${s}.${ext}`;
}
