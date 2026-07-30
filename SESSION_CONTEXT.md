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

**Active work.** Migrating the HTML dashboard to React. **Migration PRs 1–9 are
done** — payload contract, frontend scaffold, primitives + non-chart sections,
the Plotly base plus the three forecast charts, the remaining five charts,
single-file bundling with pipeline integration, the interactivity the Python
page could not do, the cutover, and CI. **As of PR 8 React is the default
renderer**: a plain `python -m call_forecast run` writes the React
`reports/dashboard.html` (1.95 MB, against 5.08 MB from the Python renderer).
The legacy renderer is retained behind `--legacy-dashboard` for one release
cycle. PR 9 adds `.github/workflows/ci.yml`, which is what now holds the
committed template to its source. The migration is complete; §9 has the CI
architecture and §5 the remaining product work.

**Phase 2 is under way.** PR 10 — dashboard state consistency — is in §10, on
`feature/dashboard-state-consistency`. PR 11 — navigation UX — is in §11, on
`feature/navigation-ux`. PR 12 — the CSV import workflow — is in §12, on
`feature/csv-import`. All three are frontend only.

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
│   │   ├── components/sections/    # all nine: data quality, at a glance,
│   │   │                           #   forecasts, monthly cost, arrivals,
│   │   │                           #   model comparison, explainability,
│   │   │                           #   anomalies, scenarios
│   │   ├── components/charts/      # PlotlyChart wrapper + useChartPalette
│   │   ├── lib/chart/      # palette, baseLayout, sizing, pure figure builders
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
│   └── check_bundle_size.py # 2 MB budget on the generated dashboard (§9)
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
payload and the manifest are all already on disk by then.

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
- 263 unit tests + 18 doctests pass (257 before PR 9, 241 before PR 8).

**Update, PR 6.** The collection crash below **did not reproduce** on this run:
`python -m pytest tests/ -q` collected and passed all seven files plus the new
`test_react_dashboard.py` — 241 tests in 7m13s — on the same versions named
below (pytest 9.1.1 · numpy 2.4.6 · pandas 3.0.5) in `~/.venvs/callforecast`.
Nothing was changed to fix it, so treat it as intermittent or interpreter-
specific rather than resolved, and leave the two remedies in place.

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
- Minute-resolution timestamps + no call ID → cross-file de-duplication matches
  on content plus within-file position. A call ID would make this exact.
- Erlang assumes Poisson arrivals; real traffic is burstier, so estimates are
  mildly optimistic.
- `scenarios.*` defaults (1 agent, 9h, 80%-in-30s, 100s patience) are
  placeholders. The staffing column is fiction until they are set.

### Technical debt
- `dashboard.py` is ~1,440 lines and does layout, theming and figure
  construction. As of PR 8 most of it is the *legacy* renderer, scheduled for
  removal after one release cycle — so the "split figures from HTML assembly"
  refactor in §7 item 4 is now probably wasted work. Delete rather than split,
  once the release cycle is up. **`THEME` and `_stylesheet` must survive that
  deletion**: `scripts/gen_tokens.py` generates `frontend/src/theme/tokens.css`
  from `THEME`, and `tests/test_tokens.py` imports both.
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
- Hand-edit `call_forecast/assets/dashboard_template.html`. It is a build
  artefact; `scripts/sync_template.py` is its only writer. Change the frontend
  and re-sync.
- Check self-containment of the React output with a regex. The page is 1.6 MB
  of minified JS containing the strings `src=`, `href=` and `<script>`; parse
  it with `html.parser` and look at real tags.

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

4. ~~**Split `dashboard.py` into `dashboard/figures.py` and
   `dashboard/layout.py`.**~~ **Superseded by PR 8.** The bulk of that file is
   now the *legacy* renderer, retained one release cycle and then deleted, so
   splitting it is work with a scheduled expiry date. Delete instead when the
   cycle is up — keeping `THEME` and `_stylesheet`, which `scripts/gen_tokens.py`
   and `tests/test_tokens.py` depend on.

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

10. ~~**Add GitHub Actions CI.**~~ **Done in PR 9** — see §9. Delivered smaller
    than described here: Python 3.10 and 3.12 on `ubuntu-latest` only, and no
    extras-free leg. Both reductions are argued in §9 under "What was
    deliberately left out"; the extras-free leg in particular is still worth
    adding the day the graceful-degradation path is changed.

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
Their entries left `PendingSections.tsx` listing only chart-bearing work; PR 5
took the rest and the file with them.

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

**PR 5 — the remaining five charts** (this branch). Monthly cost, arrivals
heatmap, model-comparison leaderboard, feature importance and the anomaly
timeline. `PendingSections.tsx` is deleted: all nine sections of
`build_dashboard()` now have a React counterpart, and 12 figures render on the
sample payload — the same 12 the Python dashboard builds from it. 63 new
frontend tests, taking the suite from 10 to 73.

*Nothing in the PR 4 chart layer changed*, which was the design goal — each
chart is a pure builder under `lib/chart/figures/`, exported from that
directory's `index.ts`, rendered through `PlotlyChart` with a palette from
`useChartPalette`. Three things were added *beside* it:

- **Palette roles.** `surface`, `critical`, `warning` and the seven-step
  `--seq-N` ramp, plus `seqColorscale()` for Plotly's `[[0, c], …]` form.
  `ChartPalette.seq` is an array, so `readPalette()` no longer fills the whole
  object from one loop over `ROLES` — scalars and the ramp are read separately.
- **`lib/chart/sizing.ts`.** `rankedSizing()` derives the two ranked charts'
  height from row count and their left margin from the longest label, and
  ellipsises anything past a 220px cap. `dashboard.py` hard-coded `margin.l` at
  170 and 220 against the labels that existed at the time; the label set is not
  fixed, and a too-narrow margin loses the *start* of a name with nothing to
  show it happened. Widths are estimated (7px per character at 12px system-ui),
  not measured — measuring means a canvas or a hidden node, which would make
  the builders impure for the sake of a margin the clamp already absorbs.
- **`Card` takes a `blurb`.** The port of the `<p class='blurb'>` the Python
  model-comparison and explainability cards open with. Not a `Callout`: those
  carry a severity icon and read as an aside; this is the card's own subtitle.

The five easy-to-drop `dashboard.py` fixes are all covered by assertions rather
than by having been looked at: category axis on the monthly chart and on the
heatmap, `constraintext: 'none'`, `yaxis.autorange: 'reversed'` for a
Monday-first week, and triangle/diamond markers with the severity named in the
legend text.

Two smaller decisions carried over and now tested: info-level anomalies are
absent from the timeline, and one marker is plotted per flagged *day* with its
y read off the volume line rather than off the rule's own `actual`.

Three builders return `null` rather than an empty figure — leaderboard when no
model scored, importance when no method did. That is the real
`avg_duration_sec` case on the 71-day export, where every learned model is
skipped below the `min_observations` floor: the section keeps its table, which
is what explains *why* there is no chart, and omits the plot.

`src/lib/chart/testPalette.ts` is a test-only stub shared by the figure tests.
Its values are role names, not hex codes — asserting on hex here would be a
second, unaudited copy of the palette that fails whenever a hue is retuned.

**Verified at 1440px** against a live dev server: nine section headings in
`build_dashboard()` order, 12 figures, zero horizontal page overflow, no
console errors. Specifically checked rather than eyeballed — `(partial)` bars
present on a category axis with full `$6.17` labels; hour ticks `"00".."23"`;
weekday ticks reading Mon→Sun top-down; no y-tick label extending past its
plot's left edge in any of the ranked charts (`Linear Regression (ridge)` and
`total_cost_roll7_vs_roll30` both render whole); triangle and diamond marker
paths on 32 critical and 58 warning days; and the toggle restyling the marker
halo from `#1a1a19` to `#fcfcfb`, which confirms `useChartPalette` resolves the
new roles through a theme change.

