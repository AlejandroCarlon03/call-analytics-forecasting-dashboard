# SESSION_CONTEXT

Technical handoff for `call_forecast`. Read alongside `README.md` (user-facing)
and `config.yaml` (every tunable, with defaults written out).

---

## 1. Project Overview

**What it does.** Ingests RetellAI-style call-analytics exports (CSV/XLSX),
cleans and validates them, aggregates to a daily grain, engineers features,
cross-validates six forecasting models, auto-selects the best, and emits
30/60/90-day forecasts with calibrated intervals — plus anomaly alerts, SHAP
explanations, Erlang-C staffing scenarios, CSV deliverables and a
self-contained HTML dashboard.

**Business purpose.** Diamond Kitchen and Bath runs an AI phone agent on
RetellAI. This answers: how many calls next month, what will they cost, when do
we need another person on the phones, and did anything unusual happen
yesterday. It complements the existing descriptive tools on the Desktop
(`RetellAnalyzer.py`, `RetellDashboard_Web.py`), which report on the past.

**Status.** Feature-complete against the original spec and working end to end.
**Not yet production-useful for point forecasts** — see §4.

**Active work.** Migrating the HTML dashboard to React. Branch
`feature/analytics-charts`; migration PRs 1–4 are done — payload contract,
frontend scaffold, primitives + non-chart sections, and the Plotly base plus
the three forecast charts. See §8.

**Test suite health.** Two test files currently crash *during collection* on
this machine for reasons unrelated to any recent change — see §4.

---

## 2. Current Architecture

**Stack.** Python 3.10+ · pandas · numpy · scikit-learn · XGBoost · statsmodels
· Prophet *(optional)* · SHAP *(optional)* · Plotly · holidays · PyYAML ·
pytest. No database, no service, no network calls. Pure batch CLI.

```
call-forecast/
├── call_forecast/          # the package (~7,300 lines)
│   ├── config.py           # typed dataclass config; YAML loader
│   ├── ingest.py           # parse, validate, range-check, de-duplicate
│   ├── features.py         # daily aggregation + feature engineering
│   ├── models/
│   │   ├── base.py         # Forecaster ABC + TabularForecaster (recursion, intervals)
│   │   ├── baseline.py     # seasonal naive
│   │   ├── tabular.py      # ridge / random forest / XGBoost
│   │   ├── prophet_model.py
│   │   ├── sarima.py
│   │   └── registry.py     # name -> class; the extension point
│   ├── evaluation.py       # metrics, walk-forward CV, model selection
│   ├── forecast.py         # refit winner, horizons, intervals, monthly rollup
│   ├── anomalies.py        # robust z-scores + 4 standing alert rules
│   ├── explain.py          # SHAP / permutation / native importance
│   ├── scenarios.py        # Erlang B/C/A queueing + what-if
│   ├── dashboard.py        # self-contained HTML report (being replaced, §8)
│   ├── serialize.py        # run -> JSON payload; the frontend's contract
│   ├── pipeline.py         # orchestration + retrain detection + CSV writing
│   └── cli.py              # argparse entry point
├── frontend/               # React dashboard (§8) - Node is dev-only
│   ├── src/
│   │   ├── data/           # payload types, loader, committed fixture
│   │   ├── theme/          # tokens.css (generated), provider, useTheme
│   │   ├── components/shell/       # AppShell, header, rail, footer, toggle
│   │   ├── components/primitives/  # Card, Section, StatTile, Callout,
│   │   │                           #   DataTable, TableView
│   │   ├── components/sections/    # data quality, at a glance, forecasts,
│   │   │                           #   anomalies, scenarios
│   │   ├── components/charts/      # PlotlyChart wrapper + useChartPalette
│   │   ├── lib/chart/      # palette, baseLayout, pure figure builders
│   │   ├── lib/format.ts   # port of dashboard.py _fmt()
│   │   ├── lib/columns.ts  # derive DataTable columns from payload rows
│   │   ├── types/          # ambient module decl for the Plotly dist bundle
│   │   └── styles/
│   └── README.md           # frontend conventions and workflows
├── scripts/
│   └── gen_tokens.py       # THEME -> frontend/src/theme/tokens.css
├── tests/                  # unit + doctests
├── examples/
│   └── sample_export.csv   # 1,711 synthetic calls over 210 days
├── config.yaml             # shipped defaults, annotated
├── requirements.txt
├── pyproject.toml
└── Run_Forecast.bat        # Windows double-click launcher
```

