# SESSION_CONTEXT

Technical handoff for `call_forecast`. Read alongside `README.md` (user-facing)
and `config.yaml` (every tunable, with defaults written out).

This file records **why** the code is the way it is — the invariants, traps and
design decisions that are expensive to rediscover. It deliberately does **not**
keep per-PR verification receipts (test counts, byte sizes, "verified locally"
blocks); those are point-in-time and each PR's numbers superseded the last.
Current numbers live in §10 (Standing hazards) and in CI (§9). The feature
history in §11 keeps the *rules* each PR established, not its transcript.

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
**Not yet production-useful for point forecasts** — see the headline caveat in
§4.

**The dashboard is a React app.** The migration from the Python-rendered HTML
page is complete; React is the default renderer and the legacy Python page is
retained behind `--legacy-dashboard` for one release cycle. The single-file,
offline, mailable property is preserved — one self-contained `reports/dashboard.html`,
just a much smaller one (~1.9 MB vs the legacy 5.08 MB). §8 has the frontend
architecture.

**The application has three views**, all in the URL fragment:

```
location.hash === ''            landing page — the reader chooses to enter
location.hash === '#model=…'    the report, filtered
location.hash === '#view=docs'  the integrated documentation
```

The report no longer renders until the reader enters it (§11, Landing
Experience). A link carrying a fragment (`#model=…`, `#view=docs`) is a *deep
link* and arrives where it points, skipping the landing gate. The docs are six
pages of integrated documentation reached from the header's "Docs" control.
**Before touching routing, read the fragment contract in §11 (Navigation UX,
Docs routing, Landing Experience).** Two writers share one fragment and the
failure mode is silent.

**Phases.** Phase 1 was the pipeline + the React migration (§8). Phase 2 added
dashboard state consistency, navigation UX, CSV import, the export center,
docs, and external links. Phase 3 added the landing experience, executive
summary cards, import history, the import experience (XLSX), and the import
preview. §11 is the condensed history of all of it.

---

## 2. Current Architecture

**Frontend runtime dependencies.** React · Plotly (cartesian dist) ·
`read-excel-file` (`.xlsx` import — §11). Everything else under `frontend/` is
dev-only.

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
│   ├── dashboard.py        # build_dashboard_react() — the DEFAULT renderer
│   │                       #   + build_dashboard(), legacy, --legacy-dashboard
│   │                       #   retained one release cycle (§8)
│   ├── assets/
│   │   └── dashboard_template.html  # COMMITTED frontend build (§8) - generated
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
│   │   ├── components/sections/    # all nine analysis sections
│   │   ├── components/summary/     # executive summary cards (§11)
│   │   ├── components/import/      # ImportPanel (§11)
│   │   ├── components/importHistory/  # RecentImports (§11)
│   │   ├── components/export/      # ExportCenter (§11)
│   │   ├── components/docs/        # DocsNav, DocsView, blocks (§11)
│   │   ├── components/landing/     # LandingPage (§11)
│   │   ├── components/charts/      # PlotlyChart wrapper + useChartPalette
│   │   ├── lib/chart/      # palette, baseLayout, sizing, pure figure builders
│   │   ├── lib/import/     # CSV/XLSX parser — a port of ingest.py (§11)
│   │   ├── lib/export/     # export engine (§11)
│   │   ├── lib/docs/       # doc content model + route (§11)
│   │   ├── lib/importHistory/  # localStorage history (§11)
│   │   ├── lib/selection.ts    # fragment parse/format; selectionView.ts; entry.ts
│   │   ├── lib/format.ts   # port of dashboard.py _fmt()
│   │   ├── lib/columns.ts  # derive DataTable columns from payload rows
│   │   ├── types/          # ambient module decl for the Plotly dist bundle
│   │   └── styles/
│   └── README.md           # frontend conventions and workflows
├── .github/workflows/
│   └── ci.yml              # backend + frontend + dashboard-artefact jobs (§9)
├── scripts/
│   ├── gen_tokens.py       # THEME -> frontend/src/theme/tokens.css
│   ├── sync_template.py    # frontend/dist -> call_forecast/assets (+ --check)
│   └── check_bundle_size.py # size gate on the generated dashboard (§9)
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
  → pipeline._write_outputs()  17 CSVs + outputs/dashboard_data.json
  → dashboard.build_dashboard_react()  reports/dashboard.html   (default)
    dashboard.build_dashboard()        reports/dashboard.html   (--legacy-dashboard)
  → models/manifest.json       fingerprint for retrain detection