**Unverified.** Live resizing, unchanged from PR 4. The embedded browser used
to check everything else changes the viewport without dispatching `resize`, and
its `ResizeObserver` never fires — confirmed against a plain observer watching
an element restyled from 905px to 520px, which reported zero callbacks. A fresh
load is correct at every width tried (375px through 1440px, no page overflow,
SVG width equals container width). Live resizing needs a check in a real
browser, and it matters more now: the ranked charts' heights are computed, so
a resize path that discarded `layout.height` would collapse them.

**PR 6 — single-file bundling and pipeline integration** (this branch).
`python -m call_forecast run --react-dashboard` writes the React dashboard to
`reports/dashboard.html`. Without the flag nothing changes: the Python renderer
is still the default, still writes the same path, and its code is untouched.

```
5,082,765 B  reports/dashboard.html   Python renderer
1,946,364 B  reports/dashboard.html   React renderer  (-61.7%)
  1,671,089 B  of it the committed template
    275,235 B  of it the run payload
```

**How the two toolchains meet.** `frontend/index.html` carries one HTML comment,
`<!--dashboard-data-->`, immediately before `#root`.
`vite-plugin-singlefile` inlines the JS and CSS into a single `dist/index.html`
and carries that comment through verbatim; `scripts/sync_template.py` copies the
result to `call_forecast/assets/dashboard_template.html`, which is **committed**;
`build_dashboard_react()` substitutes the serialised payload for the comment and
writes the file. That is the whole mechanism. There is no Node at run time and
nothing that could introduce a network dependency.

A comment rather than an empty `<script id="dashboard-data">{}</script>`
placeholder, because `loadPayload()` checks the inline source first — a
placeholder would be *found* in dev and render an empty payload instead of
falling through to the fixture.

**The escaping was already done.** `serialize.dumps()` has escaped `<`, `>` and
`&` to `\uXXXX` since PR 1 for exactly this moment, so `build_dashboard_react()`
only has to use it rather than `json.dumps`. Verified end to end with an anomaly
message carrying `</script><script>alert('xss')</script>`: it round-trips
through `JSON.parse` byte-identical, and no raw `<` reaches the document. There
is a redundant guard in the renderer that raises if a `<` or `>` survives —
cheap, and the thing it protects against is HTML injection from free text.

*`build_dashboard_react()` takes the same arguments as `build_dashboard()`*, so
`pipeline.py` picks a name and changes nothing else. It builds its own payload
via `build_payload()` rather than reaching for the copy `_write_outputs()`
already made; that copy is not on `RunResult`, and rebuilding a dict is cheaper
than coupling the renderer to the CSV writer's internals.

**The committed template is the risk, and it is handled the way `tokens.css`
already is.** A generated file under version control goes stale silently:
change a component, check it in the dev server, commit without rebuilding, and
every later run renders the *previous* frontend while reporting nothing.
`scripts/sync_template.py --check` is the guard, deliberately the same shape as
`scripts/gen_tokens.py --check` — one writer, one check, one convention to
learn. It also refuses a build unfit to be a template at all: a missing or
duplicated marker, a surviving `src=`/`href=`, or a size over 1.7 MB. PR 9 wires
`npm ci && npm run build && python scripts/sync_template.py --check` into CI and
**must pin the Node version**: the build is byte-reproducible for a fixed
lockfile and Node major, not across them.

*Self-containment cannot be checked with a regex here.* The existing
`test_dashboard_is_self_contained` searches for `<script[^>]+\ssrc=` and works
against the Python renderer. The React page is 1.6 MB of minified JS containing
the literals `src=`, `href=`, `<script>` and `http://www.w3.org/2000/svg`, so a
substring or regex scan reports external dependencies on a page that has none.
Both the sync script and the new tests parse with `html.parser`, which treats
`<script>`/`<style>` content as CDATA. The generated file has exactly three
tags of interest: the module script, the style block, and the payload script.

**The size budget has little headroom.** 1.95 MB against 2 MB is 53 KB of
slack, and the payload is what varies — 275 KB on the 210-day sample, less on
the 71-day export, but more as history accumulates. Plotly is ~85% of the
template (1.42 MB of 1.67 MB); React, the app and CSS are the remaining ~250 KB.
When the budget is breached, the lever is a custom Plotly partial bundle
(`plotly.js/lib/core` + scatter/bar/heatmap, roughly half the size), which also
means revisiting the hand-written `src/types/plotly.d.ts`. Trimming the payload
would be the wrong move — it is the contract.

**Packaging.** `[tool.setuptools.package-data] call_forecast = ["assets/*.html"]`.
No `__init__.py` under `assets/`: package-data patterns already reach into
subdirectories, and an empty module would exist only to satisfy
`packages.find`. The template is addressed through `importlib.resources` rather
than `__file__`, so it resolves from an installed wheel. Verified by building
the wheel (664 KB, template present at full size) and installing it into a
clean venv with no Node and no frontend source.

**Verified from `file://`** with the network idle: 12 Plotly figures, the nine
`build_dashboard()` section headings in order, 17 tables, the model rail, the
inline payload script, no console output at all, and zero network requests
(the one recorded request is a `data:` URI, which is inline by definition).

**Tests.** 24 in `tests/test_react_dashboard.py`, over a trimmed run shared at
module scope: self-containment by parsed tags, the hostile-payload path, both
size budgets, `importlib.resources` reachability, the renderer's three error
paths, and the wiring — including an explicit assertion that
`run_pipeline`'s `react_dashboard` still defaults to `False` and that
`build_dashboard` is still exported, so PR 8 has to be a deliberate act. The
frontend suite is unchanged at 73; there is still no component test, which
remains a PR 9 decision.

**Unverified.** Layout at realistic widths, and live resizing — unchanged from
PR 5, and for the same reason. The embedded browser pins a `file://` page at a
265px-wide static snapshot and never fires `ResizeObserver`. PR 5 checked the
layout at 1440px against a dev server and PR 6 changes no component, so the
risk is that the *bundling* broke something layout-related, which is not a
failure mode single-file inlining has. Worth one look in a real browser anyway.

**PR 7 — interactivity the old page could not do** (this branch, on
`feature/dashboard-interactivity`). The model rail became a filter, the
forecast cards got a horizon selector, and both live in the URL. The Python
dashboard could do neither: it was a static string of HTML with a rail that
scrolled.

```
dashboard.html                              all three models, 90 days
dashboard.html#model=total_cost             cost only
dashboard.html#model=call_volume&horizon=30 volume, first 30 days
```

**The URL is the state, not a copy of it.** `useHashSelection` subscribes to
`location` through `useSyncExternalStore` — the same shape `useChartPalette`
uses for `data-theme`, and for the same reason: the browser owns the value.
Back, forward, a hand-edited fragment and a reload all change it without React's
involvement, and a `useState` mirror would have to be kept in step with each of
those paths separately. There is exactly **one** subscriber, `App`; sections
receive the parsed selection as props and never read `location`. Parsing and
formatting are pure functions in `src/lib/selection.ts`, tested without a DOM.

Three decisions here are load-bearing, and two of them are traps.

***`history.pushState` would have broken the shipped artefact.*** A `file://`
document has an opaque origin, and `pushState` with a URL throws a
`SecurityError` there — which is exactly how this dashboard is opened, as a
single self-contained page mailed to someone. Selection writes assign
`location.hash` instead, which works from `file://`, `http://` and the dev
server alike. The cost is a bare `#` left in the address bar when the filter is
cleared; `location.hash` reads back as `''` either way, so nothing downstream
can tell. **Do not "clean this up" with `pushState` or `replaceState`.**

***The fragment is `key=value` because a bare anchor would collide.*** The
forecast cards have carried `id="model-<target>"` since PR 4 — that is what the
rail scrolled to. `#model-call_volume` would therefore have scrolled the page on
every selection, including the ones that filter that very card away.
`#model=call_volume` shares no syntax with it, and `selection.test.ts` pins the
two apart so a future tidy-up cannot quietly merge them.

