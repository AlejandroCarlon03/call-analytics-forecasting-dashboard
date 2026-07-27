# call_forecast — React dashboard

The frontend that replaces the Python-rendered `reports/dashboard.html`.
See `SESSION_CONTEXT.md` at the repository root for the full migration plan.

**Node is a development dependency only.** End users still `pip install` and run
`python -m call_forecast run`; the built bundle is committed as a template so no
Node toolchain is needed to produce a dashboard (PR 6).

## Getting started

```bash
cd frontend
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` only |
| `npm run preview` | Serve the built `dist/` |

## Where the data comes from

`src/data/loadPayload.ts` tries three sources in order:

1. an inline `<script id="dashboard-data" type="application/json">` block — how
   the production single-file dashboard ships (PR 6);
2. `fetch('./dashboard_data.json')` — a served or file-adjacent payload;
3. `src/data/fixtures/dashboard_data.json` — **dev only**, behind an
   `import.meta.env.DEV` guard so Vite drops it from production builds.

The payload contract is defined by `call_forecast/serialize.py` and mirrored in
`src/data/types.ts`. When the Python side bumps `SCHEMA_VERSION`, update both.

### Regenerating the fixture

The fixture is a real payload from the **synthetic** sample export — never the
business data in `data/`, since this file is committed.

```bash
python -m call_forecast run --root /tmp/fixture --data-dir examples
cp /tmp/fixture/outputs/dashboard_data.json frontend/src/data/fixtures/
```

## Theming

`src/theme/tokens.css` is **generated** from `call_forecast.dashboard.THEME` by
`scripts/gen_tokens.py`. Do not edit it by hand — `tests/test_tokens.py` fails
if it drifts from the Python palette.

```bash
python scripts/gen_tokens.py            # regenerate
python scripts/gen_tokens.py --check    # verify it is current
```

The palette is audited for contrast in both modes. If you change a hue,
re-validate it and re-run the generator.

Light is the base in `:root`; a `prefers-color-scheme: dark` media query applies
dark when the viewer has not pinned light; `:root[data-theme="dark"]` overrides
both. Because the OS preference is handled by CSS alone, the correct palette is
applied before React mounts rather than flashing and correcting.

`useTheme()` exposes `mode` (what is rendered) and `preference` (`'light'`,
`'dark'` or `'system'`). An explicit choice persists in `localStorage` under
`call-forecast:theme`; `'system'` removes the key and resumes following the OS.

## Conventions

- **camelCase for structural keys, snake_case preserved for data identifiers.**
  `modelLabel` is structure; `call_volume` and `yhat_lower` are domain
  identifiers that also appear in the CSVs and `config.yaml`.
- **Every payload number can be `null`.** The serializer maps NaN and Infinity
  to `null` rather than emitting invalid JSON. This is common, not exotic.
- **CSS Modules** beside each component; only genuinely global rules go in
  `styles/global.css`. Colours come from custom properties, never literals.
- **No horizontal page overflow.** Wide content scrolls inside its own
  container. The `minmax(0, 1fr)` content column in `AppShell.module.css` is
  load-bearing — a bare `1fr` lets a wide child force the page sideways.