```

Everything from `_write_outputs()` onward is the load-bearing part. Dashboard
rendering sits inside a `try/except` that logs at ERROR and continues, so a
renderer failure costs you the HTML and nothing else — the CSVs, the JSON
payload and the manifest are all already on disk by then. **There is
deliberately no automatic fallback from React to legacy** (§8): a silent
fallback would emit a 5 MB page nobody asked for and mask a stale committed
template. The renderer logs at ERROR, names itself, and tells the operator to
re-run with `--legacy-dashboard`.

Three targets throughout: `call_volume`, `avg_duration_sec`, `total_cost`.

---

## 3. Design decisions that constrain future changes

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

**De-duplication uses `call_id` when the export carries one** (`ingest.py:564`)
and otherwise falls back to content plus within-file position, because
timestamps are minute-resolution. The RetellAI exports in use today have no
call ID, so the fallback is the path that actually runs — but the exact path
exists and activates the day the column appears.

---

## 4. Current State

### Verified working

- Full pipeline on real data (159 calls / 71 days): ~2.5 min, all outputs.
- Full pipeline on `examples/sample_export.csv` (1,711 calls / 210 days).
- Backend + doctest suites pass in `~/.venvs/callforecast`.
- Dashboard: 11–12 Plotly figures (12 on the sample, 11 on the 71-day export
  where `avg_duration_sec` has every learned model skipped below the floor), no
  horizontal overflow, no clipped labels, light/dark toggle restyles both CSS
  and figures, fully offline.
- Retrain lifecycle: `check` exits 1 when pending / 0 otherwise;
  `--only-if-changed` skips correctly.

### Test collection crash (environment, not code)

`tests/test_ingest.py` and `tests/test_forecast_and_models.py` can abort with
`Windows fatal exception: access violation` **during collection** — but this is
intermittent (it did not reproduce on most recent runs) and reproduces on a
clean `git worktree` of `HEAD`, so it is not caused by any recent change. The
environment has drifted well past what `requirements.txt` pins:

    python 3.12.10 · pytest 9.1.1 · numpy 2.4.6 · pandas 3.0.5

Root cause: pytest 9's parametrize-ID generation calls
`_pytest.compat.ascii_escaped()` on a `np.nan` parameter value; that function
only handles `str`/`bytes`. Both crashing files pass `np.nan` (or tuples) as
parametrize values.

Two ways out, neither done (both out of scope so far):

1. Wrap the offending parameters — `pytest.param(np.nan, id="nan")` in
   `test_ingest.py:36` and the tuple cases in `test_forecast_and_models.py`.
   Smallest change, keeps the new toolchain.
2. Pin `pytest<9` and `pandas<3` in `requirements.txt`. `pandas 3.0` is a major
   release the code has not been audited against, so this is the conservative
   choice and probably the right first move.

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

python -m call_forecast run -v                    # full pipeline, React report
python -m call_forecast run --data-dir examples   # against the sample
python -m call_forecast run --legacy-dashboard    # the old Python report (§8)
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
- Erlang assumes Poisson arrivals; real traffic is burstier, so estimates are
  mildly optimistic.
- `scenarios.*` defaults (1 agent, 9h, 80%-in-30s, 100s patience) are
  placeholders. The staffing column is fiction until they are set.

### Technical debt
- `dashboard.py` is ~1,440 lines and is mostly the *legacy* renderer, scheduled
  for removal after one release cycle. **Delete rather than split**, once the
  cycle is up. **`THEME` and `_stylesheet` must survive that deletion**:
  `scripts/gen_tokens.py` generates `frontend/src/theme/tokens.css` from
  `THEME`, and `tests/test_tokens.py` imports both.
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

**§7's testing subsection is the standing instruction on when to run the test
suites.** The short version: the branch is assumed green, the full Python suite
is a pre-commit gate rather than a warm-up, and a frontend-only change does not
run it at all.

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
- Hand-edit `call_forecast/assets/dashboard_template.html`. It is a build
  artefact; `scripts/sync_template.py` is its only writer. Change the frontend
  and re-sync.
- Check self-containment of the React output with a regex. The page is 1.6 MB
  of minified JS containing the strings `src=`, `href=` and `<script>`; parse
  it with `html.parser` and look at real tags.

---

## 7. Next Recommended Claude Tasks

PR-sized, roughly independent, most valuable first. (Items already delivered —
CI, the dashboard.py split superseded by the migration — have been dropped from
this list; see §8/§9.)

1. **Add an `alert` CLI command wrapping `anomalies.check_latest_day()`.**
   Evaluate only the most recent day, print findings, exit 1 if any critical
   alert fired. Write `outputs/alerts_today.csv`. Add tests for the exit code
   and the empty case. This is the hook a scheduled job needs.

2. **Add optional email/Teams webhook delivery for critical alerts.** New
   `call_forecast/notify.py` with a `notifications` config section (disabled by
   default; webhook URL from an env var, never committed). Called from the
   `alert` command only when critical anomalies exist. Test with a mocked
   transport.

3. **Cache per-fold model fits during cross-validation.** Prophet dominates the
   ~2.5 min runtime. Add opt-in memoisation keyed by (model, target, train-slice
   hash) under `models/.cv_cache/`, with a size cap and invalidation on config
   change. Assert leaderboard numbers are unchanged.

4. **Add `--from` / `--to` date filtering to the CLI.** Restrict ingestion to a
   window for backtesting or excluding a known-bad stretch. Thread through
   `AppConfig.data`, record the filter in the manifest, and note it in the
   dashboard header.

5. **Add hourly-grain aggregation and an hourly volume forecast.** New
   `build_hourly()` beside `build_daily()`, reusing the feature families with
   hour-of-day terms. Daily stays the default; expose as `--grain hourly`.

6. **Add a `--tune` flag** running a small time-series-aware hyperparameter
   search (`HalvingRandomSearchCV` with the existing rolling-origin splitter)
   for random forest and XGBoost. Persist to `models/tuned_params.json`. Skip
   when history is below ~120 days and log why.

7. **Add a coverage test for interval calibration.** Over the CV folds, check
   the share of actuals inside the stated interval and assert it is within
   tolerance of the nominal level. Write the result as a `coverage` column.

8. **Support a `direction` column end to end** once RetellAI exports it. The
   feature code exists and is dropped by the zero-variance filter. Add a fixture
   with direction data, assert `inbound_outbound_ratio_prev` survives, and add
   inbound/outbound split charts.

### Testing workflow (standing instruction)

This repository has an established CI pipeline (§9), and **the current branch
should be assumed to be passing unless there is evidence otherwise.**

**Do not run the full Python suite (`pytest tests/ -q`) at the start of a task.**
It takes several minutes. Run it only:

- before a final PR or commit;
- when explicitly requested;
- when the change touches broad backend functionality and targeted testing is
  not sufficient.

During implementation: skip baseline verification, inspect the relevant files
first, run targeted tests for the files actually modified, and do not validate
unrelated parts of the repo.

**For frontend-only changes** (React / TypeScript / UI), do not run the Python
suite at all unless the change affects Python-generated data contracts,
serializers, APIs or backend behaviour. `serialize.py` and the payload contract
are the line: a change that does not cross it is checked by `npm run typecheck`,
`npm test`, `npm run build` and `scripts/sync_template.py --check`.

*A frontend change still regenerates
`call_forecast/assets/dashboard_template.html` (§6, §8) — that is a build
artefact, not backend behaviour, and `sync_template.py --check` is its gate.
Regenerating it is not on its own a reason to run pytest.*

---

## 8. React Dashboard — Architecture

The Python-rendered `reports/dashboard.html` (1,268 lines of string assembly,
5.08 MB output, 4.9 MB of it inlined Plotly) was replaced with a React app that
consumes the JSON payload. The single-file, offline, mailable property is
preserved — one self-contained HTML file, just a much smaller one. The
migration ran across eight milestones (payload contract → scaffold → primitives
→ chart layer → all charts → single-file bundling → interactivity → cutover);
React has been the default renderer since the cutover. Everything below is the
resulting architecture.

> **A note on PR numbering.** "PR N" labels in this document are architectural
> milestones and have **never** matched GitHub PR numbers — GitHub #1 was the
> model rail, which predates the migration, so every milestone lands one number
> higher (milestone PR 1 = GitHub #2, etc.). This offset has caused at least one
> PR to be built to the wrong scope. **When picking up work, check what is
> actually on disk rather than trusting a merged PR's title.**

### The payload contract (`serialize.py`)

`build_payload()` / `dumps()` / `write_payload()` produce
`outputs/dashboard_data.json`. The load-bearing detail is **JSON safety**:
`json.dumps` emits bare `NaN`/`Infinity` tokens that are *invalid JSON* and
throw in `JSON.parse`, and this data is dense with them (`avg_duration_sec` is
null on 42 of 71 real days). Every non-finite float becomes `null`; `dumps()`
uses `allow_nan=False` so anything that escapes raises at write time. `<`, `>`
and `&` are escaped to `\uXXXX` so an anomaly message containing `</script>`
cannot close the tag it is inlined into. **Every payload number can be `null` —
not an edge case.**

### Single-file bundling — how the two toolchains meet

`frontend/index.html` carries one HTML comment, `<!--dashboard-data-->`,
immediately before `#root`. `vite-plugin-singlefile` inlines the JS and CSS into
a single `dist/index.html` and carries that comment through verbatim;
`scripts/sync_template.py` copies the result to
`call_forecast/assets/dashboard_template.html`, which is **committed**;
`build_dashboard_react()` substitutes the serialised payload for the comment and
writes the file. There is no Node at run time and nothing that could introduce a
network dependency.

- A comment, not an empty `<script id="dashboard-data">{}</script>` placeholder,
  because `loadPayload()` checks the inline source first — a placeholder would be
  *found* in dev and render an empty payload instead of falling through to the
  fixture.
- **The committed template goes stale silently** if you change a component,
  confirm it in the dev server, and commit without re-syncing. `sync_template.py
  --check` is the guard (same shape as `gen_tokens.py --check`) and CI enforces
  it (§9). It also refuses a build unfit to be a template: a missing/duplicated
  marker, a surviving `src=`/`href=`, or an over-budget size.