*Defaults are omitted from the fragment*, so an unfiltered dashboard has a clean
URL rather than `#model=&horizon=90`, and the default horizon is the **longest**
configured one — which makes the default render identical to PR 6's. That
property is the whole regression argument for the horizon work.

**What a selection filters** is every section that has a target: forecasts,
model comparison, explainability, and the monthly cost card, which is a
`total_cost` forecast and belongs to that target as much as the others do.
Leaving it standing under a volume selection would have put a cost card on a
page claiming to show volume only. Data quality, at a glance, arrivals,
anomalies and scenarios describe the whole run and never filter.

**Charts are unmounted, not hidden, and that is the fix rather than a
workaround.** A card filtered off the page is not in the DOM, so it cannot be
measured at zero width, and when it comes back it mounts fresh and measures
itself. `Plotly.Plots.resize()` — the obvious-looking answer, and the one the
PR brief offered as an option — is **wrong here**: it works by deleting
`layout.width` *and* `layout.height` and re-autosizing, and every figure sets an
explicit height, the two ranked charts deriving theirs from row count. A resize
path that discarded height would collapse them. `PlotlyChart` still measures its
container and passes width explicitly, unchanged from PR 4.

For the same reason `PlotlyChart` needs no queued-draw bookkeeping. An
unrendered element has a 0×0 border box, which `ResizeObserver` reports like any
other size, so a reveal delivers a notification even at an unchanged width; that
fires `drawRef.current`, which React has already re-pointed at the closure over
the *current* figure. A "deferred draw" flag was written during this PR and
removed on review — nothing read it, and its comment claimed a guarantee it did
not provide.

**The horizon is one dashboard-level value**, not one per card: every forecast
card renders a `HorizonSelect` bound to the same state, so the cards stay
comparable and the view stays linkable. The control is a native `<select>`
rather than a segmented button group — the options are mutually exclusive, and a
real select brings arrow keys, type-ahead and a correct accessible name that a
button group would have to reimplement as a roving-tabindex radiogroup to match.
It trims three things together and they must not drift: the chart's forecast
rows (`step <= horizon`), the rollup table (`days <= horizon`) and the daily
disclosure (`step <= horizon`).

**The rail.** Real `<button>`s, as before; a `<a href="#model=…">` was
considered and rejected, because a button fires on both Space and Enter and this
control filters in place rather than taking the reader to a document.
`aria-current` moved from `"true"` to `"page"` — the rail now genuinely changes
what page content is shown. `SideNav` prepends its own "All" tab rather than
`App` synthesising one: "All" never appears in `payload.targets`, because it is
a fact about having a filter control, not about the run. Buttons key off
`target`, so a selection change does not drop focus. A visually hidden
`aria-live="polite"` region announces "Showing Daily cost — Random Forest only."
— sighted readers get that from the tab's weight, surface and left bar, and a
screen-reader user gets nothing from any of those.

**Tests: 130 frontend, up from 73.** 25 for the pure selection contract, 9 for
the hook against a real `location`, 10 for the rail, 6 for section filtering and
horizon trimming, 7 for the chart lifecycle.

***This introduces the DOM test environment that §8's PR 9 line reserved.***
Keyboard activation, `aria-current` moving and a hidden chart redrawing on
reveal cannot be asserted against pure functions, and PR 7's brief required all
three. `jsdom`, `@testing-library/react`, `@testing-library/user-event` and
`@testing-library/jest-dom` are now devDependencies; `node` is still the default
environment and the 73 pure tests still run in it, with `.test.tsx` files opting
into a DOM via a `// @vitest-environment jsdom` docblock. `globals: true` is set
only so Testing Library's automatic cleanup finds an `afterEach` — without one
it silently does nothing and each test renders into the previous test's DOM.
**PR 9 should verify this choice in CI rather than re-decide it.**

**Verified against a live dev server at 1440px.** Selecting a target filters 12
figures to 6 (cost) or 5 (volume, where the monthly section goes too) and the
nine section headings to eight; "All" restores all 12; every revealed chart
redraws at its full container width with all six distinct figure heights intact;
loading `#model=avg_duration_sec&horizon=30` comes up already filtered with the
select at 30, one rollup row, 30 daily rows and 30 points on the chart; the back
button restores the previous view through the store subscription with no React
write involved; Tab reaches every tab in order; no console output; no page
overflow at a fresh 375px load.

**Unverified, and both are the embedded browser rather than the code.** Enter
and Space activation on a rail button: the browser delivers a *trusted* keydown
to the focused button but never performs the default activation, so no click
fires. The elements are real `<button type="button">`, the behaviour is the HTML
spec's, and `SideNav.test.tsx` asserts both keys — but it has not been seen in a
real browser. Live resizing, unchanged from PR 5 and PR 6: this browser changes
the viewport without dispatching `resize` and its `ResizeObserver` never fires,
which is directly observable here as charts keeping their old width until a
reload. A fresh load at any width is correct.

`call_forecast/assets/dashboard_template.html` was re-synced with
`scripts/sync_template.py`, per §6 — the frontend changed, so the committed
build artefact had to. 1,674,436 bytes against the 1,700,000-byte budget: 25 KB
of slack, down from 29 KB.

**PR 8 — the cutover** (this branch, on `feature/react-dashboard-default`).
React is the default renderer. The legacy Python page is retained behind
`--legacy-dashboard` for one release cycle. No frontend code changed; this PR
is entirely CLI, pipeline, docs and tests.

```
python -m call_forecast run                     1,807,371 B   React     (default)
python -m call_forecast run --legacy-dashboard  5,082,759 B   Python    (-64.4%)
```

Both numbers are from the real 71-day export. The React figure is below the
1.95 MB measured on the 210-day sample because the payload is what varies —
132 KB here against 275 KB there.

**The renderer choice is still one boolean, and the deprecation is the whole
design.** `run_pipeline` gained `legacy_dashboard: bool = False` and kept
`react_dashboard` as `bool | None = None`. That `None` is load-bearing: it is
what lets the function tell "not passed" (defer to `legacy_dashboard`) apart
from an explicit `True`/`False` from a pre-PR-8 caller, and an explicit value
still decides outright with its original meaning — `react_dashboard=True` picks
React, `react_dashboard=False` picks legacy, exactly as both did before. A
`DeprecationWarning` points callers at the new keyword. `legacy_dashboard=True`
together with `react_dashboard=True` is incoherent and raises `ValueError`
*before* any expensive work, rather than being silently resolved one way.
`README.md` documents `run_pipeline` under "From Python", so this is a public
signature and breaking it was not on the table.

The same shape on the CLI: `--legacy-dashboard` is new, `--react-dashboard`
still parses but is a documented no-op that prints a deprecation notice to
stderr. Keeping it alive is not politeness — scheduled tasks and `.bat` files
pass it, and `unrecognized arguments` would take a scheduler down for no gain.
The two flags sit in an `add_mutually_exclusive_group()`, so passing both is
argparse's error to report rather than ours to resolve. `Run_Forecast.bat`
passes no dashboard flag at all, so the double-click path picked up the smaller
dashboard for free.

***There is deliberately no automatic fallback from React to legacy.*** It is
the obvious-looking safety net and it is wrong here: a silent fallback would
emit a 5 MB page nobody asked for and, worse, would mask a stale or missing
committed template — the exact failure `scripts/sync_template.py --check`
exists to catch. The renderer logs at ERROR, names itself, states that the CSVs
are already written, and tells the operator to re-run with `--legacy-dashboard`
if they want the old page. Recovery is a decision, not a default.

**The failure isolation this PR was asked to guarantee already existed** — PR 6
wrapped the render call and put the manifest write after it. What PR 8 adds is
proof. Verified end to end by moving the committed template aside, which is the
realistic failure (a build artefact that never landed in a checkout or wheel)
rather than a synthetic raise: the run logged the ERROR, **exited 0**, and left
16 CSVs, `outputs/dashboard_data.json` and `models/manifest.json` on disk with
no `reports/dashboard.html`. The template was restored and
`sync_template.py --check` re-confirmed byte-identical.

