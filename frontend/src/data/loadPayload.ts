import { EXPECTED_SCHEMA_VERSION, type DashboardPayload } from './types';

/** The element the Python renderer injects the payload into (PR 6). */
const INLINE_ID = 'dashboard-data';
/** Where a served or file-adjacent payload is expected to sit. */
const PAYLOAD_URL = './dashboard_data.json';

export type PayloadSource = 'inline' | 'fetch' | 'fixture';

export interface LoadedPayload {
  payload: DashboardPayload;
  source: PayloadSource;
}

/**
 * Locate and parse the run payload.
 *
 * Three sources, tried in order, so the same build works in every delivery
 * mode this migration passes through:
 *
 * 1. **Inline** — a `<script type="application/json">` block written into the
 *    page by the Python renderer. This is production: one self-contained file
 *    that works offline, with no fetch to fail.
 * 2. **Fetch** — a sibling `dashboard_data.json`. This is the served mode, and
 *    the seam a future API would plug into.
 * 3. **Fixture** — a committed sample payload, **dev only**.
 *
 * The fixture is loaded through a dynamic `import()` inside an
 * `import.meta.env.DEV` branch. Vite replaces that flag with `false` when
 * building for production and drops the branch, so the 269 KB fixture is not
 * carried into a bundle whose whole purpose is to be small enough to mail.
 */
export async function loadPayload(): Promise<LoadedPayload> {
  const inline = document.getElementById(INLINE_ID);
  if (inline?.textContent) {
    return { payload: parse(inline.textContent, 'inline'), source: 'inline' };
  }

  // A missing file is an expected outcome in dev, not an error worth throwing:
  // fall through to the fixture instead.
  //
  // The content-type check is not belt-and-braces. A dev server with SPA
  // fallback — Vite's included — answers a request for a missing
  // dashboard_data.json with index.html and a 200, so `ok` alone would have us
  // parsing HTML as JSON and failing hard instead of falling through.
  const response = await fetch(PAYLOAD_URL).catch(() => null);
  if (response?.ok && isJsonResponse(response)) {
    return { payload: parse(await response.text(), 'fetch'), source: 'fetch' };
  }

  if (import.meta.env.DEV) {
    const fixture = await import('./fixtures/dashboard_data.json');
    return {
      payload: fixture.default as unknown as DashboardPayload,
      source: 'fixture',
    };
  }

  throw new Error(
    `No dashboard payload found. Expected an inline #${INLINE_ID} script or ` +
      `${PAYLOAD_URL} alongside this page.`,
  );
}

/** Whether a response actually carries JSON, rather than an SPA fallback page. */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
}

function parse(text: string, source: PayloadSource): DashboardPayload {
  let payload: DashboardPayload;
  try {
    payload = JSON.parse(text) as DashboardPayload;
  } catch (cause) {
    throw new Error(`The ${source} dashboard payload is not valid JSON.`, { cause });
  }
  warnOnSchemaDrift(payload);
  return payload;
}

/**
 * Warn — but do not fail — when the payload was written by a different
 * serializer version.
 *
 * A hard failure here would turn a minor contract change into a blank page.
 * The page renders whatever it can and says so in the console, on the same
 * principle as the pipeline: a diagnostic problem must not cost you the report.
 */
function warnOnSchemaDrift(payload: DashboardPayload): void {
  if (payload?.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    console.warn(
      `Dashboard payload is schemaVersion ${payload?.schemaVersion}, but this ` +
        `build expects ${EXPECTED_SCHEMA_VERSION}. Some sections may not render.`,
    );
  }
}