- The build is byte-reproducible for a fixed lockfile and Node major, **not**
  across them. Bumping `frontend/.nvmrc` means re-syncing in the same PR.
- **Packaging:** `[tool.setuptools.package-data] call_forecast = ["assets/*.html"]`;
  the template is addressed through `importlib.resources`, so it resolves from an
  installed wheel.

### The renderer choice, and the deprecation

`run_pipeline` has `legacy_dashboard: bool = False` and keeps `react_dashboard`
as `bool | None = None`. That `None` is load-bearing: it distinguishes "not
passed" (defer to `legacy_dashboard`) from an explicit `True`/`False` from a
pre-cutover caller. `legacy_dashboard=True` with `react_dashboard=True` raises
`ValueError` *before* expensive work. On the CLI, `--legacy-dashboard` is the
switch; `--react-dashboard` still parses but is a documented no-op printing a
deprecation notice (scheduled tasks and `.bat` files pass it, and
`unrecognized arguments` would take a scheduler down). `Run_Forecast.bat` passes
no dashboard flag, so the double-click path gets the smaller dashboard for free.
**There is deliberately no automatic React→legacy fallback** (§2).

### Frontend stack & state

**Stack.** Vite 7 · React 19 · TypeScript 5.9 · Plotly (cartesian dist) · CSS
Modules, with Vitest for unit tests — plus jsdom and Testing Library for
component tests. No UI kit, no state library, no CSS framework, no charting
wrapper. Node is a **dev** dependency: end users `pip install` and run the CLI.

**State — no library, and three kinds, each owned in exactly one place.**

1. **The payload** is immutable and arrives once, in `App`. An import replaces
   it **through the same `setState` the initial load uses** — never a second
   "imported payload" slice (§10 is the record of what happens when two things
   that should agree are computed twice).
2. **Theme** is `ThemeContext`, read through `useChartPalette`'s DOM
   subscription rather than `mode` (see the trap below).
3. **Selection** — the rail's target and the forecast horizon — is the URL
   fragment, read through the single `useHashSelection` subscriber in `App` and
   passed down as props. **No component reads `location`**, and none keeps a
   second copy. Parsing/formatting are pure functions in `src/lib/selection.ts`,
   tested without a DOM.

TanStack Query becomes correct the day there is a live API, not before.

**Payload loading** (`src/data/loadPayload.ts`) — three sources in order:
inline `<script id="dashboard-data">` (production); `fetch('./dashboard_data.json')`
(served mode, the seam an API plugs into); the committed fixture (**dev only**,
behind `import.meta.env.DEV`). The fetch branch checks `content-type` for
`application/json`, not just `response.ok`: Vite's SPA fallback answers a missing
file with `index.html` and a 200, which would otherwise parse as JSON and fail
hard instead of falling through to the fixture.

### Theme

`src/theme/tokens.css` is **generated** from `call_forecast.dashboard.THEME` by
`scripts/gen_tokens.py`; `tests/test_tokens.py` fails if the checked-in file
drifts. The palette is audited, so one source of truth matters more than
convenience. Light is the base in `:root`; `@media (prefers-color-scheme: dark)`
applies dark when the viewer has not pinned light; `:root[data-theme="dark"]`
overrides both. Because the OS case is pure CSS, the right palette applies
*before* React mounts — no flash. `useTheme()` exposes `mode` (what is rendered)
and `preference` (`light`/`dark`/`system`); an explicit choice persists to
`localStorage` under `call-forecast:theme`.

Motion tokens (`--motion-fast`, `--motion-base`, `--motion-ease`,
`--motion-rise`) live in `global.css`, **not** `tokens.css` — the Python
renderer has no motion to describe, and `tests/test_tokens.py` guards
`tokens.css`. `global.css` also carries a blanket `prefers-reduced-motion`
kill-switch that collapses durations to `0.01ms` (not `none` — an animation with
`fill-mode: both` and no duration never reaches its `to` frame).

### Charts — the load-bearing rules

- **Charts go through `PlotlyChart`; figures are built by pure functions** in
  `lib/chart/figures/` that take payload rows plus a palette and return
  `{data, layout}` — no DOM, no Plotly. That is what makes silent chart
  failures assertable, and it is the seam export/PNG plugs into. A section never
  calls Plotly. Every chart carries an `aria-label` and ships a `TableView` with
  the same numbers.
- **The palette is read from CSS, not copied into TypeScript.** `readPalette()`
  resolves `--series1`, `--band`, the `--seq-N` ramp etc. off `documentElement`.
  No colour literals anywhere in `lib/chart/`.
- ***`useTheme().mode` changes one render before the palette does.*** This is the
  trap. `ThemeProvider` writes `data-theme` in an effect, and React flushes child
  effects before parent effects — so a `useMemo`/`useEffect` keyed on `mode`
  reads the *previous* theme's custom properties and never runs again. Charts
  stay in the old palette on a page that already switched. `useChartPalette`
  therefore subscribes to the DOM with `useSyncExternalStore` (a
  `MutationObserver` on `data-theme` plus the `prefers-color-scheme` media
  query). **Do not "simplify" this back to `mode`.** Chart colours come from
  `useChartPalette()`, never from a literal and never from `mode`. Because the
  palette is an *argument* to every builder, a theme change rebuilds the figure
  and `Plotly.react()` diffs it in place — the old "which trace property carries
  which theme role" map is unrepresentable rather than merely avoided.
- **Width is passed to Plotly explicitly.** Both of Plotly's resize paths
  (`config.responsive` and `Plots.resize()`) delete `layout.width` **and**
  `layout.height` and re-autosize. Every figure sets an explicit height (the two
  ranked charts derive theirs from row count), so letting Plotly discard it
  would collapse them. `PlotlyChart` measures its container and redraws via a
  `ResizeObserver` + `window.resize` listener.
- **Filtering unmounts a card; it never hides one with `display: none`.** An
  unmounted card cannot be measured at zero width, and on reveal it mounts fresh
  and measures itself. This is why `PlotlyChart` needs no queued-draw
  bookkeeping — a 0×0 reveal is a `ResizeObserver` notification like any other.
- **`lib/chart/sizing.ts`** — `rankedSizing()` derives the two ranked charts'
  height from row count and their left margin from the longest label, ellipsising
  past a 220px cap. Widths are *estimated* (7px/char at 12px system-ui), not
  measured — measuring would make the builders impure.
- Builders return `null` rather than an empty figure when nothing scored
  (leaderboard/importance when every model was skipped below the floor). The
  section keeps its table, which explains *why* there is no chart.
- The bundle is `plotly.js-cartesian-dist-min` (~1.1 MB: scatter + bar +
  heatmap), typed by a hand-written module declaration in `src/types/plotly.d.ts`
  rather than `@types/plotly.js`, which describes the *full* library and would
  typecheck traces this bundle cannot draw.

### Layout

`grid-template-columns: var(--rail) minmax(0, 1fr)`. The `minmax(0, 1fr)` is
load-bearing — a bare `1fr` lets a wide table or chart force horizontal page
scroll. Below 900px the rail collapses to a horizontally scrolling strip; the
page itself never scrolls sideways. **Wide content scrolls inside its own
container; the page never does.** The 15-column scenario table is the current
worst case, verified not to push the page sideways at 375px.

### Frontend conventions

- camelCase for structural keys, snake_case preserved for data identifiers
  (`modelLabel` vs `call_volume`, `yhat_lower`).