**Tests: 257 backend, up from 241.** `test_react_dashboard.py` went 24 → 34 and
`tests/test_docs.py` is new (6). The two PR 6 tests that pinned the *old*
default — `test_run_react_dashboard_defaults_false` and
`test_run_pipeline_react_dashboard_defaults_false` — were written so the flip
could not happen by accident; their replacements assert the new default and say
so in their docstrings, which is the record that the flip was deliberate rather
than a loosened assertion. New coverage: renderer selection for all five
argument combinations, and failure isolation for *both* renderers asserting the
CSVs survive, `"dashboard"` is absent from `result.outputs`, the manifest is
still written, and the ERROR names the renderer.

*`pytest.warns(DeprecationWarning)` needed a `match=`.* Around a full pipeline
run a bare one is satisfied by any `DeprecationWarning` pandas or numpy happens
to emit, so it would have kept passing after our own warning was deleted. Both
call sites pin it to `react_dashboard`.

**The frontend is untouched and that is checkable, not asserted.** `npm test`
is unchanged at 130, `npm run build` reproduces `dist/index.html` at 1,674,436
bytes, and `sync_template.py --check` reports the committed template already up
to date — so PR 8 required no re-sync, which is the evidence that the cutover
was pure wiring.

**Verified** from `file://` on the real export: nine section headings in
`build_dashboard()` order, 11 figures, 16 tables, the rail carrying All plus
three targets, three horizon selects, the inline payload script, and no console
output. 11 rather than 12 figures because `avg_duration_sec` has every learned
model skipped below the `min_observations` floor on this data, so its
leaderboard and importance charts are correctly omitted — the PR 5 behaviour,
not a regression.

**Unverified, unchanged from PR 5–7 and still the embedded browser rather than
the code.** Live resizing and keyboard activation of the rail. PR 9 still owns
one pass in a real browser.

### Frontend architecture

**Stack.** Vite 7 · React 19 · TypeScript 5.9 · Plotly (cartesian dist) · CSS
Modules, with Vitest for unit tests — plus jsdom and Testing Library for the
component tests PR 7 added. No UI kit, no state library, no CSS framework, no
charting wrapper. Node is a **dev** dependency: end users still `pip install`
and run the CLI.

**Frontend tests.** `npm test` (`vitest run`), `src/**/*.test.{ts,tsx}`. Node is
the default environment and the figure-builder tests stay DOM-free — they are
pure, and keeping them that way is what makes chart behaviour assertable.
A `.test.tsx` file opts into jsdom with a `// @vitest-environment jsdom`
docblock on its first line and mocks Plotly, which cannot run there:

```ts
vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));
```

Two jsdom facts the component tests have to work around, both of which will bite
the next person: `clientWidth` is **always 0**, so a chart test must stub it on
`HTMLElement.prototype` to drive a reveal; and there is no `ResizeObserver` at
all, so one is installed on `globalThis` and fired on demand. Assigning
`location.hash` dispatches `hashchange` on a *task*, not a microtask — awaiting
a resolved promise is not enough to observe it.

130 tests as of PR 7.

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

**State.** No library, and three kinds of it, each owned in exactly one place.
The payload is immutable and arrives once, in `App`. Theme is `ThemeContext`,
read through `useChartPalette`'s DOM subscription rather than `mode`. Selection
— the rail's target and the forecast horizon — is the URL fragment, read through
the single `useHashSelection` subscriber in `App` and passed down as props. No
component reads `location`, and none keeps a second copy of any of the three.
TanStack Query becomes correct the day there is a live API, not before.

**Layout.** `grid-template-columns: var(--rail) minmax(0, 1fr)`. The
`minmax(0, 1fr)` is load-bearing — a bare `1fr` lets a wide table or chart force
the page into horizontal scroll. Below 900px the rail collapses to a
horizontally scrolling strip; the page itself never scrolls sideways.

### Remaining steps

**PR 9 — CI. Done**; the architecture is §9. It wires
`npm ci && npm run typecheck && npm test && npm run build`, then
`python scripts/sync_template.py --check` on a **pinned** Node 24, and pytest on
Python 3.10/3.12. PR 7's DOM test environment is verified rather than
re-decided: `npm test` runs all 130 tests, jsdom docblocks included, on a
machine that is not this developer's.

**Still outstanding, and not a CI job.** The two behaviours PRs 5–8 could not
verify — keyboard activation of the rail, and live resizing — still want one
pass in a real browser. CI cannot supply it: both failures are properties of a
real browser's event loop, and asserting them in headless CI would mean adding
Playwright, which is a larger commitment than the two facts justify.

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
- **Selection is the URL fragment, read in `App` and nowhere else.** A section
  that needs to know what is selected takes it as a prop. Filtering unmounts a
  card; it never hides one with `display: none`, which would put chart
  correctness back on the `ResizeObserver`.
- `frontend/README.md` has the workflows, including regenerating the fixture
  (which comes from `examples/`, never from `data/` — it is committed).

---

## 9. Continuous Integration

**Added by PR 9** (branch `feature/github-actions-ci`). One workflow,
`.github/workflows/ci.yml`, on `pull_request` and on `push` to `main`. Nothing
in this PR touches application code: it is validation only.

### The four questions

CI exists to answer these, in the order a regression would be noticed:

```
Every PR
   |
   +-- Can Python still generate correct analytics?   backend    (2 legs)
   +-- Can React still compile?                       frontend
   +-- Can the offline dashboard still be built?      frontend
   +-- Did someone forget to regenerate the template? dashboard
```

### Jobs