**Data flow.**

```
data/*.csv
  → ingest.load_calls()        CallRecords{frame, ValidationReport}
  → features.build_daily()     one row per calendar day (zero-call days included)
  → features.engineer()        (frame, FeatureSpec) — pure function
  → evaluation.evaluate_models()   per target: leaderboard + best_model + residuals
  → forecast.generate_forecast()   refit on all history; calibrate; 90 days; simulate paths
  → explain / anomalies / scenarios
  → pipeline._write_outputs()  17 CSVs
  → dashboard.build_dashboard()    reports/dashboard.html
  → models/manifest.json       fingerprint for retrain detection
```

Three targets throughout: `call_volume`, `avg_duration_sec`, `total_cost`.

---

## 3. Completed Work

Everything in the original spec is implemented: all six models, all requested
features, all four metrics plus sMAPE/MASE/bias, auto-selection, confidence
intervals, retrain-on-new-data, anomaly detection, SHAP, charts/dashboard, CSV
output, modular + documented.

### Design decisions that constrain future changes

**Feature families.** `FeatureSpec` tags every column `calendar` (known for any
future date), `autoregressive` (from the target's own history), or `exogenous`
(observed call properties). Multi-step forecasting treats them differently;
this is not cosmetic.

**`engineer()` is a pure function, re-run per recursion step.** The forecaster
appends one predicted day and re-runs the same function rather than maintaining
a second prediction-time feature path. O(n) per step, but n is small and it
eliminates train/serve skew by construction.

**A target never sees another target's lags.** Tomorrow's cost is unknown when
forecasting tomorrow's volume. `FeatureSpec.for_target()` enforces this.

**Selection on MASE, not MAPE or R².** MAPE is undefined on zero-call days
(59% of the real data); R² is routinely negative on intermittent series. Both
are still reported. MAPE ships with `mape_n` so a percentage from 4 days is not
mistaken for one from 40.

**Intervals from out-of-sample residuals, grouped by horizon step.** Day-90
intervals are wider because the model *was* worse at 90 days.

**Residuals are mean-centred; non-negative targets are re-centred after
clipping.** Both guard against an interval that does not contain its own point
forecast. Uncentred residuals from a biased model shift every simulated path;
clipping at zero moves probability mass upward, compounding with horizon.
Measured bias is *reported*, never silently subtracted.

**Monthly totals are simulated, not summed.** Moving-block bootstrap (7-day
blocks) preserves error autocorrelation. Summing daily quantiles would describe
a month where every day independently hits its worst case.

**Models are rebuilt, not serialised.** A retrain takes seconds to ~3 min;
pickled Prophet/statsmodels objects break across library upgrades.

**Retrain detection hashes file *contents*.** Not mtime (OneDrive and
`git checkout` rewrite those), not filenames, order-normalised.

**Models below `min_observations` are skipped with a logged reason** rather
than fitted on a handful of points and quietly trusted.

---

## 4. Current State

### Verified working

- Full pipeline on real data (159 calls / 71 days): ~2.5 min, all outputs.
- Full pipeline on `examples/sample_export.csv` (1,711 calls / 210 days).
- 154 unit tests + 18 doctests pass (of the files that collect — see below).

### Test collection crash (environment, not code)

`tests/test_ingest.py` and `tests/test_forecast_and_models.py` abort with
`Windows fatal exception: access violation` **during collection**. The other
five files, including everything added by the React migration, pass.

This reproduces on a clean `git worktree` of `HEAD` with no working changes, so
it is not caused by recent work. The environment has drifted well past what
`requirements.txt` pins:

    python 3.12.10 · pytest 9.1.1 · numpy 2.4.6 · pandas 3.0.5

Root cause is pytest 9's parametrize-ID generation calling
`_pytest.compat.ascii_escaped()` on a `np.nan` parameter value; that function
only handles `str`/`bytes`. Both crashing files pass `np.nan` (or tuples) as
parametrize values.

Two ways out, neither done yet because both are out of scope for the migration:

1. Wrap the offending parameters — `pytest.param(np.nan, id="nan")` in
   `test_ingest.py:36` and the tuple cases in `test_forecast_and_models.py`.
   Smallest change, keeps the new toolchain.
2. Pin `pytest<9` and `pandas<3` in `requirements.txt`. `pandas 3.0` is a major
   release the code has not been audited against, so this is the conservative
   choice and probably the right first move.
- Dashboard: 11 Plotly figures, no horizontal overflow, no clipped labels,
  light/dark toggle restyles both CSS and figures, fully offline.
- Retrain lifecycle: `check` exits 1 when pending / 0 otherwise; `--only-if-changed` skips correctly.

### The headline caveat

On the **real 71-day export**, no model meaningfully beats the naive benchmark:

| Target | Winner | MAE | MASE | R² |
|---|---|---|---|---|
| `call_volume` | random_forest | 3.29 | **1.34** | −0.24 |
| `avg_duration_sec` | seasonal_naive | 29.36 | 0.80 | 0.07 |
| `total_cost` | random_forest | 0.54 | **1.36** | −0.00 |

MASE > 1 means worse than "repeat recent same-weekday values". Learned models
for `avg_duration_sec` are all **skipped** — 29 observed days is below the
30-observation floor.

**This is a data-volume limit, not a code defect.** The same pipeline on the
210-day synthetic sample reaches MASE **0.79 / 0.69 / 0.79** with 24 CV folds,
and three different models win. Re-check with `--data-dir examples`.

### Running it

```bash
python -m venv ~/.venvs/callforecast     # MUST be outside OneDrive (see §6)
~/.venvs/callforecast/Scripts/pip install -r requirements.txt

python -m call_forecast run -v                    # full pipeline
python -m call_forecast run --data-dir examples   # against the sample
python -m call_forecast check                     # exit 1 = retrain pending
python -m call_forecast inspect                   # data quality only
python -m call_forecast forecast call_volume
python -m call_forecast watch --interval 300

python -m pytest tests/ -q
python -m pytest --doctest-modules call_forecast/ -q
```

`data/` and `outputs/` are gitignored — the real export is business data and is
not in the repo. Drop exports into `data/` to use them.

---

## 5. Remaining Work

### Not implemented
- **Intra-day / hourly forecasting.** The heatmap shows the hourly pattern but
  modelling is daily. Hourly staffing needs an intra-day model.
- **No alert delivery.** Anomalies land in CSV and the dashboard; nothing emails
  or posts to Teams.
- **No hyperparameter search.** Model params are fixed in config.
- **`check_latest_day()` in `anomalies.py` is written and tested only
  indirectly** — no CLI command exposes it. It is the intended hook for a daily
  scheduled alert job.

### Known limitations (documented, not bugs)
- 90-day intervals are extrapolated past the 7-day CV horizon.
- Exogenous features are held at a trailing 28-day average across the horizon.
- Minute-resolution timestamps + no call ID → cross-file de-duplication matches
  on content plus within-file position. A call ID would make this exact.
- Erlang assumes Poisson arrivals; real traffic is burstier, so estimates are
  mildly optimistic.
- `scenarios.*` defaults (1 agent, 9h, 80%-in-30s, 100s patience) are
  placeholders. The staffing column is fiction until they are set.

### Technical debt
- `dashboard.py` is 1,152 lines and does layout, theming and figure
  construction. Split figures from HTML assembly if it grows further.
- A full run is ~2.5 min, dominated by Prophet refitting per CV fold. No
  caching of per-fold fits.
- `explain.py` catches broad `Exception` in several places — deliberate
  (explanation must never cost you the forecast) but it can mask real errors;
  they are logged at WARNING.

### Recommended next steps, in order
1. Accumulate history. Nothing improves forecast quality as much. Re-evaluate
   when `models/metrics_history.csv` shows MASE < 1.
2. Set the real `scenarios` values so staffing output becomes actionable.
3. Add alert delivery on top of `check_latest_day()`.
4. Add a `direction` column to the export if RetellAI can provide it — the
   inbound/outbound features activate with zero code change.

---

## 6. Development Guidelines

**Environment.** Create virtualenvs **outside** OneDrive (`~/.venvs/<project>`).
OneDrive locks files mid-install and corrupts pip. Skip
`pip install --upgrade pip` — most collision-prone write, rarely needed.

**Conventions.**
- Module docstrings explain *why*, not just what. Comments justify non-obvious
  decisions; skip them for self-evident code.
- Typed frozen dataclasses for config; `dataclasses.replace()` to override.
- Public functions take `cfg: AppConfig | None = None` and default it.
- Return rich result objects (`ForecastResult`, `EvaluationResult`,
  `AnomalyReport`), not bare tuples.
- Data-quality problems accumulate on a report object and are surfaced; they do
  not raise unless the run cannot proceed.
- Log with the module logger. Never `print()` outside `cli.py`.

**Patterns.**
- New model: subclass `Forecaster` (or `TabularForecaster`), register in
  `models/registry.py`, add a `min_observations` entry. Everything downstream
  discovers it.
- New feature: add it in `features.engineer()` and tag its family on
  `FeatureSpec`. Shift anything derived from a target by ≥1 day.
- New output: add to `pipeline._write_outputs()`.

**Do not:**
- Compute a feature from the same day's target without shifting. The leakage
  test in `tests/test_features.py` will catch it — do not weaken that test.
- Lower `models.min_observations` to make skipped models appear. The floor is
  the honesty mechanism.
- Silently bias-correct a forecast from few CV folds. Report the bias.
- Clip a simulated distribution without re-centring it (`base.py`
  `_enforce_non_negative` explains why).
- Sum daily quantiles to get an aggregate interval. Simulate paths.
- Let a diagnostic failure (SHAP, dashboard) abort the run — CSVs are the
  load-bearing deliverable.
- Add a dual-axis chart, use colour alone for status, or ship a chart without a
  table view. The dashboard follows an audited palette; re-validate if you
  change hues.
- Introduce a CDN/network dependency in the dashboard. A test asserts against it.

---

## 7. Next Recommended Claude Tasks

PR-sized, roughly independent, most valuable first.

1. **Add a `alert` CLI command wrapping `anomalies.check_latest_day()`.**
   Evaluate only the most recent day, print findings, exit 1 if any critical
   alert fired. Write `outputs/alerts_today.csv`. Add tests for the exit code
   and the empty case. This is the hook a scheduled job needs.

2. **Add optional email/Teams webhook delivery for critical alerts.** New
   `call_forecast/notify.py` with a `notifications` config section (disabled by
   default; webhook URL from an env var, never committed). Called from the
   `alert` command only when critical anomalies exist. Test with a mocked
   transport.

3. **Cache per-fold model fits during cross-validation.** Prophet dominates the
   ~2.5 min runtime by refitting on every fold. Add opt-in memoisation keyed by
   (model, target, train-slice hash) under `models/.cv_cache/`, with a size cap
   and invalidation on config change. Target: halve the wall time. Assert
   leaderboard numbers are unchanged.

4. **Split `dashboard.py` into `dashboard/figures.py` and
   `dashboard/layout.py`.** Pure refactor — figure construction separate from
   HTML/CSS assembly, `build_dashboard()` signature unchanged. Existing
   dashboard tests must pass untouched.

5. **Add `--from` / `--to` date filtering to the CLI.** Restrict ingestion to a
   window for backtesting a past period or excluding a known-bad stretch.
   Thread through `AppConfig.data`, record the filter in the manifest, and note
   it in the dashboard header.

6. **Add hourly-grain aggregation and an hourly volume forecast.** New
   `build_hourly()` beside `build_daily()`, reusing the existing feature
   families with hour-of-day terms. Daily forecasting stays the default; expose
   as `--grain hourly`. This is what intra-day staffing needs.

7. **Add a `--tune` flag running a small time-series-aware hyperparameter
   search** (`sklearn` `HalvingRandomSearchCV` with the existing rolling-origin
   splitter) for random forest and XGBoost. Persist the winning params to
   `models/tuned_params.json` and load them on later runs. Skip when history is
   below ~120 days and log why.

8. **Add a coverage test for interval calibration.** Over the CV folds, check
   the share of actuals falling inside the stated interval and assert it is
   within tolerance of the nominal level. Write the result to the leaderboard as
   a `coverage` column. This is the missing check on whether intervals are
   honest, not just coherent.

9. **Support a `direction` column end to end once RetellAI exports it.** The
   feature code already exists and is dropped by the zero-variance filter. Add a
   fixture with direction data, assert `inbound_outbound_ratio_prev` survives,
   and add inbound/outbound split charts to the dashboard.

10. **Add GitHub Actions CI.** Run pytest + doctests on push and PR against
    Python 3.10/3.11/3.12 on `windows-latest` and `ubuntu-latest`. Install
    without the optional extras on one matrix leg to prove Prophet/SHAP
    degradation works.

---

## 8. React Dashboard Migration

**Branch.** `feature/analytics-charts`.

> **PR numbers in this section are architectural milestones, not GitHub PR
> numbers.** They have never matched and are not going to. GitHub #1 was the
> model rail, which predates the migration entirely, so every milestone lands
> one number higher: milestone PR 1 merged as GitHub #2, PR 2 as #3, PR 3 as
> #4. This offset has already caused one PR to be built to the wrong scope —
> when picking up work, check what is actually on disk rather than trusting a
> merged PR's title.

Replacing the Python-rendered `reports/dashboard.html` (1,268 lines of string
assembly, 5.08 MB output, 4.9 MB of it inlined Plotly) with a React app that
consumes the JSON payload. The single-file, offline, mailable property is
preserved — the target is one self-contained HTML file, just a much smaller one.

### Done

**PR 1 — payload contract** (merged, `e1b8394`). `call_forecast/serialize.py`:
`build_payload()` / `dumps()` / `write_payload()`, plus
`outputs/dashboard_data.json` from `pipeline._write_outputs()`. 57 tests.

The load-bearing detail is JSON safety. `json.dumps` emits bare `NaN` and
`Infinity` tokens that are **invalid JSON** and throw in `JSON.parse`, and this
data is dense with them — `avg_duration_sec` is null on 42 of 71 real days.
Every non-finite float becomes `null`; `dumps()` then uses `allow_nan=False` so
anything that escapes raises at write time rather than failing in a browser.
`<`, `>` and `&` are escaped so an anomaly message containing `</script>`
cannot close the tag it will be inlined into.

**PR 2 — frontend scaffold, theme system, shell** (merged, `0238bcf`). Vite +
React 19 + TypeScript strict. Header, two-column layout, model rail, footer and
theme toggle render from a committed fixture. No charts yet.

**PR 3 — primitives and non-chart sections** (merged, `e330283`). `Card`, `Section`,
`StatTile`/`TileGrid`, `Callout`, `DataTable` and `TableView` under
`components/primitives/`, and the four chart-free sections — Data Quality, At a
Glance, Anomalies and alerts, Scenario analysis — under `components/sections/`.
Their entries are gone from `PendingSections.tsx`, which now lists only
chart-bearing work.

Three things are worth knowing before touching the tables.

*JSON has already destroyed the int/float distinction.* `_table()` prints an
`int64` column as `{:,}` and a float column with the table's `numeric_format`,
but `1` and `1.0` both arrive here as `1`. Detecting integer-ness from the
value would print `0` where the Python dashboard prints `0.00`. So `DataTable`
takes a per-table `digits` and columns opt out with `digits: 0`;
`deriveColumns(rows, { integerKeys })` is how a caller names them. Today that
is `current_agents` and `required_agents` in the scenario table. **A new
integer column in `scenarios.py` must be added to `INTEGER_COLUMNS` in
`ScenariosSection.tsx`** or it will render with two decimals.

*Columns carry an accessor, not a string key.* Payload rows are declared as
interfaces, and a TypeScript interface is not assignable to
`Record<string, CellValue>` under `strict`, so keyed indexing does not
typecheck. `Column.value` is a function; the one cast this needs lives in
`deriveColumns` and nowhere else.

*Sorting is opt-in, and missing values sort last in both directions.* The
direction sign is deliberately not applied to the missing-value branch — a
descending sort that floated a column's gaps to the top would read as "these
are the largest", which is the opposite of what `null` means in this payload.
The sort is stable, and default order is always the payload's, so an untouched
table matches the Python dashboard row for row.

Two deliberate departures from `dashboard.py`, both of which make the React
version slightly better rather than different: tables carry a visually hidden
`<caption>` and sortable `<th>`s carry `aria-sort`, neither of which the Python
tables had. Two deliberate non-departures: header text stays the raw payload
key (`volume_uplift_pct`, not "Volume Uplift Pct") because those identifiers
also name CSV columns, and `anomalies.notes` is still not rendered, because the
Python section does not render it either.

**PR 4 — Plotly base and the forecast charts** (this branch). The chart layer
plus the three forecast cards: history line, forecast line, calibrated interval
band, the "today" divider, the horizon rollup table, notes and the full daily
disclosure. Cards carry `id="model-<target>"`, which is what the rail has been
scrolling to since PR 1. 10 frontend tests.

Five things are load-bearing here.

*The palette is read from CSS, not copied into TypeScript.* `readPalette()`
resolves `--series1`, `--band` and the rest off `documentElement`, so the
audited palette keeps the single source of truth that `tests/test_tokens.py`
guards. There are no colour literals anywhere in `lib/chart/`.

***`useTheme().mode` changes one render before the palette does.*** This is the
trap, and it is not obvious. `ThemeProvider` writes `data-theme` in an effect,
and React flushes child effects before parent effects — so a `useMemo`,
`useEffect` or `useLayoutEffect` keyed on `mode` reads the *previous* theme's
custom properties and then never runs again. Charts stay in the old palette on
a page that has already switched. `useChartPalette` therefore subscribes to the
DOM with `useSyncExternalStore`: a `MutationObserver` on `data-theme`, plus the
`prefers-color-scheme` media query for the case where the viewer follows the OS
and no attribute is ever written. **Do not "simplify" this back to `mode`.**

*This is why there is no equivalent of `dashboard.py`'s `Figure.roles`.* The
Python dashboard patched live figures on toggle and needed a map of which trace
property carried which theme role; a trace added without an entry in that map
kept its light-mode colour in the dark. Here the palette is an *argument* to
every builder, so a theme change rebuilds the figure and `Plotly.react()` diffs
it in place. The failure mode is unrepresentable rather than merely avoided.

*Width is passed to Plotly explicitly.* Both of Plotly's own resize paths —
`config.responsive` and `Plots.resize()` — work by deleting `layout.width`
**and** `layout.height` and re-autosizing; `Plots.resize` early-returns unless
it can drop both. Every figure sets an explicit height, and PR 5's ranked
charts will derive theirs from their row count, so letting Plotly discard it
would collapse them. `PlotlyChart` measures its container and redraws instead,
driven by a `ResizeObserver` and a `window.resize` listener.

*Figure builders are pure and live in `lib/chart/figures/`.* They take payload
rows plus a palette and return `{data, layout}` — no DOM, no Plotly. That is
what makes the silent chart failures assertable at all, and it is the seam PR 5
plugs into. The bundle is `plotly.js-cartesian-dist-min` (~1.1 MB, scatter +
bar + heatmap), typed by a hand-written two-function module declaration in
`src/types/plotly.d.ts` rather than the very large `@types/plotly.js`, which
describes the *full* library and would typecheck traces this bundle cannot draw.

**Unverified.** Live resizing. The embedded browser used to check everything
else changes the viewport without dispatching `resize`, and its
`ResizeObserver` never fires — confirmed against a plain observer watching an
element restyled from 905px to 520px, which reported zero callbacks. A fresh
load is correct at every width tried (375px through 1280px, no page overflow,
SVG width equals container width). Live resizing needs a check in a real
browser.

### Frontend architecture

**Stack.** Vite 7 · React 19 · TypeScript 5.9 · Plotly (cartesian dist) · CSS
Modules, with Vitest for unit tests. No UI kit, no state library, no CSS
framework, no charting wrapper. Node is a **dev** dependency: end users still
`pip install` and run the CLI.

**Frontend tests.** `npm test` (`vitest run`), Node environment, `src/**/*.test.ts`.
Deliberately DOM-free — the figure builders are pure, and keeping them that way
is what makes chart behaviour assertable. Rendering is verified by hand in a
browser until PR 9 wires CI.

**Payload loading** (`src/data/loadPayload.ts`) — three sources in order:

1. inline `<script id="dashboard-data" type="application/json">` — production;
2. `fetch('./dashboard_data.json')` — served mode, and the seam an API plugs into;
3. the committed fixture — **dev only**, behind `import.meta.env.DEV` so Vite
   drops it from production builds.

The fetch branch checks `content-type` for `application/json`, not just
`response.ok`: Vite's SPA fallback answers a missing `dashboard_data.json` with
`index.html` and a 200, which would otherwise be parsed as JSON and fail hard
instead of falling through to the fixture.

**Theme.** `src/theme/tokens.css` is **generated** from
`call_forecast.dashboard.THEME` by `scripts/gen_tokens.py`;
`tests/test_tokens.py` fails if the checked-in file drifts. The palette is
audited, so one source of truth matters more than convenience.

Light is the base in `:root`; `@media (prefers-color-scheme: dark)` applies dark
when the viewer has not pinned light; `:root[data-theme="dark"]` overrides both.
Because the OS case is pure CSS, the right palette is applied *before* React
mounts — no flash. `data-theme` is only stamped once the viewer chooses, which
is exactly how the Python dashboard behaves. `useTheme()` exposes `mode` (what
is rendered) and `preference` (`light` / `dark` / `system`); an explicit choice
persists to `localStorage` under `call-forecast:theme`.

**State.** No library. `ThemeContext` for theme, `useState` in `App` for rail
selection. The payload is immutable and arrives once. TanStack Query becomes
correct the day there is a live API, not before.

**Layout.** `grid-template-columns: var(--rail) minmax(0, 1fr)`. The
`minmax(0, 1fr)` is load-bearing — a bare `1fr` lets a wide table or chart force
the page into horizontal scroll. Below 900px the rail collapses to a
horizontally scrolling strip; the page itself never scrolls sideways.

### Remaining steps

**PR 5 — remaining charts.** Monthly cost, heatmap, leaderboard, feature
importance, anomaly timeline. This is the next PR, and the foundation it needs
is already on disk: add a builder under `lib/chart/figures/`, export it from
that directory's `index.ts`, and render it through `PlotlyChart` with a palette
from `useChartPalette`. Nothing in the chart layer should need to change.

Five entries remain in `PendingSections.tsx`, one per chart; each is deleted as
its section lands, and the file goes with the last of them.

*Sections to add.* `MonthlyCostSection` (cost only — it is the one target with
a monthly rollup), `ArrivalsSection` ("When calls arrive"),
`ModelComparisonSection` and `ExplainabilitySection` (both one card per target,
following `payload.targets` so page order matches the rail). The anomaly chart
goes **into the existing `AnomaliesSection`**, above the tally table, rather
than into a new section — a flagged day means nothing without the line it
departs from. That section's tables are PR 3 work and should not otherwise
change; it will need `daily` passed in as a new prop for the timeline.

*Palette roles to add.* `readPalette()` currently resolves only what the
forecast charts use. PR 5 needs `surface` (the marker halo), `critical`,
`warning`, and the seven-step `--seq-N` ramp for the heatmap — add them to
`ChartPalette` and `ROLES`, plus a `seq` array and a `[[0, c], …]` colorscale
conversion.

*Sizing helpers to add.* The leaderboard and importance charts must derive
height from row count and left margin from the longest label. `dashboard.py`
hard-codes `margin.l = 170` and `220` and heights of `46 * n` and `30 * n`;
those were tuned against the names that existed at the time, and
`call_volume_roll7_vs_roll30` already overruns 220px at 12px. Estimate label
width (system-ui at 12px runs a little under 0.6em per character for these
identifiers), clamp between a floor and a cap, and ellipsise anything past the
cap rather than letting Plotly clip it silently.

Five fixes from `dashboard.py` are easy to silently drop and are therefore
acceptance criteria — every one of them still *renders*, which is exactly why
each needs an assertion rather than a look:

- `xaxis.type: 'category'` on the monthly chart, or Plotly parses `"2026-08"` as
  a date and **drops the `(partial)` bars**;
- `xaxis.type: 'category'` on the heatmap, or `"00".."23"` land on a numeric scale;
- `constraintext: 'none'`, or Plotly clips `"$3.90"` to `"$"` on a narrow bar;
- heatmap rows Monday-first via `yaxis.autorange: 'reversed'`, since Plotly puts
  the first category at the *bottom*;
- anomaly markers as triangle (critical) and diamond (warning), with the
  severity named in the legend text — so severity is never carried by colour
  alone, in the plot or in the legend.

Two smaller things worth carrying over. Info-level anomalies are deliberately
absent from the timeline (numerous, and they would bury the two severities that
matter); and one marker is plotted per flagged *day*, not per rule, with its y
taken from the volume line rather than the rule's own `actual` — a cost alert's
`$4.27` would land nowhere near a call-count axis.

**PR 6 — single-file bundling and pipeline integration.** `vite-plugin-singlefile`,
a committed template at `call_forecast/assets/`, payload injected as an inline
script. Target ≤ 2 MB (from 5.08 MB). Needs a CI check that rebuilding the
template produces no diff, or a stale template will ship.

**PR 7 — real rail behaviour.** Filter the page to one model; put selection in
the URL hash. Charts inside `display:none` get zero dimensions — mount lazily or
resize on reveal.

**PR 8 — flip the default, retire `dashboard.py`.** Keep `--legacy-dashboard`
for one release.

**PR 9 — CI.** Node build + typecheck + pytest. Folds into §7 item 10.

### Frontend conventions

- camelCase for structural keys, snake_case preserved for data identifiers
  (`modelLabel` vs `call_volume`, `yhat_lower`).
- **Every payload number can be `null`.** Not an edge case.
- Colours come from custom properties, never literals. Re-run
  `scripts/gen_tokens.py` after any `THEME` change.
- Wide content scrolls inside its own container; the page never does. The
  15-column scenario table is the current worst case and is verified not to
  push the page sideways at 375px.
- Sections compose primitives; they do not write their own table, tile or
  callout markup. A section that needs new chrome extends a primitive.
- **Charts go through `PlotlyChart`, and figures are built by pure functions.**
  A section never calls Plotly. Every chart carries an `aria-label` describing
  what it shows and ships a `TableView` with the same numbers — a chart without
  one is unreadable to a screen reader and un-copyable into a spreadsheet.
- Chart colours come from `useChartPalette()`, never from a literal and never
  from `useTheme().mode` directly.
- `frontend/README.md` has the workflows, including regenerating the fixture
  (which comes from `examples/`, never from `data/` — it is committed).