- Colours come from custom properties, never literals. Re-run
  `scripts/gen_tokens.py` after any `THEME` change.
- Sections compose primitives; they do not write their own table/tile/callout
  markup. A section that needs new chrome extends a primitive.
- **Selection is the URL fragment, read in `App` and nowhere else.** A section
  that needs to know what is selected takes it as a prop.
- `frontend/README.md` has the workflows, including regenerating the fixture
  (which comes from `examples/`, never `data/` — it is committed).

### Frontend tests

`npm test` (`vitest run`), `src/**/*.test.{ts,tsx}`. Node is the default
environment and the figure-builder tests stay DOM-free. A `.test.tsx` file opts
into jsdom with a `// @vitest-environment jsdom` docblock and mocks Plotly:

```ts
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));
```

Two jsdom facts that will bite the next person: `clientWidth` is **always 0**
(stub it on `HTMLElement.prototype` to drive a reveal), and there is no
`ResizeObserver` (install one on `globalThis` and fire on demand). Assigning
`location.hash` dispatches `hashchange` on a *task*, not a microtask — awaiting a
resolved promise is not enough to observe it. `globals: true` is set so Testing
Library's automatic `afterEach` cleanup is found — without it each test renders
into the previous test's DOM.

---

## 9. Continuous Integration

One workflow, `.github/workflows/ci.yml`, on `pull_request` and on `push` to
`main`. It answers four questions, in the order a regression would be noticed:

```
+-- Can Python still generate correct analytics?   backend    (2 legs)
+-- Can React still compile?                       frontend
+-- Can the offline dashboard still be built?      frontend
+-- Did someone forget to regenerate the template? dashboard
```

| Job | Runner | Pinned to | Runs |
|---|---|---|---|
| `backend` | ubuntu-latest | Python 3.10, 3.12 | `pip install -r requirements.txt`, `pytest tests/`, doctests |
| `frontend` | ubuntu-latest | Node 24 (`frontend/.nvmrc`) | `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, upload `dist/index.html` |
| `dashboard` | ubuntu-latest | Python 3.12 | `sync_template.py --check`, `check_bundle_size.py` |

`dashboard` `needs: frontend` and consumes the uploaded bundle, so the staleness
comparison runs against the bytes CI just built. It installs **nothing** — both
scripts are stdlib-only. It is its own job because it needs Python and no Node,
where `frontend` needs Node and no Python.

### Why the pins are load-bearing

- **Node 24, from `frontend/.nvmrc`** (`node-version-file`). The single-file
  build is byte-reproducible for a fixed lockfile and Node major, not across
  them, and `sync_template.py --check` compares bytes. A diff after a Node
  upgrade is a signal to re-sync, not a bug.
- **Python 3.10 and 3.12** — the ends of the supported range in `pyproject.toml`.
  This is the matrix that catches the environment drift §4 documents.
- **`npm ci`, not `npm install`** — installs the lockfile exactly and fails when
  it disagrees with `package.json`.

### The two size gates

Both are **advisory + limit** (§10 has the policy and current numbers):

1. **Stale template** — `sync_template.py --check`. CI never writes the file; it
   fails and names the one command that fixes it.
2. **Bundle size** — `scripts/check_bundle_size.py` *projects* the generated size
   by arithmetic (template − marker + script wrapper + the committed sample
   payload) rather than running the pipeline, so it is fast and dependency-free.
   The *honest* measurement already exists in the `backend` job
   (`test_generated_dashboard_stays_under_budget` renders a real dashboard). The
   two are complementary: the fast one catches a dependency bloating the bundle
   on every PR; the slow one catches the serialiser growing.
   `tests/test_bundle_size_check.py` drives the failing path (a gate that cannot
   fail reports green forever) and pins the advisory strictly below the limit.

### What was deliberately left out

This repo ships as a wheel people `pip install` and run from a CLI; the only
things CI has to protect are that the analytics are right and the committed
artefact matches its source. So **no** Docker, deployment, release automation,
coverage upload, security scanning or dependency bot. Three narrower omissions:

- **No Windows leg** (though this is a Windows shop): doubles the matrix, and the
  one Windows problem on record (§4's collection crash) is a local-toolchain
  fault a green Windows CI would not have prevented. Worth adding once §4 item 1
  or 2 is done.
- **No extras-free leg** to prove the Prophet/SHAP degradation path: worth adding
  the day that path is changed, not a permanent second install of the heaviest
  dependencies to re-assert unit-tested behaviour.
- **No browser test**: the two behaviours below need a real browser and asserting
  them means Playwright, larger than the two facts justify.

### Known limitation
- **The byte-comparison is cross-platform on faith.** The template was built on
  Windows/Node 24 and `--check` runs on ubuntu/Node 24. Nothing in the build
  should be OS-dependent (Vite normalises paths; `sync_template.py` normalises
  CRLF on read), but if the first CI run fails `--check` with no frontend change
  in the PR, **that is the cause** — re-sync from a Linux build and commit.

---

## 10. Standing Hazards & Conventions

These recur across the whole project. They live here once, canonically, rather
than being restated in every feature section.

### The `analysisAvailable` rule — the most-repeated bug class

***An empty analysis section and an absent one mean different things, and the
payload cannot tell them apart.*** A pipeline run whose detector fired on nothing
and a CSV the detector never saw both arrive with zero anomaly rows — but "we
checked and found nothing" is a finding, and "nothing was checked" is not.

`App`'s ready state carries `analysisAvailable`: true for all three
`loadPayload()` sources and for a `payload` import, false for a `csv` import.
**The flag is held *beside* the payload, never added to it** — the JSON contract
describes a pipeline run, and a field meaning "this is not one" belongs to the
app, not `serialize.py`. It gates the anomalies section, the footer's
methodology note, the executive summary grid, and the export picker.

**Every new section that reads `config`, or derives a figure from
`forecasts`/`evaluations`/`anomalies`, must decide which it is doing:** rendering
an empty state for missing *data* (fine) or for a missing *run* (a false
assertion). This bug has been found three-plus times — `AnomaliesSection`,
`DashboardFooter`, the executive summary grid — each time it was a section
reading pipeline output unconditionally on the CSV route.

**Known open instance:** `AtAGlanceSection` still reports "Alerts raised: 0" on
an imported CSV. Pre-existing, same class, still wants the `analysisAvailable`
gate. **It should be the first thing the next import-adjacent PR picks up.**

### The two-tier size-budget policy

Every size gate is **advisory (warns, exit 0) + limit (fails)**. The project
grows; a gate that turns red on ordinary progress gets silenced, and a silenced
gate protects nothing.

| Gate | Advisory (current) | Limit |
|---|---|---|
| Generated dashboard | 2,160,000 | 3,000,000 |
| Committed template | 1,880,000 | 2,600,000 |

The advisory is the size the artefact *wants* to be — small enough to email and
quick to open from `file://`. **Raising an advisory as the project grows is a
normal part of the PR that crosses it.** Raising a *limit* requires an argument
in the PR that does it. Recent measured sizes: generated ~2.15 MB, template
~1.88 MB — headroom against the advisory is single-digit KB, so the next
non-trivial PR crosses it and prints the NOTE (by design).

**The lever when a *limit* is genuinely approached** is a custom Plotly partial
bundle (`plotly.js/lib/core` + scatter/bar/heatmap, roughly half of the current
1.42 MB), which also means revisiting `src/types/plotly.d.ts`. **Trimming the
payload is the wrong move — it is the contract.**