| Job | Runner | Pinned to | Runs |
|---|---|---|---|
| `backend` | ubuntu-latest | Python 3.10, 3.12 | `pip install -r requirements.txt`, `pytest tests/`, doctests |
| `frontend` | ubuntu-latest | Node 24 (`frontend/.nvmrc`) | `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, upload `dist/index.html` |
| `dashboard` | ubuntu-latest | Python 3.12 | `sync_template.py --check`, `check_bundle_size.py` |

`dashboard` `needs: frontend` and consumes the uploaded bundle, so the
staleness comparison runs against the bytes CI just built rather than a second
rebuild in a second environment. It installs **nothing** — both scripts are
stdlib-only, which is why that separation is cheap.

**Why `dashboard` is its own job and not two more steps on `frontend`.** It
needs Python and no Node; `frontend` needs Node and no Python. A PR also gets a
clearer answer from a red "Dashboard artefact" than from a build job that failed
at some step after the build.

### The two migration safeguards

**Stale template.** `python scripts/sync_template.py --check`, which has existed
since PR 6 and had no enforcement until now. The failure it catches: change a
component, confirm it in the dev server, commit without re-running the sync —
after which every `python -m call_forecast run` renders the *previous* frontend
and nothing anywhere reports a problem. **CI never writes the file.** It fails
and names the one command that fixes it. Verified by injecting a mutation into
the committed template: exit 1 with "the committed template does not match the
current frontend build", and clean again after `git checkout`.

**Bundle size.** New `scripts/check_bundle_size.py`, enforcing 2,000,000 bytes
on the *generated* dashboard with a message that states current size, allowed
size, the overage and the likely causes in order. It never fails silently — and
`tests/test_bundle_size_check.py` (6 tests) drives that failing path, because a
gate that cannot fail reports green forever and stops being read. Those tests
also pin the script's budget to the 2,000,000 the render test asserts, and its
marker and script wrapper to `dashboard.PAYLOAD_MARKER`, so the projection
cannot quietly stop modelling the substitution it claims to model.

The interesting part is that it does not run the pipeline. Rendering is a single
string substitution (`build_dashboard_react`), so the generated size is
arithmetic: template, minus the marker, plus the script wrapper, plus the
payload. Substituting the committed 210-day sample payload — the largest the
project has — projects **1,949,710 bytes against PR 6's measured 1,946,364**, a
0.2% error, in milliseconds and with no dependencies.

That is the *cheap* check. The honest one already existed and still runs, in the
`backend` job: `test_generated_dashboard_stays_under_budget` renders a real
dashboard from a trimmed run and asserts the file itself. The two are
complementary — the fast one catches a dependency bloating the bundle on every
PR in seconds; the slow one catches the serialiser growing. Verified by
inflating `frontend/dist/index.html` by 108 KB: the size gate failed at 2.06 MB
and `sync_template.py --check` independently failed its own 1.7 MB template
budget. `npm run build` restored the byte-identical bundle.

### Why the pins are load-bearing

**Node 24, from `frontend/.nvmrc`** (`node-version-file`, so `nvm use` and CI
read the same number). The single-file build is byte-reproducible for a fixed
lockfile and Node major, and is **not** guaranteed across majors — and
`sync_template.py --check` compares bytes. Bumping `.nvmrc` therefore means
re-running `scripts/sync_template.py` and committing the result *in the same
PR*. A diff after a Node upgrade is a signal to re-sync, not a bug.

**Python 3.10 and 3.12** — the ends of the supported range declared in
`pyproject.toml`, and nothing in between. This is the matrix that catches the
environment drift §4 documents.

**`npm ci`, not `npm install`** — installs the lockfile exactly and fails when
it disagrees with `package.json`.

### What was deliberately left out

The temptation on a CI PR is to build the whole platform. This repository ships
as a wheel that people `pip install` and run from a CLI; the only things CI has
to protect are that the analytics are right and that the committed build
artefact matches its source. So there is **no** Docker build, no deployment, no
release automation, no coverage upload, no security scanning and no dependency
bot. Each is defensible later and none of them is what a PR here is waiting to
hear.

Three narrower omissions, with reasons:

- **No Windows leg**, though this is a Windows shop. It doubles the matrix, and
  the one Windows-specific problem on record (§4's `access violation` during
  collection) is a *local toolchain* fault — pytest 9 calling
  `ascii_escaped()` on an `np.nan` parametrize value — that a green Windows CI
  would not have prevented and a red one would teach people to ignore. Worth
  adding once §4 item 1 or 2 is actually done.
- **No extras-free leg.** §7 item 10 wanted one to prove the Prophet/SHAP
  degradation path. Worth adding the day that path is changed; it is not worth
  a permanent second install of the heaviest dependencies to re-assert
  behaviour that is already unit-tested.
- **No browser test.** The two behaviours PRs 5–8 could not verify — keyboard
  activation of the rail, live resizing — need a real browser, and asserting
  them means Playwright. Larger than the two facts justify. Still a manual pass.

### Known limitations

1. **The byte-comparison is cross-platform on faith.** The template was built on
   Windows/Node 24 and `--check` will run on ubuntu/Node 24. Nothing in the
   build should be OS-dependent (Vite normalises paths; `sync_template.py`
   normalises CRLF on read), but this has not been observed. **If the first CI
   run fails `sync_template.py --check` with no frontend change in the PR, that
   is the cause** — re-sync from a Linux build and commit, rather than assuming
   the guard is wrong.
2. **`check_bundle_size.py` projects, it does not measure.** It is exactly right
   about the template and approximately right about the payload: the committed
   fixture is a serialised payload, not the byte-identical output of
   `serialize.dumps()` for a given run (hence the 3.3 KB / 0.2% gap). The real
   measurement is the pytest one.
3. **Headroom is 50,290 bytes**, ~2.5%, and the payload is what grows as history
   accumulates. The lever when it breaches is a custom Plotly partial bundle
   (§8), not a smaller payload.
4. **`npm ci` on npm 11 skips esbuild's postinstall** (`allow-scripts`) and
   prints a warning. The build works regardless — verified locally — because the
   binary ships in the platform package. If a future esbuild needs that script,
   the failure will be at build time and loud.

### Local equivalents

CI runs nothing a developer cannot. Before opening a PR:

```bash
python -m pytest tests/ -q
python -m pytest --doctest-modules call_forecast/ -q

cd frontend && npm ci && npm run typecheck && npm test && npm run build

python scripts/sync_template.py --check
python scripts/check_bundle_size.py
```

### Verified locally, PR 9

Python 3.12.10 · pytest 9.1.1 · Node 24.18.0 · npm 11.18.0.

- `pytest tests/ -q` — **263 passed** (257 before this PR, plus the 6 new size-gate
  tests), exit 0. §4's collection crash did not reproduce on either run;
  nothing was changed to address it and it remains intermittent. **No existing
  test was modified or weakened.**
- `pytest --doctest-modules call_forecast/ -q` — **18** (17 passed, 1 skipped).
- `npm ci` · `npm run typecheck` · `npm test` (**130 passed**) · `npm run build`
  → `dist/index.html` at **1,674,436 bytes**, byte-identical to the committed
  template.
- `sync_template.py --check` and `gen_tokens.py --check` — both up to date.
- Both failure injections above, restored afterwards; `git status` clean apart
  from the new files.

`.gitignore` was checked and needed no change: `node_modules/`, `dist/`,
`frontend/dist/`, `outputs/`, `reports/` and `*.egg-info/` were already ignored,
and the two generated files that *are* committed on purpose — the dashboard
template and `tokens.css` — each have a `--check` guarding them.

---

## 10. Phase 2 — Dashboard State Consistency

**Added by PR 10** (branch `feature/dashboard-state-consistency`). Frontend
only: no Python changed, no payload field added, `SCHEMA_VERSION` untouched.
The one non-frontend file in the diff is
`call_forecast/assets/dashboard_template.html`, which is the committed build
artefact and had to be re-synced (§6).

### The bug

PR 7 made the rail a filter, and four sections learned to answer to it —
forecasts, monthly cost, model comparison and explainability. Three did not.
The visible symptom was the at-a-glance tiles: selecting *Daily cost* left a
"Next 30 days — 218 calls" tile standing above a page with no volume card on it,
and an "Alerts raised 102" tile counting rules that fire on targets the reader
had just filtered away. The tiles were not stale in the sense of not
re-rendering — `App` re-rendered them on every selection — they were stale in
the sense that nothing in them *depended* on the selection.

### What changed

**`src/lib/selectionView.ts` is new, and it is the point of the PR.**
`selection.ts` answers "what did the reader choose"; this answers "what does that
choice mean for the payload". Five pure functions — `trimDaily`,
`trimHorizons`, `headlineRollup`, `isAnomalyVisible`, `selectAnomalies` — payload
in, payload-shaped value out. No DOM, no `location`, no React, so the whole
contract is testable without jsdom, and it sits beside `selection.ts` rather
than inside a component because three sections now read it.

It exists because the duplication had already started. `ForecastCard` trimmed
`daily` and `horizons` inline; the tiles were about to need the same rule to
resolve a headline, and anomaly counts were about to be tallied a second time.
Two copies of a filter is how a dashboard ends up with a cost tile above a page
showing call volume.

- **`AtAGlanceSection`** takes `selectedTarget` and `horizon`. Each forecast
  tile is gated by the same `isTargetVisible` every other section uses, and the
  alert tile reads `selectAnomalies`. "Calls in period" deliberately does not
  filter: it is an ingestion fact, one dataset feeds every model, and a tile
  that changed with the rail there would be inventing a distinction.
- **`AnomaliesSection`** takes `selectedTarget` and scopes the timeline, the
  rule tally and the recent-alert disclosure through the *same* call the tile
  makes. The tile and the tally therefore cannot disagree — that is the design,
  not a coincidence. The observed volume line stays whole: it is history, not a
  model's output, and the markers need something to sit on.
- **`DataQualitySection`** takes `selectedTarget` and **still does not filter**.
  Every advisory is a property of the ingested dataset. What a selection changes
  is that the banner *says* it describes the whole run, so a reader does not
  read an unfiltered section as an unresponsive one. Same for the anomaly
  section's scope note: a short table under a filter must not be mistakable for
  a quiet week.
- **`ForecastsSection`** is unchanged in behaviour — its two inline trims now
  call the shared ones.

### Two decisions worth knowing

***Anomalies bind to a target through `metric`, and `overnight_calls` binds to
none.*** Every rule reports a target key in `metric` except
`overnight_activity`, which reports `overnight_calls` — a property of the run
rather than of any forecast. A target selection therefore drops it. It is
info-level and has never been on the timeline, so the chart is unaffected;
`selectAnomalies` is where that is written down.

***The headline horizon is a preference now, not a constant.*** `dashboard.py`
hard-coded 30 and so did this section, for a good reason: the tile says "next 30
days" in words, so reading `cfg.forecast.horizons` would let the label and the
number drift. But PR 7 gave the reader a horizon control, and a 30-day tile
above cards trimmed to fewer days is the same staleness in a different disguise.
`headlineRollup(forecast, horizon, 30)` prefers 30, falls back to the longest
rollup at or under the chosen horizon, and returns the row — the caller writes
its label *from that row*, so the words and the number still cannot drift. At
the default 90-day horizon every tile reads exactly as it did before, which is
the regression argument.

**`selectAnomalies` returns its input by identity under "All"**, so the common
case allocates nothing and the memos downstream keep their identity.

### Tests: 163 frontend, up from 130

| File | Tests | What it pins |
|---|---|---|
| `lib/selectionView.test.ts` | 14 | the pure contract — trims, headline fallback, metric binding, recomputed counts and tallies, source left untouched |
| `sections/AtAGlanceSection.test.tsx` | 8 | tiles appear and disappear with the rail, the alert tile scopes, "All" restores, the label is written from the row it quotes |
| `sections/AnomaliesSection.test.tsx` | 6 | the tally narrows and comes back, the scope note, the empty case |
| `sections/DataQualitySection.test.tsx` | 5 | advisories are *identical* under a selection, the scope note, still nothing on a clean run |

No existing test was modified or weakened. The three new component files follow
PR 7's convention — `// @vitest-environment jsdom` docblock, Plotly mocked.

