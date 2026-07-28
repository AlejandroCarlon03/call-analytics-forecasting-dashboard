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
| `npm test` | Vitest, once through |
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

## Components

```
components/primitives/   Card, Section, StatTile + TileGrid, Callout,
                         DataTable, TableView — ports of the `_card`,
                         `_section`, `_stat_tile`, `_callout`, `_table` and
                         `_table_view` helpers in dashboard.py.
components/sections/     One file per dashboard section.
components/shell/        Header, rail, footer, theme toggle, layout.
components/charts/       PlotlyChart wrapper + useChartPalette.
lib/chart/               Palette, base layout, pure figure builders.
```

Sections compose primitives and never write their own table, tile or callout
markup.

## Charts

A chart is two pieces: a **pure builder** in `lib/chart/figures/` that turns
payload rows plus a palette into `{data, layout}`, and `PlotlyChart`, which is
the only place Plotly is touched. Sections call the builder and render the
result; they never call Plotly themselves.

The split is what makes charts testable. The failures that matter here are
silent — a monthly axis that stopped being categorical still renders, it just
quietly drops the partial-month bars — so they are asserted against a plain
object rather than looked at.

Every chart carries an `aria-label` and ships a `TableView` with the same
numbers. That is not optional: a chart without one is unreadable to a screen
reader and un-copyable into a spreadsheet.

### Theming

Colours come from `useChartPalette()`, which reads the resolved CSS custom
properties. Never a literal, and never `useTheme().mode`:

**`mode` changes one render before the palette does.** `ThemeProvider` writes
`data-theme` in an effect, and React flushes child effects before parent
effects, so anything keyed on `mode` reads the *previous* theme's variables and
then never runs again — charts stay in the old palette on a page that has
already switched. `useChartPalette` subscribes to the DOM instead
(`MutationObserver` on `data-theme`, plus the `prefers-color-scheme` query for
viewers following the OS). A theme change produces a new palette, a new figure,
and a `Plotly.react()` diff onto the existing graph.

### Sizing

`PlotlyChart` passes an explicit width and redraws on resize. Plotly's own
resize paths (`config.responsive`, `Plots.resize()`) both work by deleting
`layout.width` **and** `layout.height` and re-autosizing, which would discard
the heights the figures set.

### The Plotly dependency

`plotly.js-cartesian-dist-min` — scatter, bar and heatmap, ~1.1 MB, versus 4.9
MB for the full bundle. It ships no types; `src/types/plotly.d.ts` declares the
two functions used. `@types/plotly.js` is deliberately not installed: it
describes the full library, so it would happily typecheck traces this bundle
cannot draw.

### DataTable

Columns declare a `value` accessor rather than a string key — payload rows are
interfaces, and an interface is not assignable to `Record<string, …>` under
`strict`, so keyed indexing does not typecheck. `deriveColumns()` builds them
from a row's own keys when the column set is open-ended, as it is for
scenarios.

**Integer columns must be declared.** pandas knew `current_agents` was
`int64`, but JSON carries `1` and `1.0` identically, so a table that guessed
would print `0` where the Python dashboard prints `0.00`. Pass the table's
default decimals as `digits`, and give integer columns `digits: 0` — via
`deriveColumns(rows, { integerKeys })` when the columns are derived.

Sorting is opt-in per table. Default order is always the payload's, so an
untouched table matches the Python dashboard row for row. Missing values sort
last in **both** directions: floating a column's gaps to the top of a
descending sort would read as "these are the largest".

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