### The browser-verification instrumentation trap

The in-app Browser pane **does not composite frames when it is not displayed**,
so **every transitioned property freezes at its start value indefinitely** —
`getComputedStyle` reports an active element's animated state as its *start*
value permanently, while `matches()` confirms the rule applies. It looks exactly
like a style-invalidation bug and is not one. Inject
`* { transition: none !important }` before reading to resolve every state
correctly. Separately: reading `.js-plotly-plot` immediately after a navigation
counts charts mid-mount and under-reports; and `ThemeProvider` writes
`data-theme` in an effect, so a computed-style read in the same tick as a toggle
click reports the *previous* theme (the same one-render-stale fact
`useChartPalette` exists for).

Screenshots often cannot be taken at all (the pane must be displayed to
composite). Drive verification through `javascript_tool` against the real DOM /
file input; DOM assertions are the reliable instrument.

### Still owed: one real-browser pass

Two behaviours have never been verified in a real browser because the pane
cannot exercise them — it delivers a *trusted* keydown to a focused control but
never performs the default activation, and it changes the viewport without
dispatching `resize` (its `ResizeObserver` never fires):

- **Keyboard *activation* of a rail button** (Enter/Space). The elements are real
  `<button type="button">`, the behaviour is the HTML spec's, and it is
  jsdom-tested — but unseen in a real browser.
- **Live resizing.** A fresh load is correct at every width tried
  (375–1440px); only *resizing after load* is unverified, and it matters because
  the ranked charts' heights are computed.

CI cannot supply this (it would mean Playwright). It remains a manual pass.

### The two clones on the work machine

```
Documents\GitHub\call-analytics-forecasting-dashboard   the current clone
Desktop\call-forecast                                   STALE (behind, no ImportPanel)
```

`Desktop\.claude\launch.json` points `preview_start` at the **stale** Desktop
copy, so a browser verification from the default config silently exercises an
old checkout — this has cost verification passes. Reach the correct tree via the
`github-clone-dashboard` configuration (it uses a **relative** `--prefix`
because an absolute path containing spaces fails to spawn). Two clones both
syncing through OneDrive is also a file-lock hazard (§6). The Desktop copy was
left untouched pending a decision.

### Recurring UI conventions

- **Colour is never the only signal** (§6). Every toned card/marker states its
  finding in words; selection is carried by weight, surface, border and bar
  together, never hue alone.
- **`--muted` fails AA for small text.** Measured: `--muted` on `--surface` is
  ~3.5:1 light — under AA at 12px. Labels use `--ink2` (~7.7:1 light / ~9.7:1
  dark) instead; the recession a label needs comes from size, weight and
  uppercasing, none of which cost contrast. The series hues are tuned for a plot
  area against a line, not for text on the page background — the landing hero and
  the primary button use `--seq-4` / `--ink2`, measured ≥5:1.
- **`Callout` takes `children: string`** — prose with no inline emphasis or
  links. A `ReactNode` overload is the change when a callout needs a link.

---

## 11. Feature History (Phase 2 & 3)

Condensed. Each entry keeps the load-bearing rules and traps; per-PR test
counts, byte sizes and dev-server transcripts have been removed (see the header
note). All of these are **frontend only** unless stated — no Python source
changed, no payload field added, `SCHEMA_VERSION` untouched — and each re-synced
`call_forecast/assets/dashboard_template.html` per §6.

### Dashboard State Consistency (`feature/dashboard-state-consistency`)

PR 7 made the rail a filter; three sections had not learned to answer to it, so
selecting *Daily cost* left volume tiles and whole-run alert counts standing.

**`src/lib/selectionView.ts` is the fix and the point.** `selection.ts` answers
"what did the reader choose"; this answers "what does that choice mean for the
payload". Five pure functions — `trimDaily`, `trimHorizons`, `headlineRollup`,
`isAnomalyVisible`, `selectAnomalies` — payload in, payload-shaped value out.
Three sections read it, so the filter lives once rather than being copied
(two copies of a filter is how a cost tile ends up above a volume page).

- **`AtAGlanceSection`** gates each forecast tile by the same `isTargetVisible`
  every section uses; the alert tile reads `selectAnomalies`. "Calls in period"
  deliberately does not filter — it is an ingestion fact.
- **`AnomaliesSection`** scopes the timeline, tally and disclosure through the
  *same* call the tile makes, so they cannot disagree. The observed volume line
  stays whole (it is history, and the markers need something to sit on).
- **`DataQualitySection`** still does not filter — every advisory is a property
  of the ingested dataset — but a selection changes the banner *wording* so a
  reader does not read an unfiltered section as an unresponsive one.

Two decisions worth knowing: anomalies bind to a target through `metric`, and
`overnight_activity` reports `overnight_calls` (a run property), so a target
selection drops it. And `headlineRollup(forecast, horizon, 30)` prefers 30, falls
back to the longest rollup at or under the chosen horizon, and returns the
*row* — the caller writes its label from that row, so "next 30 days" and the
number cannot drift. `selectAnomalies` returns its input by identity under "All".

### Navigation UX (`feature/navigation-ux`) — the direct prior art for nav work

Made the report feel like an application. No new dependency, state or component;
the PR 7 selection flow is untouched. Everything is CSS, one keyboard handler
and one link.

- **The transition is the mount, not a transition component.** Filtering already
  unmounts a card, so the "page changed" DOM event exists; `Card` and `Section`
  animate on mount (opacity + `--motion-rise` 4px travel over `--motion-base`).
  Cards a selection *changes* animate; sections it does not touch never remount
  and so never move — motion means "this changed". **Only `opacity` and
  `transform` animate**, anywhere: height/margin/padding would reflow a column
  under a chart that has already measured itself. `cardEnter` ends on
  `transform: none` (not `translateY(0)`) so the card is not left a containing
  block.
- **The active indicator is `background-size` on the button itself.** A
  background paints no box and takes no space, so the bar grows from nothing to
  full height with the label pinned (the old `border-left` + `padding-left`
  jittered the label 1px per selection). `background-color`/`background-image`
  are set separately — the `background` shorthand is never used on `.tab`, or a
  `:hover` would erase the bar. Below 900px the bar becomes a widening underline.
- **The bold label's width is reserved on every tab** via a zero-height,
  `visibility: hidden` `::after { content: attr(data-label); font-weight: 600 }`.
  Selection bolds the label and bold text is wider; in the ≤900px strip, where
  tabs size to content, selecting one would otherwise shove the rest sideways.