### Verified against a live dev server at 1280px

On the 210-day sample fixture, through the rail rather than by hand-editing the
fragment:

```
(All)                            5 tiles · 102 alerts · 3 forecast cards · 17 tables · no scope notes
#model=total_cost                3 tiles · 73 alerts (31 critical · 42 warning) · 1 card · 2 scope notes
#model=call_volume&horizon=30    3 tiles · 1 alert · "Next 30 days" · 31 rollup rows
(All, again)                     5 tiles · 102 alerts · 3 cards · 17 tables — byte-for-byte the first line
```

No console errors, no horizontal page overflow. The 102 → 73 → 1 → 102 sequence
is the acceptance criterion: the tile now moves with the page and "All" restores
the aggregate.

### Verified locally, PR 10

Node 24.18.0 · npm 11.16.0.

- `npm run typecheck` — clean.
- `npm test` — **163 passed** (130 before this PR).
- `npm run build` → `dist/index.html` at **1,675,809 bytes** (1,674,436 before).
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean (no `THEME` change).
- `scripts/check_bundle_size.py` — projected **1,951,083 of 2,000,000**;
  headroom 48,917 bytes, down from 50,290.

**`pytest` was not run: this checkout has no Python environment** — no `pandas`,
no `pytest`, no venv under `~/.venvs`. Nothing under `call_forecast/` changed
except the regenerated template, and the two stdlib-only gates that cover it
(`sync_template.py --check`, `check_bundle_size.py`) both pass, so CI's
`backend` and `dashboard` jobs are the first real run of the Python suite
against this branch.

---

## 11. Phase 2 — Navigation UX

**Added by PR 11** (branch `feature/navigation-ux`). Frontend only: no Python
changed, no payload field added, `SCHEMA_VERSION` untouched. The one
non-frontend file in the diff is `call_forecast/assets/dashboard_template.html`,
the committed build artefact, re-synced per §6.

Goal: make the report feel like an application rather than a page that happens
to have buttons on it. No new dependency, no new state, no new component — the
selection flow of PR 7 is untouched.

### The navigation state flow, unchanged

```
location.hash
  └─ useHashSelection (useSyncExternalStore, one subscriber, in App)
       └─ selection { target, horizon }
            ├─ SideNav — controlled, writes back through onSelect
            └─ every target-scoped section, as props
```

PR 11 adds nothing to this diagram. That is the point: everything below is CSS,
one keyboard handler and one link.

### The transition is the mount, not a transition component

**Filtering already unmounts a card** — PR 7 chose that over hiding, so a chart
can never be measured at zero width. So the DOM event that means "the page
changed" already exists, and `Card` and `Section` simply animate on mount:
opacity plus a `--motion-rise` (4px) travel, over `--motion-base` (200ms) on
`--motion-ease`. No transition wrapper, no timers, no exit animation, and no
`key` on the content region that would remount untouched charts.

The behaviour this buys is the honest one: cards that a selection *changes*
animate, and the sections it does not touch — arrivals, scenarios — never
remount and so never move. Motion here means "this changed", and animating a
section that did not change would say the opposite.

**Only `opacity` and `transform` animate, anywhere in this PR.** Height, margin
and padding would reflow a column under a chart that has already measured
itself, and `PlotlyChart` sizes from `clientWidth`, which a transform does not
touch. `cardEnter` ends on `transform: none` rather than `translateY(0)` so the
card does not remain a containing block for anything positioned inside it.

### Motion tokens live in `global.css`, not `tokens.css`

`--motion-fast` (120ms), `--motion-base` (200ms), `--motion-ease`
(`cubic-bezier(0.2, 0, 0.2, 1)`) and `--motion-rise` (4px). **They must not go
in `theme/tokens.css`**, which is generated from `call_forecast.dashboard.THEME`
and guarded by `tests/test_tokens.py` — the Python renderer has no motion to
describe, so putting durations there would mean inventing palette entries that
no palette owns. Every transition added here reads them; a control that picks
its own numbers is how a rail ends up settling after its content does.

`prefers-reduced-motion` needed no per-rule opt-in: the blanket kill-switch in
`global.css` predates this PR. It was extended to zero `animation-delay` and
`transition-delay` and to pin `animation-iteration-count`. It collapses
durations to `0.01ms` rather than to `none` deliberately — an animation with
`animation-fill-mode: both` and no duration would never reach its `to` frame,
leaving entering content stuck at the opacity it started from.

### The active indicator, and the layout shift that was already there

The rail marked its selection with `border-left: 3px` plus `padding-left: 10px`
to absorb it. Correct, and it moved the label by a pixel on every selection —
the jitter an animation is supposed to remove, not add to.

***The bar is now `background-size` on the button itself.*** A background paints
no box and takes no space, so it can grow from nothing to full height with the
label pinned. `background-color` and `background-image` are set separately and
the `background` shorthand is never used on `.tab`: the shorthand resets the
other one, and a `:hover` written as `background: var(--surface)` would silently
erase the bar. Below 900px the same bar becomes an underline that widens.

A `::before` and a real child `<span>` were both built and both discarded — not
because they fail, but because keeping the indicator on the button's own
property leaves the tab's DOM at one text node, which is what makes its
accessible name unambiguous.

**The bold label's width is reserved on every tab** by a zero-height
`::after { content: attr(data-label); font-weight: 600 }`. Selection bolds the
label and bold text is wider; in the vertical rail the buttons are `width: 100%`
so nothing moves, but in the horizontal strip below 900px they size to their
content, and selecting one would shove every tab after it sideways.
`visibility: hidden` keeps the duplicate out of the accessibility tree.

Selection is still carried by weight, surface, border and bar together — never
by hue alone (§6).

### Keyboard: arrows added, tab order untouched

Arrow Up/Down/Left/Right, Home and End move focus across the rail, wrapping at
both ends. Both axes, because the rail is a column above 900px and a strip
below it.