- **Keyboard: arrows added, tab order untouched.** Arrow Up/Down/Left/Right,
  Home, End move focus across the rail, wrapping. ***This is deliberately not the
  ARIA tabs pattern*** — there is no roving tabindex, so Tab still walks the rail
  one button at a time (PR 7's Tab-order test keeps passing). **Arrow keys move
  focus; they never select. Enter and Space commit.** Buttons are read off the
  DOM inside the handler (their DOM order *is* the focus order), not tracked in a
  parallel ref array. `preventDefault()` is called only once a key is known to be
  handled, so Home/End still scroll the page when the rail is not what is being
  driven.
- **The skip link, and the trap in it.** `main` is `id="report" tabIndex={-1}`,
  with a "Skip to report" link first in the tab order. `tabIndex={-1}` is what
  makes the jump move *focus* (without it the browser scrolls to the fragment and
  leaves focus on the link). ***The default action would clear the reader's
  model selection*** — the fragment *is* the selection, and following `#report`
  writes a fragment that parses to no target. `skipToReport` calls
  `preventDefault()` and `main.focus()` directly (focus does both jobs the
  default would, including the scroll); `href` stays `#report` for assistive
  technology. The link is visually hidden by clip-and-translate, never
  `display: none` (which is not focusable and so cannot be a skip link).

### CSV Import Workflow (`feature/csv-import`, GitHub #13)

**A raw call CSV cannot produce forecasts, and the payload is not a dataset.**
`DashboardPayload` carries forecasts, evaluations, SHAP, anomalies and Erlang-C
scenarios — producing those *is* the Python package, and reimplementing it in
TypeScript would be a second forecasting stack that silently disagrees. So the
import has **two routes**, visible to the reader:

```
my_export.csv        -> descriptive sections only, with a note saying why
dashboard_data.json  -> every section, full fidelity
```

The CSV route fills `daily`, `hourly`, `ingestion` and leaves the analysis maps
empty — which needed **no new conditional logic**: every analysis section already
returns `null` when its data is absent (§8 convention). The JSON route is the
existing contract re-entering through the front door. `analysisAvailable` (§10)
was introduced here.

- **The parser (`lib/import/`) is a hand port of `ingest.py`** — `_COLUMN_ALIASES`
  verbatim, `parse_duration_to_seconds` (incl. `m:ss`/`h:mm:ss`), `parse_currency`,
  and the zero-call-day rule (`call_volume: 0`, `total_cost: 0`, but
  `avg_duration_sec: null` — the mean of no observations is undefined). **No new
  dependency:** the RFC 4180 tokenizer is hand-written (quoted fields, `""`
  escapes, embedded commas/newlines, CRLF, BOM, throw on unterminated quote).
- **`crossValidation.test.ts` is the test that matters.** The committed fixture
  is the pipeline's own output over `examples/sample_export.csv`; feeding that
  same CSV to the TypeScript path and diffing is a real two-implementation
  comparison. If it fails after a `buildFromCsv` change the port has drifted; if
  it fails after the fixture is regenerated, port the Python change rather than
  relaxing the tolerance.
- One deliberate divergence from Python: a duplicate header is an **error** here
  (Python silently takes the first), because a one-shot browser import has no
  ingestion report to surface it in later.
- The CSV route builds a placeholder `ConfigSummary` — all zeros. Nothing reads
  it on that path today because every section that would is omitted, but **a
  future section that reads `config` unconditionally must check** (this warning
  came true twice — see Import Experience below, and §10).

### Export Center (`feature/export-center`)

**An export is a *view* of dashboard state, never a second read of it.** Each
format walking the payload its own way would produce a second serialization
stack that disagrees with the page. The registry is the single pass every format
draws from:

```
payload + Selection + palette
  -> registry.buildAnalyticExports()      one pass, three views
       table   -> csv.ts    one file per analytic
       json    -> json.ts   one file per request
       figures -> png.ts    one file per figure
```

Selection is applied by **the same functions the sections use** —
`isTargetVisible`, `trimDaily`, `trimHorizons`, `selectAnomalies`. PNG reuses the
pure builders in `lib/chart/figures/` verbatim, so "preserve theme" is
architectural rather than a thing to remember.

- **CSV carries raw payload numbers** via `String(n)`, never `toFixed` —
  `lib/format.ts` is *display* formatting and a CSV built from it is not
  machine-readable. `null` stays an empty field. One CSV per analytic with a
  leading `target` column (so a script reading one reads both single-model and
  All-Models). Exports carry full data, not the UI's display caps (those are
  pagination, not selection).
- **PNG uses `Plotly.toImage`** (`{data, layout}` off-screen, no ref registry of
  mounted charts). ***The exported figure's background is stamped from
  `palette.surface`*** — on-screen figures are transparent because the card
  supplies the background, and there is no card in a PNG, so an unstamped
  dark-theme export reads as black-on-black in a light document. Resolution is
  `PNG_SCALE: 2` over `PNG_WIDTH: 1000`; the figure's own `layout.height` is
  reused, not recomputed.
- **State is unchanged.** `ExportContext` is `{ payload, selection,
  analysisAvailable, palette }` — all four already held by `App`; the palette
  comes from `useChartPalette()`, not `mode` (§8 trap). Exporting never writes to
  the hash. A stale outcome clears on target *and* horizon change (§10
  fabricated-agreement). `availableAnalytics()` drops `requiresAnalysis` and
  empty-slice analytics, so a CSV import offers only what it has.
- The success notification is announced from a **persistently rendered**
  `role="status"` region (a live region inserted already carrying its message is
  not reliably announced); failures live in a separate `role="alert"`.
- **PDF and ZIP declined** — a PDF means jsPDF/pdf-lib in a bundle already near
  the advisory. That is a size argument for its own PR. Format memory is in
  `sessionStorage` (session, and the *format* only — pre-ticking analytics would
  put unwanted files in downloads); the read is try/caught (a `file://` page can
  throw on storage access).

### About & Documentation (`feature/about-documentation`)

**Documentation is a view, not a section.** The docs replace the report inside
the same `AppShell` — same header, provenance line, theme, page frame; only the
rail and content region change. The report's sections are therefore *unmounted*
while docs are open (PR 7's filtering choice in a new place: an absent chart
cannot be measured at zero width; returning remounts every chart fresh).

***The routing trap — the thing most likely to be broken later.*** The fragment
carried `model=`/`horizon=`; docs join it as `view=`/`page=`. **The two writers
share one fragment and neither may rebuild it.** `formatHash` originally composed
a fresh `URLSearchParams` from the selection alone — a docs writer doing the same
would delete `model=`/`horizon=` the moment docs opened, and a rail click would
eject the reader from docs. Neither throws; both silently lose state (the §10
failure mode). So `formatHash` gained an optional `base`, and `applyDocsRoute`
**merges** rather than formats — each writer deletes and rewrites **only the keys
it owns**. `base` is optional so the existing selection tests pass unmodified.
**There is still exactly one `useSyncExternalStore` subscriber:** `route` and
`navigate` are returned from `useHashSelection`, not a second hook.

The content model is data: `lib/docs/types.ts` is a closed `DocBlock` union
(paragraph, heading, list, callout, table, definitions, code, diagram, modelCard,
faq). Pages are plain values with no JSX. **No markdown renderer, and there will
not be one** — the structure is small and closed, so enumerating it is cheaper
than a parser; the block switch carries a `never` exhaustiveness check, so a new
kind without a renderer is a compile error, not a blank page. Prose carries no
markup (a stray backtick would render literally). Six pages: About · How a
prediction is made · Forecasting models (all six in `REGISTRY`) · How forecasting
works · Reading the dashboard · Data quality. `DocsBreadcrumbs` and prev/next
navigation exist here.

### External Integrations (`feature/external-integrations`)

An **External Resources** section in the sidebar (RetellAI dashboard, the repo,
the README), kept structurally apart from the model rail.

***The links are anchors, not buttons, and that is the whole safety argument.***
Everything else in either rail is a `<button>` because it filters in place; these
go to another origin, which is the contract an anchor makes. `<a href
target="_blank">` makes four requirements true by construction: they cannot
become a selected page (nothing sets `aria-current`), cannot touch URL state (an
absolute `https:` href replaces the document rather than editing the fragment —
so §11's skip-link collision cannot arise), keyboard access is the platform's,
and ***`moveFocus` cannot see them*** because both rails' arrow handlers read
`event.currentTarget.querySelectorAll('button')` and the section renders as a
sibling *outside* `.tabs`. `rel="noopener noreferrer"` — `noopener` denies the
opened page a `window.opener` handle, `noreferrer` keeps this dashboard's
`file://`/intranet URL out of a third party's referrer log (both matter more for
a mailed-around single file).

`src/config/externalLinks.tsx` is the **only** place these URLs appear; the
component maps over whatever it finds and returns `null` on an empty array.
`.tsx` because `icon` is a `ReactNode` — the three icons are inline 16px line
SVGs stroking in `currentColor` (the whole theming story), each `aria-hidden`.
Rendered in both rails from one component (`SideNav` below `.tabs`, `DocsNav`
below "Back to report"), always outside `.tabs`. Consequence: `SideNav` returns
`null` on empty `tabs`, so a run with no forecasts has no sidebar and therefore
no external links either — the existing rail fallback, left unchanged.

### Landing Experience (`feature/landing-experience`) — the entry gate