***This is deliberately not the ARIA tabs pattern.*** There is no roving
tabindex: every tab stays in the tab sequence, so Tab still walks the rail one
button at a time and PR 7's Tab-order test keeps passing unmodified. A
radiogroup was rejected in PR 7 and is rejected again here for the same reason —
this is a `nav` of buttons, and a roving tabindex would both make Tab skip the
whole rail in one press and imply that arrowing onto a tab selects it. **Arrow
keys move focus; they never select.** Enter and Space still commit.

The buttons are read off the DOM inside the handler rather than tracked in a ref
array: they are the container's only element children and their DOM order *is*
the order focus should follow, so a parallel array would be a second copy to
keep in step with `tabs`, and the first time the two disagreed the rail would
move focus to the wrong tab. `preventDefault()` is called only once a key is
known to be handled, so Home and End still scroll the page when the rail is not
what the reader is driving.

### The skip link, and the trap in it

`main` is now `id="report" tabIndex={-1}`, with a "Skip to report" link as the
first thing in the tab order — a keyboard reader otherwise meets the theme
toggle and every model tab before the first card, on every load. `tabIndex={-1}`
is what makes the jump move *focus*; without it the browser scrolls to the
fragment and leaves focus on the link, so the next Tab returns to the rail.

***The default action would clear the reader's model selection.*** The fragment
is not decoration on this page — it *is* the selection. Following `#report`
replaces `#model=total_cost` with a fragment that parses to no target, so a
reader who had filtered to one model and then skipped past the rail would arrive
in an unfiltered report. `skipToReport` calls `preventDefault()` and focuses
`main` directly; `focus()` does both jobs the default would have, including the
scroll. `href` stays `#report` because that is what tells assistive technology
and the status bar where the link goes. This is PR 7's `key=value` collision
arriving from the other direction: there a bare anchor would have been *scrolled
to*, here one would be *written*.

The link is visually hidden by the clip-and-translate pattern, never
`display: none`, which is not focusable and so cannot be a skip link at all.

### Tests: 181 frontend, up from 163

| File | Tests | What it pins |
|---|---|---|
| `shell/SideNav.test.tsx` | +11 | arrow/Home/End movement and wrapping, that arrowing never selects, that Enter still commits after arrowing, unhandled keys left alone, the bold-width reservation, one `aria-current` and nothing else, no extra markup in a tab |
| `shell/AppShell.test.tsx` | 7 (new) | skip link first in tab order, `main` as a `-1` target, focus actually moving, and — the reason the file exists — an existing `#model=…&horizon=…` surviving the skip untouched |

No existing test was modified or weakened; PR 7's Tab-order and keyboard-
activation tests pass unchanged, which is the evidence that the tab sequence was
added to rather than replaced. The new component file follows PR 7's convention
(a `// @vitest-environment jsdom` docblock).

### Verified against a live dev server

On the 210-day sample fixture, driving the rail rather than editing the
fragment. Through a full cycle All → volume → duration → cost → All:
`aria-current`, the bar and the bold weight move together, exactly one tab
carries each at every step, and the fragment tracks it. Figures 12 → 5 → 5 → 6 →
12 and sections 9 → 8 → 8 → 9 → 9, matching PR 7 and PR 10.

**Zero layout shift**: every tab's width, height and position is identical
across the whole cycle, measured against the load-time geometry. Tab widths also
hold in the ≤900px strip, which is the sizer working.

Skip link: hidden at `translateY(-37.9px)`, first tab stop, moves focus to
`#report`, and leaves `#model=total_cost` exactly as it found it. Arrows:
All → volume, End → cost, wrap → All, Home → All, with the selection unchanged
throughout. `cardEnter` / `sectionEnter` resolve at 0.2s, `both`, and the shared
easing. No console output. The page never scrolls sideways — the rail strip and
the wide tables overflow inside their own containers, as designed.

***Two "regressions" found during this pass were instrumentation, not code, and
the next person should not re-find them.*** The Browser pane does not composite
frames when it is not displayed, so **every transitioned property freezes at its
start value indefinitely** — `getComputedStyle` then reports the active tab's
bar as unlit and the previous tab's as lit, permanently, while `matches()`
confirms the selector applies and the rule is present in the CSSOM. It looks
exactly like a style-invalidation bug and it is not one. Injecting
`* { transition: none !important }` before reading resolves every state
correctly; that is how the results above were measured, and it is the technique
to reuse. Separately, reading `.js-plotly-plot` immediately after a navigation
counts charts mid-mount and under-reports — 1 of 6 on one read, 6 on the next,
with no code difference between them.

**Unverified, unchanged from PRs 5–10 and still the embedded browser rather than
the code.** Live resizing, and keyboard *activation* of a rail button (the pane
delivers a trusted keydown but never performs the default activation).
`resize_window` additionally does not take here — `innerWidth` stayed at 944
after a request for 375 — so the ≤900px assertions above rest on the media query
being active (`flex-direction: row`) rather than on a real 375px viewport.
`prefers-reduced-motion` could not be emulated in this pane either; the
kill-switch is asserted by rule, not by observation. All of these still want one
pass in a real browser.

### Verified locally, PR 11

Node 24.18.0 · npm 11.16.0.

- `npm run typecheck` — clean.
- `npm test` — **181 passed** (163 before this PR).
- `npm run build` → `dist/index.html` at **1,678,440 bytes** (1,675,809 before).
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean (no `THEME` change — motion tokens live in `global.css`, see above).
- `scripts/check_bundle_size.py` — projected **1,953,714 of 2,000,000**;
  headroom 46,286 bytes, down from 48,917.

**`pytest` was not run: this checkout still has no Python environment** — no
`pandas`, no `pytest`, no venv under `~/.venvs`, unchanged from PR 10. Nothing
under `call_forecast/` changed except the regenerated template, and the two
stdlib-only gates that cover it both pass, so CI's `backend` and `dashboard`
jobs are the first real run of the Python suite against this branch.

---

## 12. Phase 2 — CSV Import Workflow

**Added by PR 12** (branch `feature/csv-import`, GitHub #13). Frontend only: no
Python changed, no payload field added, `SCHEMA_VERSION` untouched. The one
non-frontend file in the diff is `call_forecast/assets/dashboard_template.html`,
the committed build artefact, re-synced per §6.

Built by three agents working in parallel against a contract the lead froze
first (`src/lib/import/types.ts`), with disjoint file ownership so no file had
two authors: `lib/import/*`, `components/import/*`, and `App.tsx`.

### The question that shaped the PR

**A raw call CSV cannot produce forecasts, and the payload is not a dataset.**
`DashboardPayload` carries `forecasts` (90 days, calibrated intervals, six
cross-validated models), `evaluations`, `explanations` (SHAP), `anomalies` and
`scenarios` (Erlang-C). Producing those from raw call rows *is* the Python
package. Reimplementing it in TypeScript would be a second forecasting stack
that silently disagrees with the audited one, and a backend is excluded by the
offline single-file property.

So the import has **two routes**, and which one ran is visible to the reader:

```
my_export.csv        -> descriptive sections only, with a note saying why
dashboard_data.json  -> every section, full fidelity
```

The CSV route fills `daily`, `hourly` and `ingestion` and leaves the analysis
maps empty. That needed **no new conditional logic anywhere**: `ForecastsSection`,
`ModelComparisonSection`, `ExplainabilitySection`, `MonthlyCostSection`,
`ScenariosSection` and `DataQualitySection` already return `null` when their
data is absent, because §8's convention has said so since PR 3. The JSON route
is nearly free — it is the existing contract, re-entering through the front
door.

### Where state lives

Unchanged. `App` holds one payload slice and an import replaces it **through the
same `setState` the initial load uses**. There is no second "imported payload"
slice, no context and no store; a parallel copy would need keeping in step with
selection, theme and every section, and §10 is the record of what happens when
two things that should agree are computed twice.

Selection stays in the URL with one `useHashSelection` subscriber.
**A stale fragment self-heals for free**, which was verified rather than
assumed: `domain` is a `useMemo` keyed on `payload`, so a swap recomputes
`targets`/`horizons`, and `parseHash` degrades `#model=total_cost` to "All" when
the new payload has no such target. Nothing writes to the hash on import.

### `analysisAvailable`, and the section that had to be silenced

***An empty analysis section and an absent one mean different things, and the
payload cannot tell them apart.*** A pipeline run whose detector fired on
nothing and a CSV the detector never saw both arrive with zero anomaly rows —
but "we checked and found nothing" is a finding and "nothing was checked" is
not. `AnomaliesSection` has **no empty guard**: it drew a clean volume line and
a zero tally either way, so a CSV import was reporting an all-clear on an
analysis that never ran.

Found in browser verification, not by a test, and fixed by the lead during
review. `App`'s ready state carries `analysisAvailable`, true for all three
`loadPayload()` sources and for a `payload` import, false for a `csv` one. It
gates the anomalies section and shows a `Callout` naming exactly what is missing
and how to get it. **The flag is held beside the payload, not added to it** —
the JSON contract describes a pipeline run, and a field meaning "this is not
one" belongs to the app, not to `serialize.py`.

### The parser is a port, and it is checked against what it ports

`lib/import/` is a hand port of `ingest.py`'s column handling and the
descriptive half of `features.build_daily()`: `_COLUMN_ALIASES` verbatim,
`parse_duration_to_seconds` including the `m:ss` and `h:mm:ss` forms,
`parse_currency`, and the zero-call-day rule — `call_volume: 0` and
`total_cost: 0`, but `avg_duration_sec: null`, because the mean of no
observations is undefined rather than zero.

**`crossValidation.test.ts` is the test that matters.** The committed fixture is
generated by running the pipeline over `examples/sample_export.csv`; feeding
that same CSV to the TypeScript path and diffing is a real comparison of two
implementations over one input. On 1,711 calls across 210 days it reproduces the
Python output exactly — **0 mismatches over 630 value comparisons**, the same
168-cell arrivals grid, and the same 9 zero-call days carrying the same nulls.
If it fails after a `buildFromCsv` change the port has drifted; if it fails
after the fixture is regenerated, port the Python change rather than relaxing
the tolerance.

**No new dependency.** The RFC 4180 tokenizer is hand-written — quoted fields,
`""` escapes, embedded commas and newlines, CRLF, BOM, and a throw on an
unterminated quote. `package.json` is unchanged, which matters at §12's
headroom.

One deliberate divergence from Python, documented in `callSchema.ts`: a
duplicate header is an **error** here, where `ingest.py` silently takes the
first match. A one-shot browser import has no ingestion report to surface it in
later.

### Tests: 246 frontend, up from 181

| File | Tests | What it pins |
|---|---|---|
| `lib/import/parseCsv.test.ts` + `callSchema.test.ts` + `buildFromCsv.test.ts` + `buildFromPayloadJson.test.ts` | 43 | tokenizer edge cases, aliasing, duplicate headers, every validation path, zero-day insertion, the 168-cell grid, the JSON route's accept/reject/version-warn |
| `lib/import/crossValidation.test.ts` | 5 | the port against the Python fixture, on the same CSV |
| `components/import/ImportPanel.test.tsx` | 8 | preview-before-commit, Cancel, errors in `role="alert"`, keyboard activation, drag state, `aria-busy` |
| `App.test.tsx` | 9 | the swap, stale-fragment self-heal, filtering the new payload, double import, and the four `analysisAvailable` cases |

No existing test was modified or weakened.

### Verified against a live dev server

Both routes, driven through the real file input:

```
#model=total_cost, sample fixture   10 sections · 6 figures · 4 rail tabs
  drop my_export.csv                 preview shown, dashboard NOT swapped
  press Import                       4 sections · 1 figure · 0 rail tabs · note shown
  drop dashboard_data.json + Import  10 sections · 4 rail tabs · note gone
  click "Daily cost" on the rail     6 figures, aria-current correct
```

Preview never commits; "Anomalies and alerts" is absent after the CSV import and
present after the JSON one; no console output; no horizontal page overflow.

### Verified locally, PR 12

- `npm run typecheck` clean · `npm test` **246 passed** (181 before).
- `npm run build` -> `dist/index.html` **1,697,623 bytes** (1,675,809 before PR 11).
- `sync_template.py --check` and `gen_tokens.py --check` clean.
- `check_bundle_size.py` — projected **1,972,897**, under the 2,000,000
  advisory and well under the 3,000,000 limit (see the budget policy above).

**`pytest` was not run: this checkout has no Python environment**, unchanged
from PRs 10 and 11. Nothing under `call_forecast/` changed except the
regenerated template. CI is the first real run.

### The size budgets became two-tier, and that is now the policy

PR 12's CI run failed on `test_projection_is_close_to_the_real_generated_size`,
and the failure was informative rather than annoying. **It was not the 2 MB
budget.** That passed. What failed was a *separate* assertion pinning the
projection to PR 6's measured **1,946,364 bytes ±1%** — a hardcoded historical
constant that ordinary growth had walked past by about 7 KB.

That is the wrong shape for the assertion. The test's stated job is to prove
the script's arithmetic still models the substitution `build_dashboard_react()`
performs; instead it made a statement about how big the bundle happened to be
in PR 6. Every PR that legitimately grew the dashboard would break a test about
*arithmetic*, and the only two fixes available were to edit the constant
(forever) or widen the tolerance (which would quietly stop it checking
anything).

**The fix was to compare the projection against the substitution actually
performed**, on the two files that are already committed. One string replace,
no pipeline run, and *exact* — the tolerance is gone, because a tolerance only
ever existed to absorb the stale constant. It now fails if and only if the
script's arithmetic and the renderer's substitution disagree, which is the one
thing it was meant to catch. Nothing to bump, ever.

**Alongside it, every size gate became advisory + limit.** The project grows;
a gate that turns red on ordinary progress gets silenced, and a silenced gate
protects nothing.

| Gate | Advisory (warns, exit 0) | Limit (fails) | Now |
|---|---|---|---|
| Generated dashboard | 2,000,000 | 3,000,000 | 1,972,897 |
| Committed template | 1,750,000 | 2,600,000 | 1,697,623 |

The advisory is the size the artefact *wants* to be — small enough to attach to
an email and quick to open from `file://`. Crossing it prints a loud, specific
NOTE saying how far the real limit is, and passes. **Raising an advisory as the
project grows is expected and is a normal part of the PR that grows it.**
Raising a *limit* should require an argument in the PR that does it: at 3 MB the
page is half again the size of a build that already contains all of Plotly,
which means something was added that nobody costed.

Two properties are held by tests rather than by discipline:
`tests/test_bundle_size_check.py` asserts the advisory sits strictly below the
limit (an advisory at or above it would be unreachable, and the warning tier
would never print), and **drives the warning path through the real entry
point** — an untested warning path is one refactor away from being silent, and
silence here reads exactly like "comfortably under budget".
`test_react_dashboard.py` imports `DASHBOARD_LIMIT_BYTES` and
`TEMPLATE_LIMIT_BYTES` rather than restating them, so the render test and the
script cannot drift apart. It deliberately does **not** assert the advisory:
failing on it there would put the policy back to one tier by the side door.

The lever when a *limit* is genuinely approached is unchanged and is still the
right one: a custom Plotly partial bundle (`plotly.js/lib/core` +
scatter/bar/heatmap, roughly half of the current 1.42 MB), which also means
revisiting `src/types/plotly.d.ts`. Trimming the payload remains the wrong move
— it is the contract.

### Two things left for later

- **`Callout` takes `children: string`**, so the provenance note is one long
  sentence rather than marked-up prose. Fine for now; a `ReactNode` overload is
  the change if it ever needs a link.
- **The CSV route builds a placeholder `ConfigSummary`** — a CSV carries no
  configuration, so horizons and targets are empty and the business-hours and
  anomaly thresholds are zeros. Nothing reads them on that path today, because
  every section that would is omitted. A future section that reads `config`
  unconditionally must check.