**The application opens on a welcome screen; the dashboard renders only once the
reader chooses to enter.** Before this, `loadPayload()` fell through to the
sample fixture, so the app opened onto twelve charts of synthetic data with
nothing saying so (§10's fabricated agreement, arriving *before* the dashboard).
The landing page renders no chart, table, tile or payload number.

***The gate is component state (`entered`), deliberately not a fragment key.***
Two writers already share the fragment; a third meaning "has this reader
entered" would put session state into a URL that gets emailed — the recipient of
`#entered=1` would skip a welcome screen they never saw.

**`lib/entry.ts` is the bypass and the whole interface between URL and gate.**
One pure function, `isDeepLink(hash)`, true when the fragment carries any of
`model`, `horizon`, `view`, `page` (the `VIEW_KEYS` union). A link someone was
sent names a view, and a welcome screen in front of it would break the
linkability the fragment exists for. Returned from `useHashSelection`, so still
one subscriber. A key added to `selection.ts`/`docs/route.ts` and forgotten in
`VIEW_KEYS` costs a deep link its bypass (reader sees the welcome screen once)
rather than corrupting state — which is why the union is one list.

***The gate is one-directional, and it had to be made so.*** `deepLink` is a fact
about the *current* fragment, which is cleared in ordinary use (selecting "All"
drops `model=`; leaving docs drops `view=`, both can empty it). A reader who
arrived on `#model=total_cost` and pressed "All" was therefore thrown back to the
welcome screen mid-session. **An effect latches `entered` the moment a deep link
is seen, and nothing ever sets it back to false** — one direction of travel, no
path that ejects a reader. Opening docs from the landing page also marks the
reader entered, so "Back to report" lands on the report.

Landing actions: **Import Dashboard** (`<button>`, enters then focuses the
`ImportPanel` — a flag, not a fragment anchor: a bare `#data-source` would
overwrite the selection, §11 skip-link trap in a third place; `Section` gained an
optional `id` and `App` scrolls+focuses in an effect, `scrollIntoView?.()`
optional because jsdom has no scrolling), **Open dashboard** (enters),
**Documentation & about** (opens the real in-app docs), **GitHub**
(`<a target="_blank">` from `externalLinks.tsx`), and **Recent imports** (the
placeholder Import History later filled). Contrast fixes: the primary button uses
`--seq-4` (~5.4:1 both palettes) not `--series1` (under AA), the hero eyebrow
`--ink2`; `#ffffff` on the button is the one deliberate colour literal (`--ink`
would invert to dark-on-blue in dark mode).

### Executive Summary Cards (`feature/executive-summary-cards`)

A reader can answer how many calls, at what cost, on which model and in which
period **before** reading a chart. A new `Executive summary` section between
`Data source` and `Data quality`. **Nothing below it changed**, and it
deliberately does **not** subsume `At a glance` — the tiles are the run's
descriptive headline, the cards the forecast's decision-relevant one.

**`lib/executiveSummary.ts` is a third layer built on the second** — every
horizon trim, anomaly scope and target-visibility test comes from
`selectionView.ts`, so a card and the chart under it cannot disagree. Pure:
payload in, `ExecutiveMetric[]` out. Eight cards; seven read straight from the
payload. `headlineRollup(forecast, horizon, 30)` is shared with the at-a-glance
tiles so the card and the tile below quote one row.

***One card is derived — "Largest predicted change" — and the derivation is the
smallest one possible.*** It divides two numbers Python produced (the forecast's
per-day figure over the horizon, and the observed per-day figure over the same
number of trailing days) and reports the percentage. No model, fit, smoothing or
trend estimator. Guards, each a test: a zero baseline is skipped (not `+∞%`); a
window with fewer than `max(3, days/2)` observed values produces no baseline
(`avg_duration_sec` is null on 59% of real days); targets compare on **relative**
change (seconds, dollars and calls cannot be ranked by absolute movement).
**`serialize.py` emits no growth/trend field** — if a *real* trend is ever wanted
it belongs in Python beside `forecast.py` and `growthMetric` should be deleted
the day it arrives as a payload field.

Two cards are honest about what they are not: **Highest risk period** is
*historical* (`anomalies.py` scores observed days; nothing scores a future
period), labelled `(observed, not forecast)`, ranked on critical days with
warnings only as a tiebreak. **Highest confidence model** ranks on MASE (what the
pipeline selects on) — a null-MASE row is a *skipped* model that may be named but
never wins, and the `good` tone is carried only when MASE < 1.

The card is **not a `StatTile`** — a tile is a headline number and cannot express
"this could not be computed, and here is why", which is a requirement here.
A card the rail removed is *absent*; a card the payload could not fill is
*present* with an em dash and a sentence naming the missing dependency. The grid
is a real `<ul>` (`auto-fit`, 240px floor). Labels use `--ink2` (§10 contrast).

### Import Experience & XLSX (`feature/import-experience`) — the bug report that was not one

A real customer export imported and the dashboard "looked empty". **The parser
was correct and always had been** (172 rows read, 172 kept). Three things had
stacked into one impression of failure:

1. **By design** — a raw CSV has no forecasts/models/SHAP/anomalies; those
   sections correctly returned `null`.
2. **An executive-summary regression** — all eight metrics derive from pipeline
   output, so a CSV resolved every one to `value: null` and the first thing after
   a *successful* import was eight em-dashes. The per-card "unavailable" reason
   was designed for a run that skipped a target; it is the wrong shape for "no
   run happened", which is one fact about the whole payload. Replaced by a single
   sentence on that route.
3. **The footer bug the CSV PR predicted** — `DashboardFooter` read `config`
   unconditionally, and on the import route that config is all zeros, so it
   published "Interval level: 0% · simulated from 0 trajectories · 00:00–00:00" in
   the voice of the report's own methodology note. Gated now on
   `analysisAvailable` (§10).

**Four parser bugs found by auditing `lib/import/` against `ingest.py`** (none
touched the reported file): `MAX_BAD_TIMESTAMP_SHARE` was `0.2`, is `0.05`
(`config.py:69` — the importer had been 4× more permissive than the pipeline);
`parseDurationToSeconds('2:')` returned `120` (`Number('')` is `0` where
`float('')` raises), now `NaN`; duration range checks (null over 4h or below 0,
`ingest.py:522`) and cost range checks (null over $100 or below 0, *before* the
blank-cost `fillna(0)`) were absent, now ported. A value failing a range check
nulls the *value*, not the row. **Tightening the timestamp threshold is a real
behaviour change** — a badly-malformed file that imported before may now be
refused, naming the count, share and limit. `crossValidation.test.ts` passed
unchanged through all four. **De-duplication is deliberately still not ported**
(Python de-dupes a directory; a browser reads one file and replaces the payload
wholesale) and the docblock now says so.

***The remount that ate the success confirmation.*** `AppShell` rendered `main`
as a direct child without a rail and as a wrapper's child with one; React
reconciles by position and type, so the rail appearing/disappearing changed the
tree shape and **remounted the entire report**. A CSV/XLSX import is exactly that
transition (imported payload has no targets → `tabs` empties → rail goes), so
`ImportPanel` set its success state and was destroyed in the same commit. The
wrapper is now unconditional with a `.layoutNoNav` modifier collapsing it to one
column; `main` holds its position. A PR-13 test had been *documenting* the
remount as expected behaviour in a comment — it now asserts the panel stayed open.

**File formats — `.xlsx` via `read-excel-file` (the first new runtime dependency
since the migration).** `readXlsx.ts` is thin: workbook → `string[][]` → the
existing `buildFromCsv`, so column mapping/parsing/rollup stay one audited
implementation. Only the first worksheet is read. Chosen over SheetJS (`xlsx` is
oversized and no longer publishes to npm; `exceljs` ~8× larger for read-only).
***The one real surprise is Excel's:*** the CSV writes `Call Duration` as `M:SS`,
but whatever produced the `.xlsx` let Excel read `"1:29"` as 1h29m, so every
duration lands with `:00` seconds — a zero-seconds cell is re-read as `M:SS`, a
genuine nonzero-seconds cell trusted as `H:MM:SS`. The unrecoverable case (a real
multi-hour call with exact minutes and seconds) does not occur for phone calls,
but is the first thing to suspect if xlsx durations ever look wrong by 60×.

Import UX (on PR-12's drag&drop / keyboard / `aria-live` / `aria-busy` base):
an indeterminate spinner with a per-stage label, a check-that-draws success state
naming the file and rows kept. **Progress is stages, not a percentage**
(`ImportStage` + `IMPORT_STAGE_LABELS` in `types.ts`) — a percentage animated to
look like work would lie about a duration nobody can predict; `decoding` exists
only for `.xlsx`. Errors render `ImportProblem.message` verbatim plus guidance,
never "Import failed." The file input's `aria-label` derives from
`ACCEPTED_EXTENSIONS`.

### Import History (`feature/import-history`)

A reader can reopen a dataset imported earlier without choosing the file again.
Entirely client-side (`localStorage`). The brief said "sidebar section"; this
project's sidebar is the model rail, and §11 (Landing) had reserved a `Recent
imports` placeholder — resolved (by asking) as **both**: fill the landing slot
*and* render the same shared component in the report's data-source area. One
component, two hosts.

***The load-bearing decision: entries carry the whole `DashboardPayload`, not a
file handle.*** A browser cannot re-read a dropped file later, and reopening must
restore the dashboard exactly as if just imported. So the history is **capped**
(`MAX_HISTORY_ENTRIES = 8`) and the writer **evicts under quota pressure**
(payloads are ~130–275 KB; `localStorage` is a few MB). `analysisAvailable` is
stored **beside** the payload in each entry (§10 — a reopened CSV must stay a
CSV).

Three layers: `types.ts` (contract, storage key namespaced like the theme key,
version, cap); `storage.ts` (every access try/caught — a `file://` page with site
data disabled *throws* on read; tolerates corrupt JSON, truncated blob, bad row,
version mismatch discarded whole; `saveHistory` returns **what actually
persisted** after quota eviction, so the UI never claims to remember a dataset
that did not survive; quota matched by name/code, **not** `instanceof
DOMException`, which fails across realms); `useImportHistory` (one owner, called
once in `App`, methods as props — `record`, `reopen`, `remove`, `markActive`;
a file's identity is a signature of its observable fields, so re-importing updates
one row).

`RecentImports` renders no heading (both hosts supply their own).
`variant="landing"` shows the rich empty state; `variant="panel"` one muted line.
Reopen/Remove carry distinct `aria-label`s. The current row has a left band, the
word "Current", *and* `aria-current` (§10 — never colour alone). Wiring: import
records to history through the same `handleImport`; reopen restores through the
same `setState` and enters; remove only forgets the row. **Restore-on-load is
gated on `source === 'fixture'`** — `inline`/`fetch` are a real run and must not
be silently replaced; when a real run loads over stale history, `App` calls
`markActive(null)` so no badge sits on a row that is not on screen (§10). *(One
product decision worth revisiting: in the shipped single-file `source` is
`inline`, so a reader's import does not survive a restart of that file.
Deliberate, flagged.)*

### Import Preview (`feature/import-preview`, GitHub #21)

Before an import replaces the loaded dashboard, the reader confirms it is the
right one — Dashboard Name, Generation Time, Forecast Horizon, Available Models,
Reporting Period, Dataset Size. **The preview *step* already existed** (a
`'preview'` stage with Import/Cancel that validates and never partially imports);
this enriches it rather than inserting a second flow. **Five of six fields
already lived in the payload** — no schema change. **Dashboard Name has no
payload field and by decision is the imported file name** (works for CSV and JSON;
a real title would be an optional payload field with a file-name fallback).

`lib/import/previewMetadata.ts` — `buildPreviewFields(preview, payload)` returns
six `PreviewField`s (`{label, value, available}`), display-ready, never empty.
Pure. ***The load-bearing decision is that the forecast-only fields branch on
`preview.kind`*** — a CSV carries `config: placeholderConfig()` (all zeros) and a
`generatedAt` stamped at import time; reading those as facts is exactly the footer
bug above. So for `kind === 'csv'`, Generation Time / Forecast Horizon /
Available Models carry an honest *"Not applicable — raw CSV has no forecast run"*
(`available: false`, muted + italic), never a fabricated zero. Reporting Period
and Dataset Size are true for both routes. The module degrades a hand-crafted
JSON missing `config`/`evaluations` to `Unknown` rather than throwing. Rendered as
a bordered `<dl>` grid above the existing ingestion detail; labels `--ink2`
(§10), placeholders `--muted` + italic.

---

## 12. Phase 3 remaining / open threads

- **`AtAGlanceSection` "Alerts raised: 0" on an imported file** — §10's known-open
  `analysisAvailable` instance, three-plus PRs old, the first thing an
  import-adjacent PR should pick up.
- **The human-readable dashboard summary**, import animations beyond the current
  spinner, the Forecast Insights panel and a desktop application are all still
  unbuilt.
- **Restore over `inline`** — if a reader's import *should* survive a restart of
  the shipped single-file, the restore gate is the one line to change (weigh the
  redeploy-shows-stale-import tradeoff first).
- **The two clones on the work machine** (§10) are still both present and still a
  file-lock hazard.
- **One real-browser pass** for keyboard activation and live resizing (§10) is
  still owed.
- **Bundle headroom** against the advisory is single-digit KB (§10) — the next
  non-trivial PR crosses it and prints the NOTE, by design.
