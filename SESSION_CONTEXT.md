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
`feature/csv-import`. PR 13 — the Export Center — is in §13, on
`feature/export-center`. PR 14 — About & Documentation — is in §14, on
`feature/about-documentation`. PR 15 — External Integrations — is in §15, on
`feature/external-integrations`. All six are frontend only.

**Phase 3 has started.** PR 16 — the landing experience — is in §16, on
`feature/landing-experience`, and it changes what the application does on
load: **the dashboard no longer renders until the reader enters it.** A link
carrying a fragment (`#model=…`, `#view=docs`) still arrives where it points.
Read §16 before touching `App.tsx`'s render branches or `lib/entry.ts`. PR 17 —
the executive summary cards — is in §17, on `feature/executive-summary-cards`;
read it before adding anything that derives a figure from the payload, because
it is where the line between "Python computes it" and "React selects and
labels it" is drawn. PR 19 — the import experience — is in §19, on
`feature/import-experience`.

**Read §19 before touching anything that reads `config` or renders an empty
state.** It is the record of a reported data-loss bug that was not one: the
parser was keeping every row of the file, while three separate things in the
presentation layer combined to make a successful import look like a failed one
— including a footer publishing a run configuration of zeros as fact, which §12
had predicted in writing. §19 also carries the first new runtime dependency
since the migration began (`read-excel-file`, for `.xlsx` import), four parser
bugs found by auditing the port against `ingest.py`, and an `AppShell` remount
that a test comment had been documenting as expected behaviour.

**The dashboard now has two views.** The report, and six pages of integrated
documentation reached from the header's "Docs" control. Both live in the same
URL fragment; §14's routing subsection is the thing to read before touching
`selection.ts` or `lib/docs/route.ts`, because the two writers share one
fragment and the failure mode is silent.

**Read §13's last subsection before running a browser check on this machine.**
There are two clones of this project here and the default preview configuration
points at the stale one.

**Test suite health.** Two test files currently crash *during collection* on
this machine for reasons unrelated to any recent change — see §4.

---

## 2. Current Architecture

**Frontend runtime dependencies.** React · Plotly (cartesian dist) ·
`read-excel-file` (added PR 19, `.xlsx` import — §19). Everything else under
`frontend/` is dev-only.

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
│   │   ├── components/summary/     # executive summary cards (§17)
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
- Cross-file de-duplication uses `call_id` when the export carries one
  (`ingest.py:564`) and otherwise falls back to content plus within-file
  position, because timestamps are minute-resolution. The RetellAI exports in
  use today have no call ID, so the fallback is the path that actually runs —
  but the exact path exists and activates the day the column appears.
  *(Corrected in PR 14; this line previously claimed there was no ID path at
  all.)*
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

**§18 is the standing instruction on when to run the test suites.** Read it
before running anything: the short version is that the branch is assumed green,
the full Python suite is a pre-commit gate rather than a warm-up, and a
frontend-only change does not run it at all.

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

---

## 13. Phase 2 — Export Center

**Added by PR 13** (branch `feature/export-center`). Frontend only: no Python
changed, no payload field added, `SCHEMA_VERSION` untouched. The one non-frontend
file in the diff is `call_forecast/assets/dashboard_template.html`, the committed
build artefact, re-synced per §6.

Built by three agents against a contract the lead froze first
(`src/lib/export/types.ts`), with disjoint file ownership so no file had two
authors: `lib/export/*` (engine), `components/export/*` (UI), and `App.tsx`
(integration). Same shape as PR 12, and for the same reason.

### The question that shaped the PR

**An export is a *view* of dashboard state, never a second read of it.** The
obvious implementation — each format walks the payload its own way — produces a
second serialization stack that disagrees with the page silently. A CSV covering
three targets beside a PNG covering one is the §10 failure in a new place.

So the contract mandates reuse rather than suggesting it, and the registry is the
single pass every format draws from:

```
payload + Selection + palette
  -> registry.buildAnalyticExports()      one pass, three views
       table   -> csv.ts    one file per analytic
       json    -> json.ts   one file per request
       figures -> png.ts    one file per figure
```

Selection is applied by **the same functions the sections use** —
`isTargetVisible`, `trimDaily`, `trimHorizons`, `selectAnomalies`. Nothing in
`lib/export/` filters its own way. PNG reuses the pure builders in
`lib/chart/figures/` verbatim, so "preserve theme" is a property of the
architecture rather than a thing to remember: the figure handed to
`Plotly.toImage` is the object the card renders.

### CSV carries raw numbers, and that is the whole point

`lib/format.ts` is *display* formatting — `$1,234.50`, an em dash for null,
thousands separators. A CSV built from it is not machine-readable. The rows carry
the raw payload numbers via `String(n)`, never `toFixed`, so precision survives
byte-identical from JSON to file. `null` stays an empty field, never the string
`"null"`.

**One CSV per analytic with a leading `target` column**, rather than one file per
target. That is what "All Models exports aggregate data" means here, and it keeps
a three-model export to one file without the ZIP the brief excludes. A
single-model export has the same columns, so a script that reads one reads both.
`monthlyCost` carries the column too despite only ever being `total_cost` —
consistent shape beats saving a column.

**Exports carry full data, not the UI's display caps.** `ExplainabilitySection`
shows 12 features and `AnomaliesSection` the 25 most recent; those are
pagination, not selection. "Export only visible analytics" is a statement about
*which* analytics, not about truncating rows to what fits on a screen. The
importance *chart* still exports its 10 bars, because that is what the builder
draws.

### PNG, and why `toImage` and not a mounted chart

`Plotly.toImage` takes a `{data, layout}` object directly and renders off-screen,
so figure export never enters the component tree and needs no ref registry of
mounted charts. `src/types/plotly.d.ts` gained a third declaration in the same
minimal hand-written style — `@types/plotly.js` is still refused for the reason
at the top of that file.

***The exported figure's background is stamped from the palette, and it has to
be.*** On-screen figures are transparent (`baseLayout` sets `rgba(0,0,0,0)`)
because the card underneath supplies the background. There is no card in a PNG,
so an unstamped dark-theme export is a transparent image that reads as
black-on-black when dropped into a light document. `palette.surface` is exactly
the card colour, so the file reproduces what the reader saw.

Resolution is `PNG_SCALE: 2` over `PNG_WIDTH: 1000` — 2000px wide, verified. The
figure's own `layout.height` is reused rather than recomputed: every builder sets
an explicit height (§8, PR 4/5 — Plotly's autosize paths delete both dimensions),
and the ranked charts derive theirs from row count.

### Where state lives

Unchanged, and nothing was added. `ExportContext` is
`{ payload, selection, analysisAvailable, palette }` — all four already held by
`App`. There is no export store, no snapshot slice, no re-fetch. Selection is
still the URL fragment with one `useHashSelection` subscriber; **exporting never
writes to the hash**, which is asserted rather than assumed.

The palette comes from `useChartPalette()` called in `App`, **not** from
`useTheme().mode` — the one-render-stale trap §8 documents. It is a memo
dependency, so a theme toggle rebuilds the context and the next PNG carries the
new palette.

A stale outcome clears on target *and* horizon change. "Exported
forecasts-call_volume.csv" sitting under a rail that now reads "All models" is
the same fabricated agreement §10 exists to remove.

### `analysisAvailable` gates the picker

`availableAnalytics()` drops every `requiresAnalysis: true` descriptor when
PR 12's flag is false, and also drops an analytic whose payload slice is empty
for this run. So a CSV import offers the arrivals heatmap and nothing else —
offering "Anomalies" there would export an empty file for a section the reader
cannot see, which is the fabricated all-clear §12 removed from that very section.

### Accessibility: the live region is not decoration

The success notification is announced from a **persistently rendered**
`role="status"` region, with the visible `Callout` marked `aria-hidden`. A live
region inserted into the DOM already carrying its message is not reliably
announced — assistive technology watches an *existing* region for changes. The
first implementation mounted the Callout inside its own new region, which
announced the start of an export and nothing about its finish. Fixed on review.
Failures live in a separate `role="alert"` and are deliberately absent from the
status region, so nothing is announced twice.

Escape closes the panel from anywhere inside it *or* from the trigger — the
handler is on the wrapper, not the panel, because the reader who just reopened
the panel is focused on the trigger, and a key that works half the time reads as
broken.

### Stretch goals: two taken, one declined

Multi-select is the primary interaction. The last format used is remembered in
`sessionStorage` (`FORMAT_MEMORY_KEY`) — session not local, and the *format*
only: which analytics someone wants is a question about one task, and pre-ticking
last time's boxes would put files in their downloads folder they did not ask for.
The read is wrapped in try/catch because a `file://` page has an opaque origin
where even reading storage can throw. JSON metadata carries `exportedAt`.

PDF and ZIP are not implemented, per the brief. `PDF_TODO` in `types.ts` names
the real blocker: a PDF means jsPDF or pdf-lib in a bundle already at 1.99 MB
against a 2 MB advisory. That is a size argument for its own PR.

### Tests: 313 frontend, up from 246

| File | What it pins |
|---|---|
| `lib/export/csv`, `json`, `registry` tests (node, DOM-free) | column order and completeness, RFC 4180 quoting, the UTF-8 BOM, null cells, precision byte-identical, horizon trimming, single-model vs All-Models row counts, `analysisAvailable` filtering, the Infinity-horizon envelope |
| `lib/export/png`, `download`, `runExport` tests (jsdom) | `toImage` arguments, filename format, null figures dropped, partial-failure accumulation |
| `components/export/ExportCenter.test.tsx` (15) | open/close/Escape + focus return, multi-select, catalogue-ordered request, format disabling and auto-move, disabled states, the announced/visible split for success, partial and error, empty state |
| `App.test.tsx` (+9) | the model-switch regression, All Models, horizon trimming, the hash left untouched, CSV-import narrowing, stale-outcome clearing, the error path |

58 engine + 15 UI + 9 integration. No existing test was modified or weakened.

### Verified against a live dev server

On the 210-day sample fixture, capturing blobs at `URL.createObjectURL` rather
than performing downloads:

```
All models         forecasts CSV   270 rows = 3 targets x 90 days, BOM EF BB BF
#model=total_cost  forecasts CSV    90 rows, total_cost only
  ...&horizon=30   forecasts CSV    30 rows, last row 2026-08-28
#model=total_cost  forecasts PNG   2000x720, PNG signature, #1a1a19 opaque
#model=total_cost            JSON  meta.exportedAt, selection recorded, daily 30
```

The **export-after-switching-models** case is the one the brief called out and it
passes: the second export reflects the second selection, with nothing captured in
a stale closure. The fragment is unchanged by every export. Header row is
`target,date,yhat,yhat_lower,yhat_upper,horizon_bucket`, and `yhat` values carry
full float precision (`4.184523809523809`). No console output at any point; no
horizontal page overflow (`scrollWidth == clientWidth == 1265`).

PNG theme preservation was checked by decoding the blob to a canvas and reading a
pixel: `#1a1a19` at full alpha, which is the dark theme's `--surface`. Not a
transparent PNG, and not black-on-black.

### Verified locally, PR 13

Node 24 · `npm run typecheck` clean · `npm test` **313 passed** (246 before).
`npm run build` produced `dist/index.html` at **1,716,276 bytes** (1,697,623
before). `sync_template.py --check` and `gen_tokens.py --check` clean.

***`pytest` ran this time*** — `~/.venvs/callforecast` exists on this checkout,
unlike PRs 10–12 where CI was the first real backend run. **265 passed**, plus 17
doctests (1 skipped). The §4 collection crash did not reproduce. Nothing under
`call_forecast/` changed except the regenerated template, so this is confirmation
rather than coverage of new Python.

### The bundle advisory is nearly spent

`check_bundle_size.py` projects **1,991,550 of 2,000,000 — 8,450 bytes of
headroom**, down from 27,103 at PR 12. Under the advisory, so it passes silently,
but **the next PR of any size will cross it** and print the NOTE. That is the
two-tier policy working as §12 designed it, not a problem to pre-empt: the real
limit is 3,000,000, and the lever when it is genuinely approached is still the
custom Plotly partial bundle. Raising the advisory is a normal part of the PR
that crosses it.

The projection was confirmed by hand here: substituting the fixture payload into
the committed template produces a file of exactly 1,991,550 bytes.

### A machine hazard worth recording

**There are two clones of this project on the work machine**, and they are not
the same:

```
Documents\GitHub\call-analytics-forecasting-dashboard   origin/main, current
Desktop\call-forecast                                   stale at c8003cd (PR 10)
```

The Desktop copy is **9 commits behind** and has no `ImportPanel` at all. It is
also what `Desktop\.claude\launch.json` points `preview_start` at, so a browser
verification run from the default config silently exercises a checkout that
predates PR 11 — which happened during this PR and cost a verification pass. A
second configuration, `github-clone-dashboard` on port 5175, was added to that
file to reach the right tree; the launch config uses a **relative** `--prefix`
because an absolute path containing spaces fails to spawn.

Two clones of one repo both syncing through OneDrive is also a file-lock hazard
(§6). The Desktop copy was left untouched pending a decision about it.

---

## 14. Phase 2 — About & Documentation

**Added by PR 14** (branch `feature/about-documentation`). Frontend only: no
Python source changed, no payload field added, `SCHEMA_VERSION` untouched. Three
non-frontend files are in the diff — `call_forecast/assets/dashboard_template.html`
(the committed build artefact, re-synced per §6) and the two size-advisory
constants, raised below.

Built by three agents against a contract the lead froze first
(`src/lib/docs/types.ts` and `src/lib/docs/route.ts`), with disjoint file
ownership so no file had two authors: `content/docs/*` (content),
`components/docs/*` (nav and page structure), `components/docs/blocks/*`
(renderers). Same shape as PRs 12 and 13, and for the same reason.

### The question that shaped the PR

**Documentation is a view, not a section.** The obvious implementation — a tenth
section appended to the report — puts six pages of prose underneath the
scenarios table, where nobody looking for an explanation would find it and
everybody scrolling the report has to pass it. The docs replace the report
inside the same `AppShell`: same header, same provenance line, same theme, same
page frame, and only the rail and the content region change.

That also means the report's sections are **unmounted** while the docs are open,
which is PR 7's choice for filtering arriving in a new place and justified by the
same fact: a Plotly chart that is present but unrendered gets measured at zero
width; one that is absent cannot be. Returning to the report remounts every
chart and each measures itself fresh — verified, all six at 905px with their
five distinct derived heights intact.

### The routing trap, which is the thing most likely to be broken later

The fragment already carried `model=` and `horizon=`. Documentation joins it as
`view=` and `page=`, so a link to the page explaining feature importance
survives being pasted into a message — the same argument PR 7 made for putting
the selection there at all.

***The two writers share one fragment and neither may rebuild it.***
`formatHash` composed a fresh `URLSearchParams` from the selection alone. A docs
writer doing the same would have deleted `model=`/`horizon=` the moment a reader
opened the docs, and a rail click would have ejected them from the docs. Neither
throws. Both just silently lose state, which is the §10 failure mode exactly.

So `formatHash` gained an optional `base`, and `applyDocsRoute` merges rather
than formats. Each writer deletes and rewrites **only the keys it owns**, and
leaves everything else alone. `base` is optional so the 25 existing selection
tests pass unmodified, which is the evidence the change was additive.

```
#model=total_cost&horizon=30                      the report, cost, 30 days
#model=total_cost&horizon=30&view=docs            the docs, selection remembered
#model=total_cost&horizon=30&view=docs&page=metrics
#model=total_cost&horizon=30                      back, unchanged
```

That four-step round trip is verified in a real browser, through the real
controls, and is pinned by `route.test.ts` in both directions.

**There is still exactly one `useSyncExternalStore` subscriber.** `route` and
`navigate` are returned from `useHashSelection` rather than from a second hook,
because a second hook would be a second subscription to the same browser value
with two components rendering from it independently. No component reads
`location`; §8's rule is intact.

### The content model is data, and that is what made three agents possible

`lib/docs/types.ts` is a closed `DocBlock` union — paragraph, heading, list,
callout, table, definitions, code, diagram, modelCard, faq. Pages are plain
values with no JSX and no imports from `components/`, so content could be
written, reviewed and tested entirely independently of how it renders.

**No markdown renderer, and there will not be one.** The structure a doc page
needs is small and closed, so enumerating it is cheaper than shipping a parser
for it — and §13 left 8,450 bytes of advisory headroom. The block switch carries
a `never` exhaustiveness check, so adding a kind without a renderer is a compile
error rather than a silently blank page.

*Three markdown backticks were caught in review* and removed. There is no
renderer, so a backtick-wrapped function name would have rendered its backticks
literally. Prose carries no markup; structure comes from choosing the right
block kind.

### Pages

Six, in reading order. `how-a-prediction-is-made` was added mid-PR at the
product owner's request and sits **second**, as the orientation page.

| Page | What it answers |
|---|---|
| About | Purpose, architecture, backend/frontend split, workflow |
| How a prediction is made | One number from a CSV row to a chart, in seven steps |
| Forecasting models | All six in `REGISTRY`, five fields each |
| How forecasting works | Pipeline, intervals, horizons, uncertainty, selection |
| Reading the dashboard | Every chart and metric, and how to interpret it |
| Data quality | Missing data, coverage, and why volume bounds accuracy |

**The models page documents six models, not the three the brief named as
examples** — `seasonal_naive`, `linear_regression`, `random_forest`, `xgboost`,
`prophet`, `sarima`, which is what `models/registry.py` actually contains. The
brief said to use the models actually present, and that is six.

**Every numeric claim was verified against source during review**, not taken on
trust: the `min_observations` floors (14 seasonal-naive, 28 SARIMA, 30 for the
other four) against `config.yaml`; `n_cycles = 4` against `baseline.py`;
XGBoost's reduction to 200 boosting rounds under 60 training rows against
`tabular.py:178`; RidgeCV with `StandardScaler` and median imputation with an
indicator column against `tabular.py:47,87`. All correct as written.

One claim contradicted this document and the code was right: §5 says
de-duplication matches on content plus within-file position, but
`ingest.py:564-571` dedupes on `call_id` when the export has one and falls back
to content-plus-position only when it does not. **§5 is the stale line here.**

The data-quality page quotes §4's real result — MASE 1.34 / 0.80 / 1.36 on the
71-day export against 0.79 / 0.69 / 0.79 on the 210-day sample. That the honest
number is also the most useful thing that page can say is the reason it leads
with it.

### The diagram is vertical at every width, and that was a fix

The step flow was built to turn horizontal above 480px. It does not, and the
reason is worth recording: every step carries a sentence of detail, so in a row
each step is wide enough to wrap onto a line of its own — leaving the steps
stacked vertically while the connectors, un-rotated by the horizontal rule,
still pointed **right**. A diagram whose arrows disagree with its own layout is
worse than one that never turns. Found in browser verification at 1280px, not by
a test. The media query now caps the measure instead of changing the direction.

*The connector's box is a square on purpose.* A transform does not change an
element's layout box but it does contribute to the scrollable overflow area, so
a wider-than-tall glyph rotated 90° pushed past the figure's right edge and
earned it a few pixels of horizontal scroll at 375px.

### Tests: 395 frontend, up from 313

| File | What it pins |
|---|---|
| `lib/docs/route.test.ts` (18) | parse/apply, degradation of unknown view and page, round-trip of every id, and — the point — that the two writers do not erase each other in either direction |
| `content/docs/content.test.ts` (28) | every id has a page, a `modelCard` per name in `REGISTRY`, all five fields non-empty, uniform table row widths, and the seven prediction-flow step labels **in order** |
| `components/docs/DocsNav` · `DocsView` · `DocsBreadcrumbs` (24) | page list and order, one `aria-current`, arrow/Home/End focus movement without selection, Enter still commits, the bold-width reservation, prev/next at the ends |
| `components/docs/blocks/DocBlocks.test.tsx` (12) | every kind's semantic element by role, table accessible name from its caption, a `pre`/`code` pair carrying `data-language`, the model card's five labelled groups, native `details` toggling |

No existing test was modified or weakened — the only changed source files are
`App.tsx`, `DashboardHeader.*`, `selection.ts` and `useHashSelection.ts`, and
all 25 selection tests pass against the additive `base` parameter untouched.

### Verified against a live dev server

At 1280px and 375px, on the 210-day sample fixture, driving the real controls:

```
#model=total_cost&horizon=30    report   6 figures · rail on "Daily cost"
  header "Docs"                 docs     0 figures · hash gains &view=docs
  rail "Reading the dashboard"  docs     &page=metrics · h2 changes
  "Back to report"              report   6 figures · selection intact
```

Six nav pages in `DOC_PAGE_IDS` order; heading hierarchy h1 to h2 to h3 with no
skipped level; six model cards with **text** labels for strengths and weaknesses
rather than colour alone (§6); dark and light both resolve from tokens
(`#0d0d0d` / `#f9f9f7`); zero horizontal page overflow at 375px and 1280px; the
rail collapses to a strip below 900px; no console output beyond Vite and React
DevTools notices.

**Note for the next browser pass.** `resize_window` *did* take this time, unlike
§11's experience — 375px and 1280px both applied and the media queries responded.
Screenshots, however, render at a fraction of scale in this pane and are not
readable; the DOM assertions above are the reliable instrument, which is what
§11 already concluded by a different route.

**Unverified, unchanged from PRs 5–13 and still the pane rather than the code.**
Live resizing, and keyboard *activation* of a rail button. Still one pass in a
real browser.

### Both size advisories were crossed, and both were raised

§13 said "the next PR of any size will cross it" with 8,450 bytes of headroom.
It did.

| Gate | Was | Now | This PR | Limit (unchanged) |
|---|---|---|---|---|
| Committed template | 1,750,000 | **1,800,000** | 1,770,745 | 2,600,000 |
| Generated dashboard | 2,000,000 | **2,100,000** | 2,046,019 | 3,000,000 |

That is the two-tier policy working as §12 designed it. **No dependency was
added** — `package.json` and `package-lock.json` are untouched — so the ~54 KB
is prose held as data plus its renderers, which is the cheap kind of growth. The
limits are untouched and the lever if one is ever genuinely approached is
unchanged: the custom Plotly partial bundle, still ~85% of the template.

### Verified locally, PR 14

Node 24.18.0 · npm 11.18.0 · Python 3.12.10.

- `npm run typecheck` — clean.
- `npm test` — **395 passed** (313 before this PR).
- `npm run build` produced `dist/index.html` at **1,770,745 bytes** (1,716,276
  before).
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean (no `THEME` change — the docs use existing tokens only).
- `scripts/check_bundle_size.py` — **2,046,019 of 2,100,000**, 53,981 of headroom.
- `pytest tests/ -q` — **265 passed**, exit 0. `--doctest-modules` — 18
  (17 passed, 1 skipped). §4's collection crash did not reproduce. Nothing under
  `call_forecast/` changed except the regenerated template, so this is
  confirmation rather than coverage of new Python.

### Two things left for later

- **`Callout` still takes `children: string`**, so a doc callout is prose with
  no inline emphasis or links. §12 recorded the same limit; a `ReactNode`
  overload is the change when a callout needs a link.
- **The docs need a loaded payload to be reachable**, because they render inside
  the shell and the error branch returns before it. In production the payload is
  inlined in the same file, so a load failure is close to impossible — but a
  reader who hits the error screen is exactly the one who would benefit from an
  explanation, and the pages themselves depend on no payload at all.

---

## 15. Phase 2 — External Integrations

**Added by PR 15** (branch `feature/external-integrations`). Frontend only: no
Python changed, no payload field added, `SCHEMA_VERSION` untouched. The one
non-frontend file in the diff is `call_forecast/assets/dashboard_template.html`,
the committed build artefact, re-synced per §6.

Goal: an **External Resources** section in the sidebar — RetellAI's dashboard,
the repository, the README — kept visibly and structurally apart from the model
rail. Deliberately small: one config file, one component, one stylesheet, two
one-line renders.

### The links are anchors, and that is the whole safety argument

Everything else in either rail is a `<button>`, because selecting a model or a
doc page filters the view *in place*. These three go to another document on
another origin, which is the contract an anchor makes and a button does not.
Choosing `<a href target="_blank">` is what makes four of this PR's requirements
true by construction rather than by care:

- **They cannot become a selected page.** `aria-current` is how both rails mark
  the current one; nothing in `ExternalLinks` ever sets it, and no stylesheet
  rule here reads it. There is no selected state to apply.
- **They cannot touch the URL state.** An `href` to an absolute `https:` URL
  replaces the document rather than editing the fragment. The collision
  `AppShell`'s skip link had to defend against (§11 — following `#report` would
  *write* the fragment and clear the model selection) simply does not arise for
  a link that leaves the page. `ExternalLinks` reads and writes no `location`,
  registers no click handler, and holds no state.
- **Keyboard access is the platform's.** Enter activates; the browser's own
  open-in-new-tab affordances work. Nothing to reimplement and nothing to break.
- ***`moveFocus` cannot see them.*** Both rails' arrow-key handlers read
  `event.currentTarget.querySelectorAll('button')`, and the section is rendered
  as a sibling *outside* `.tabs` besides. Arrow/Home/End movement is therefore
  unchanged by this PR at the level of what the code can reach, not merely
  observed to be unchanged — and `ExternalLinks.test.tsx` re-pins it anyway,
  because this is the PR that could have broken it.

`rel="noopener noreferrer"`. `noopener` denies the opened page a handle on
`window.opener`; `noreferrer` keeps this dashboard's `file://` or intranet URL
out of a third party's referrer log. Both matter more than usual here — the
shipped artefact is a single self-contained HTML file that gets mailed around.

### One config file, and the component knows nothing about any entry

`src/config/externalLinks.tsx` exports `EXTERNAL_LINKS: ExternalLink[]` —
`{ id, label, href, description, icon }`. **It is the only place these URLs
appear.** Repointing, adding or removing a link is an edit there and nowhere
else; `ExternalLinks` maps over whatever it finds and returns `null` on an empty
array.

`.tsx` rather than `.ts` because `icon` is a `ReactNode`. This codebase had **no
icon system at all** before this PR — no SVG in any component, no icon library —
so rather than introduce one, the three icons are inline 16px line SVGs defined
beside the entries they belong to. They stroke in `currentColor`, which is the
whole theming story: an icon inherits the link's colour and so restyles with
hover, focus and the light/dark toggle without a single theme-aware rule of its
own. Every icon is `aria-hidden`, because each sits beside its own text label.

`description` does double duty: the `title` attribute (the hover tooltip) and a
visually hidden tail on the accessible name. Three links that all leave the page
read identically to a screen reader without it, and "opens in a new tab" is
exactly the part a screen-reader user cannot get from the trailing indicator
glyph.

**Documentation points at the repository README, not at the in-app docs.** The
header's "Docs" control already reaches those, and they are a *view of this
page* rather than a destination on the web — sending a reader off-site for
something they can read in place would be the worse of the two, and would also
have made an external link behave like dashboard routing, which is the one thing
this section must not do.

### Rendered in both rails, from one component

`SideNav` renders it below `.tabs` and above the live region; `DocsNav` renders
it below "Back to report". Same component, same config, nothing docs-specific —
the docs view is where a reader is most likely to want the repository, and a
shortcut section that vanished on the way there would read as a bug.

It sits **outside** `.tabs` in both, which is what keeps every `[aria-current]`
rule and both `moveFocus` handlers scoped to the tabs alone.

**One consequence worth knowing.** `SideNav` returns `null` on an empty `tabs`,
and `App` omits the rail entirely when a run produced no forecasts — so on that
payload there is no sidebar and therefore no external links either. That is the
existing rail fallback (§8, "with no rail the report falls back to a single
full-width column") left deliberately unchanged rather than an oversight;
changing it would have meant editing `AppShell`'s nav contract, which is outside
what this PR was scoped to touch.

`ExternalLinks.module.css` reuses the rails' spacing scale, radii, `--motion-*`
tokens and hover treatment — one visual language, no new palette entry, no
`THEME` change (`gen_tokens.py --check` is clean). What it deliberately does not
copy is the `background-size` active-indicator machinery from §11: there is no
selection here to indicate. Separation is a `border-top` plus 20px of space — a
footnote to the rail, not a competing panel.

**Below 900px the separator stays a top rule.** A left rule was written first
and discarded: at that width the section is stacked *below* the tab strip in
`SideNav` and wrapped onto its own line in `DocsNav`'s flex row, so a left rule
would be drawn beside nothing in both. The list wraps rather than scrolls —
three fixed links fit on two rows, and a second horizontal scroller under the
tab strip would be one too many. `flex: 1 0 100%` is what makes `DocsNav`'s row
break the line before the section instead of tucking it beside the last tab.

### Tests: 406 frontend, up from 395

`shell/ExternalLinks.test.tsx` (+11): one link per config entry in order,
`target="_blank"` with both `rel` tokens on every link, every `href` absolute
`https:` (a relative or `#` href would edit the fragment that carries the
selection), no `aria-current` anywhere, the accessible name carrying the
description, every icon `aria-hidden`, Tab reaching each link in turn, and —
inside a real `SideNav` — that the section holds no buttons, that both `<nav>`s
keep their own labels, and that End-then-ArrowDown still wraps within the model
tabs rather than walking into the links.

No existing test was modified or weakened.

### Verified against a live dev server

Port 5177, on the 210-day sample fixture. The `<nav aria-label="External
resources">` renders three links with the configured hrefs in order, each
`target="_blank" rel="noopener noreferrer"`, each with its `title`, each with
two SVGs (icon + indicator), none with `aria-current`. Two labelled navigation
regions on the page, "Models" and "External resources".

- **Tab order**, from the top of the rail: All → the three model tabs → the
  three external links → the import control. One stop per link, in DOM order.
- **Selection is untouched.** `#model=total_cost&horizon=30` still filters to
  6 figures with exactly one `aria-current` on the rail and zero in the external
  section; the fragment reads back byte-identical after the section is rendered
  and tabbed through.
- **Docs routing is untouched.** "Docs" → `#model=total_cost&horizon=30&view=docs`
  with the section present and sitting after "Back to report"; "Back to report"
  → `#model=total_cost&horizon=30` and 6 figures again. The model selection
  survives the round trip.
- **Theme.** Link colour resolves `--ink2` at `#52514e` light / `#c3c2b7` dark
  across a toggle, and the separator restyles with it. The icon colour is
  `--muted`, which is the same value in both palettes — a property of the
  audited palette, not a missed rule.
- No console output. No horizontal page overflow.

***§11's instrumentation trap bit again and the next person should not re-find
it.*** The pane does not composite when it is not displayed, so **every
transitioned property freezes at its start value** — the first theme read
reported the link's colour as unchanged across a full light/dark toggle while
the untransitioned separator restyled correctly. Injecting
`* { transition: none !important }` before reading resolves it, which is how the
colours above were measured. This is the technique to reuse, and it is now the
second PR to rediscover it.

**Unverified, unchanged from PRs 5–14 and still the embedded browser rather than
the code.** A screenshot could not be taken at all — the pane must be displayed
to composite, and it was not. `resize_window` still does not take: `innerWidth`
stayed at 944 after a request for 375, so the ≤900px assertions rest on the
media query being active (`flex-direction: row`, the wrap observed, no page
overflow) rather than on a real 375px viewport. Live resizing and keyboard
*activation* likewise. One pass in a real browser is still owed, and this PR
adds nothing new to that list.

### Verified locally, PR 15

Node 24.18.0 · npm 11.18.0 · Python 3.12.10.

- `npm run typecheck` — clean.
- `npm test` — **406 passed** (395 before this PR).
- `npm run build` → `dist/index.html` at **1,775,038 bytes** (1,770,745 before);
  +4,293 for the config, the component and its stylesheet. No dependency added,
  so `package.json` and `package-lock.json` are untouched.
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean.
- `scripts/check_bundle_size.py` — **2,050,312 of 2,100,000**; headroom 49,688,
  down from 53,981. Both gates unchanged from §14.
- `pytest tests/ -q` — **265 passed**, exit 0, in `~/.venvs/callforecast`
  (pytest 9.1.1 · pandas 3.0.5). §4's collection crash did not reproduce.
  ***This checkout does have a Python environment*** — §11 and §12 recorded that
  it did not, which was true of the shell those sessions ran in, not of the
  machine. The Python result is confirmation rather than coverage: nothing under
  `call_forecast/` changed except the regenerated template.

---

## 16. Phase 3 — Landing Experience

**Added by PR 16** (branch `feature/landing-experience`). Frontend only: no
Python source changed, no payload field added, `SCHEMA_VERSION` untouched. The
one non-frontend file in the diff is
`call_forecast/assets/dashboard_template.html`, the committed build artefact,
re-synced per §6.

Goal: the application opens on a welcome screen, and the dashboard renders only
once the reader chooses to enter.

### The question that shaped the PR

**Before this, the first thing a new reader saw was a full report describing
data they had never supplied.** `loadPayload()` falls through to the committed
sample fixture in development and in any build without an inlined payload, so
the application opened onto twelve charts of synthetic 210-day data with
nothing on the page saying so. That is the §10 failure — a page asserting
agreement it has not got — arriving *before* the dashboard rather than inside
it. The landing page renders no chart, no table, no tile and no payload number.

### The gate is component state, and deliberately not a fragment key

```
location.hash === ''            landing page
location.hash === '#model=…'    the report, filtered, as before
location.hash === '#view=docs'  the documentation, as before
```

`App` holds one boolean, `entered`. ***It is not a URL key, and that is the
decision most likely to be second-guessed.*** Two writers already share this
fragment (`selection.ts` and `docs/route.ts`, each rewriting only the keys it
owns — §14), and a third meaning "has this reader entered yet" would put
session-shaped state into a URL that gets emailed around: the recipient of
`#entered=1` would skip a welcome screen they had never seen.

**`lib/entry.ts` is the bypass, and it is the whole interface between the URL
and the gate.** One pure function, `isDeepLink(hash)`, true when the fragment
carries any of `model`, `horizon`, `view` or `page`. A link someone was sent
names a view, and putting a welcome screen in front of it would break exactly
the linkability PRs 7 and 14 built the fragment for. It is returned from
`useHashSelection` rather than read from a second hook, so **there is still
exactly one `useSyncExternalStore` subscriber** and no component reads
`location`. Nothing on the landing page writes a fragment — asserted in both
the component and the `App` tests.

A key added to `selection.ts` or `docs/route.ts` and forgotten in `VIEW_KEYS`
costs a deep link its bypass — the reader sees the welcome screen once and
everything still works — rather than corrupting any state. That is why the
union is one list here instead of two exported private constants.

### What the page offers

| Control | Kind | What it does |
|---|---|---|
| Import Dashboard | `<button>` | enters, then focuses the existing `ImportPanel` |
| Open dashboard | `<button>` | enters |
| Documentation & about | `<button>` | opens the in-app docs (§14) — real, not a placeholder |
| GitHub | `<a target="_blank">` | `config/externalLinks.tsx`, the only place the URL lives (§15) |
| Recent imports | — | an honest empty state; PR 18 fills it |

The button/anchor split is §15's argument reused: three of these change what
this page shows, and one genuinely leaves it. `rel="noopener noreferrer"` for
the same two reasons.

***"Import Dashboard" is not a fragment anchor.*** `Section` gained an optional
`id` and `App` scrolls to `#data-source` and focuses the panel's first control
in an effect — a bare `#data-source` in the fragment would overwrite the
selection, which is §11's skip-link trap arriving in a third place. The scroll
call is optional (`scrollIntoView?.()`) because jsdom implements no scrolling
and a missing scroll must not cost the reader the focus move.

### The gate is one-directional, and it had to be made so

***A bug found in review, not by a test.*** `deepLink` is a fact about the
*current* fragment, and the fragment is cleared in ordinary use: selecting
"All" on the rail drops `model=`, and leaving the docs drops `view=`. Both can
empty it completely. A reader who arrived on `#model=total_cost` and then
pressed "All" was therefore thrown back to the welcome screen mid-session — the
fragment had stopped naming a view, but they had plainly already entered.

An effect latches `entered` the moment a deep link is seen. Nothing in `App`
ever sets it back to false, so there is one direction of travel and no path
that can eject a reader from the application. Reproduced and confirmed fixed in
a real browser (`#model=total_cost` → "All" → fragment `''`, still in the
report, 12 figures) and pinned by two tests, one for each way the fragment
empties.

**Opening the docs from the landing page also marks the reader as entered**, so
the docs' "Back to report" lands on the report it names rather than bouncing
them to the welcome screen they have already answered.

**Recent imports is a placeholder and says so.** Nothing records an import
history, so the section states that instead of listing plausible-looking files
nobody imported — the same reasoning §12 applied to the anomalies section.

### Two contrast fixes made during verification, not after

`--series1` was the obvious accent and it is wrong for text. Measured in the
pane: white on `--series1` is **4.46:1** light and **3.64:1** dark, both under
AA at this size. The primary button uses `--seq-4` instead — **5.39:1 in both
palettes**, because the sequential ramp is the same seven steps in each, so the
button needs no theme-aware rule. The hero eyebrow moved from `--series1` to
`--ink2` (7.53:1 light / 10.85:1 dark). The series hues are tuned to sit in a
plot area against a line, not to carry 13px text on the page background.

`#ffffff` on the primary button is the one colour literal, and it is
deliberate: `--ink` inverts with the theme, which on a blue button that does
not invert would be dark text on blue in the dark palette.

### Tests: 432 frontend, up from 406

| File | Tests | What it pins |
|---|---|---|
| `lib/entry.test.ts` | 6 | the bypass — nothing, a bare `#`, both writers' keys, and `#report` (the skip link's href) *not* counting as a view |
| `components/landing/LandingPage.test.tsx` | 11 | every action and its kind, the repository link's `href`/`target`/`rel` read from the shared config, the empty state, heading hierarchy, full tab order, Enter/Space on the primary action, no chart/table/rail, and no fragment written |
| `App.test.tsx` | +9 | opens on the landing page, enters, the import action's focus move, both deep-link bypasses, the docs round trip, that entering writes no fragment, and — the review bug — that clearing the fragment from inside the report does not eject the reader |

**One existing test file was touched and no assertion in it changed.**
`App.test.tsx`'s shared `renderApp()` helper now clicks "Open dashboard" when
the fragment is empty — the same click a reader makes. Tests that set a
fragment first are deep links and skip it. This is the PR 8 shape: a deliberate
change to what the application does on load has to be visible in the test that
loads it.

### Verified against a live dev server

Port 5178, on the 210-day sample fixture. A fourth launch configuration was
added for it (§13's machine hazard — the Desktop clone is stale and another
session held 5177).

```
(no fragment)                    landing · 0 figures · 0 tables · no rail
  "Open dashboard"               report  · 12 figures · 17 tables · both navs · hash still ''
#model=total_cost&horizon=30     report directly · 6 figures · one aria-current · landing skipped
  reload with no fragment        landing again
  "Documentation & about"        docs · #view=docs · 0 figures
  "Back to report"               report · 12 figures · hash ''
  "Import Dashboard"             report, focus on the import panel's "Choose file"
```

Responsive: **375px** — no page overflow (375/375), capability cards stacked,
both hero buttons full width, title clamped to 32px. **768px** — no overflow
(753/753), cards in two rows, title 42px. **1280px** — no overflow (1265/1265).
Theme toggle restyles the whole page from tokens in both directions. Tab order
from the top: theme toggle → Import Dashboard → Open dashboard, each with the
2px focus ring. No console output beyond Vite and React DevTools notices.

***§11's instrumentation trap applies here too*** and the contrast numbers
above were read after injecting `* { transition: none !important }`. Note also
that `ThemeProvider` writes `data-theme` in an effect, so a computed-style read
in the same tick as the toggle click reports the *previous* theme — the same
one-render-stale fact `useChartPalette` exists for, arriving in a measurement
rather than in a render.

**Unverified, unchanged from PRs 5–15 and still the pane rather than the
code.** Keyboard *activation*: the pane delivers a trusted Return to the
focused "Open dashboard" button and performs no default activation, so nothing
happened — the behaviour is jsdom-tested in both files above and is the HTML
spec's for a real `<button>`. A screenshot could not be taken: the pane must be
displayed to composite, and it was not. Live resizing likewise.

### Verified locally, PR 16

Node 24.18.0 · Python 3.12.10.

- `npm run typecheck` — clean.
- `npm test` — **432 passed** (406 before this PR).
- `npm run build` → `dist/index.html` at **1,784,183 bytes** (1,775,038 before);
  +9,145 for the landing component, its stylesheet, `lib/entry.ts` and the
  wiring. No dependency added — `package.json` and `package-lock.json` are
  untouched.
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean (no `THEME` change — existing tokens only).
- `scripts/check_bundle_size.py` — **2,059,457 of 2,100,000**; headroom 40,543,
  down from 49,688. Both advisories and both limits unchanged from §14.
- `pytest tests/ -q` — **265 passed**, exit 0, in `~/.venvs/callforecast`.
  `--doctest-modules` — 18 (17 passed, 1 skipped). §4's collection crash did
  not reproduce. Nothing under `call_forecast/` changed except the regenerated
  template, so this is confirmation rather than coverage of new Python.

### Remaining Phase 3 work

- **PR 18 — import history.** `Recent imports` is the placeholder it fills: a
  heading, a region and an empty state, with no storage, no list and no
  persistence written yet. Whatever records the history will also need to
  decide where it lives — nothing in this codebase persists anything but the
  theme preference (`localStorage`) and the last export format
  (`sessionStorage`), and a `file://` page has an opaque origin where even
  reading storage can throw (§13).
- **The human-readable dashboard summary** is a separate piece of work and was
  deliberately not built here.
- **Still owed, and now five PRs old:** one pass in a real browser for keyboard
  activation and live resizing.

---

## 17. Phase 3 — Executive Summary Cards

**Added by PR 17** (branch `feature/executive-summary-cards`, cut from
`feature/landing-experience`). Frontend only: no Python source changed, no
payload field added, `SCHEMA_VERSION` untouched. The one non-frontend file in
the diff is `call_forecast/assets/dashboard_template.html`, the committed build
artefact, re-synced per §6.

Goal: a reader can answer how many calls, at what cost, on which model and in
which period **before** they read a chart.

### Where it sits, and what it does not replace

A new `Executive summary` section between `Data source` and `Data quality` —
first in reading order after the import panel, because that is the order it
exists to enable. **Nothing below it changed.** All nine `build_dashboard()`
sections, all 12 figures and all 17 tables render exactly as they did; this PR
adds a way in, it does not replace the analysis.

It deliberately **does not** subsume `At a glance`. The two overlap on two
numbers and answer different questions: the tiles are the run's descriptive
headline (calls ingested, alerts raised), the cards are the forecast's
decision-relevant one (which model, which period, what change). Merging them
would have meant rewriting a section §10 already made consistent, for no
reader benefit.

### The eight cards, and where each number comes from

| Card | Source | Kind |
|---|---|---|
| Forecasted calls | `forecasts.call_volume.horizons` via `headlineRollup` | payload |
| Forecasted cost | `forecasts.total_cost.horizons` | payload |
| Average call duration | `forecasts.avg_duration_sec.horizons` | payload |
| Highest confidence model | `evaluations[t].leaderboard`, ranked on `mase` | payload |
| Prediction horizon | `selection.horizon` + first/last trimmed forecast date | payload |
| Largest predicted change | forecast per-day figure vs the observed trailing mean | **derived — see below** |
| Peak call day | `max(yhat)` over `trimDaily(forecasts.call_volume.daily)` | payload |
| Highest risk period | `selectAnomalies(...)` grouped by calendar month | payload, **historical** |

### `lib/executiveSummary.ts` is the third layer, built on the second

`selection.ts` answers "what did the reader choose"; `selectionView.ts` answers
"which slice of the payload does that name"; this module answers "what are the
eight numbers". **It is built on the second rather than beside it** — every
horizon trim, anomaly scope and target-visibility test comes from
`trimDaily` / `headlineRollup` / `selectAnomalies` / `isTargetVisible`, so a
card and the chart under it cannot disagree about what is on show. That is the
same duplication hazard `selectionView.ts`'s own doc comment was written
against, arriving one layer up.

Pure: payload in, `ExecutiveMetric[]` out. No DOM, no `location`, no React —
which is why the 26 assertions that matter run without jsdom.

***`headlineRollup(forecast, horizon, 30)` is shared with the at-a-glance
tiles on purpose.*** Both prefer 30 days and both fall back to the longest
rollup at or under the reader's horizon, so the executive card and the tile a
few hundred pixels below it quote one row rather than two numbers that agree
by coincidence.

### The one derivation, and the payload field whose absence forces it

***Largest predicted change is the only card the payload cannot answer, and
the derivation is deliberately the smallest one that does.*** It divides two
numbers Python produced — the forecast's per-day figure over the chosen
horizon, and the observed per-day figure over the same number of trailing days
from `payload.daily` — and reports the percentage between them. No model, no
fit, no smoothing, no trend estimator: it is the comparison a reader makes by
eye between the two halves of the forecast chart, made once instead of three
times.

**The missing dependency, stated plainly:** `serialize.py` emits no growth,
trend or period-over-period field. If a future PR wants a *real* trend — a
fitted slope, a seasonal decomposition, a significance test — that belongs in
Python beside `forecast.py` and arrives here as a payload field, and
`growthMetric` should be deleted the day it does.

Three guards keep it honest, and each is a test: a zero baseline is skipped
rather than reported as `+∞%`; a window with fewer than `max(3, days/2)`
observed values produces no baseline at all (`avg_duration_sec` is null on 59%
of real days); and targets are compared on **relative** change, because
seconds, dollars and calls cannot be ranked by absolute movement.

### Two cards that had to be honest about what they are not

**Highest risk period is historical, and the card says so.** `anomalies.py`
evaluates *observed* days; nothing in the payload scores a future period, and
manufacturing one from interval widths would be exactly the fabricated finding
§10 exists to remove. So it reports the month carrying the most flagged days
and labels the number `(observed, not forecast)`. It ranks on critical days
with warnings only as a tiebreak — five warnings are not one critical, and
summing them would say they were. Under `analysisAvailable === false` (a CSV
this browser aggregated) it reports that nothing analysed the data rather than
that nothing was found: §12's distinction, arriving in a ninth place.

**Highest confidence model ranks on MASE, because that is what the pipeline
selects on** (§3). Re-ranking on MAE or R² here would have put a card on the
page disagreeing with the leaderboard below it about which model won. Two
subtleties are pinned by tests: a row with a null MASE is a *skipped* model and
may be named but never win a comparison — treating a missing score as a good
one is how a card crowns the model that never ran — and the `good` tone is
carried only when MASE < 1, so the card cannot read as reassuring while the
model is losing to "repeat last week".

### State: there is none, and that is the design

`ExecutiveSummarySection` holds no state. Every card is a pure function of four
props `App` already owns — the payload (replaced in place by `handleImport`),
`selectedTarget` and `horizon` (the URL fragment, read by the one
`useHashSelection` subscriber) and `analysisAvailable` (held beside the
payload). **No second model state, no local horizon copy, nothing to keep in
step.** A rail click and an import both move the grid on the next render for
free, and the `useMemo` depends on exactly those four props, so it recomputes
precisely when the cards must change.

**A card the rail removed and a card the payload could not fill are different
facts and render differently.** A target-scoped card is *absent* under a
selection that excludes it (the `AtAGlanceSection` behaviour); a card whose
metric the payload cannot answer is *present* with an em dash and **a sentence
naming the missing dependency**. A grid that rendered those identically would
teach the reader to ignore both. Every unavailable branch in the module names
its cause — `avg_duration_sec`, whose learned models the `min_observations`
floor skips on the real export, is the one that actually fires in production.

### Components

`components/summary/` — `ExecutiveSummaryCard` (one card) and
`ExecutiveSummarySection` (the grid, the `Section` wrapper and the scope
blurb), exported through an `index.ts` the way every other component directory
is.

***The card is not a `StatTile`, and the difference is the unavailable
state.*** A tile is a headline number and cannot express "this could not be
computed, and here is why", which is a requirement here rather than an edge
case. Extending `StatTile` with an unavailable variant would have put that
state on every tile in the at-a-glance grid, where nothing needs it. The card
formats nothing — every string arrives resolved from `executiveSummary.ts`,
for the reason that module documents.

**The grid is a real `<ul>`.** Eight sibling cards give a screen reader no
sense of how many there are or where in the set it is, which is precisely what
the grid gives a sighted reader. It is `auto-fit` with a 240px floor — four
columns on a desktop, two on a tablet, one on a phone, and correct at the
900px width where the rail collapses and the content region gains 220px —
rather than three named breakpoints. The floor is 240px against `TileGrid`'s
190px because these cards carry a sentence under the number, and that is why
this is its own grid and not `TileGrid`.

### One contrast departure from `StatTile`, measured

`.label` uses `--ink2`, not `--muted`. Measured in the pane: `--muted` on
`--surface` is **3.50:1** light and 4.85:1 dark — under AA for 12px text in the
light palette, which is what `StatTile` ships today. `--ink2` is **7.73:1**
light and **9.72:1** dark. The recession a label needs is carried by the size,
the weight and the uppercasing, none of which cost contrast; only the colour
did. Same call §16 made moving the landing hero's eyebrow off `--series1`.

The value colours were measured too and all clear AA at 23–26px bold (the 3:1
large-text threshold): `--good` 3.27 light / 5.19 dark, `--critical` 4.68 light
/ 3.62 dark, `--ink` 19.17 / 17.42, `--ink2` detail lines 7.73 / 9.72. **Colour
is never the only signal** — every toned card states its finding in words on
the detail line underneath. Every value is an existing token; no literal, no
`THEME` change, `gen_tokens.py --check` clean.

### Tests: 469 frontend, up from 432

| File | Tests | What it pins |
|---|---|---|
| `lib/executiveSummary.test.ts` | 26 | the fixed card order, the shared 30-day preference, that no card quotes a horizon the forecast cards trimmed away, MASE ranking including the null-MASE trap, `Infinity` not printing as a horizon, growth in both directions plus all three guards, peak day inside the trim, risk ranking and the observed/unchecked/clean three-way, and — as a sweep — that no metric is ever `null` without a reason |
| `components/summary/ExecutiveSummarySection.test.tsx` | 11 | the heading, the cards as a list, the headline figures, an unavailable card stating its reason rather than showing a bare dash, the scope blurb, and the four state paths: selection change, "All" restoring the aggregate, a horizon change retrimming, and an import swapping the payload |

**No existing test file was touched and no existing assertion changed.**
`App.test.tsx` passes unmodified with the new section in the tree, which is the
evidence that this PR is additive.

### Verified against a live dev server

Port 5179, on the 210-day sample fixture. A fifth launch configuration was
added for it (§13's machine hazard: the Desktop clone is stale and 5175–5178
were taken).

```
(entered, no fragment)   8 cards · 11 section headings · 12 figures · 1265/1265
  rail → Daily cost      #model=total_cost · 5 cards · cost, cost's own
                         Random Forest at MASE 0.79, horizon, change, risk
                         rescoped from April (9 crit) to June (7 crit)
  rail → All             8 cards restored, aggregate values back
  horizon → 30           horizon card 30 Jul – 28 Aug 2026, peak day moves
                         from 01 Sep to 31 Jul — inside the trim
```

Responsive: **375px** — no overflow (375/375), one column, value type at 23px.
**768px** — no overflow (753/753), two columns. **1280px** — no overflow
(1265/1265). Theme toggle restyles the section from tokens in both directions
(surface `#fcfcfb` → `#1a1a19`, label 7.73 → 9.72). No console output.

***§11's instrumentation trap applies*** — the contrast numbers were read after
injecting `* { transition: none !important }`, and `ThemeProvider` writes
`data-theme` in an effect, so a computed-style read in the same tick as the
toggle reports the *previous* theme. Both bit once during this PR.

**Unverified, unchanged from PRs 5–16 and still the pane rather than the
code.** Keyboard activation and live resizing. The pane also pinned the
viewport at 265px for the screenshot, so the desktop multi-column layout was
confirmed by computed `grid-template-columns` and measured card widths rather
than by eye.

### Verified locally, PR 17

Node 24.18.0.

- `npm run typecheck` — clean.
- `npm test` — **469 passed** (432 before this PR).
- `npm run build` → `dist/index.html` at **1,792,653 bytes** (1,784,183 before);
  +8,470 for the module, two components, two stylesheets and the wiring. No
  dependency added — `package.json` and `package-lock.json` are untouched.
- `scripts/sync_template.py` re-run and `--check` clean; `gen_tokens.py --check`
  clean.
- `scripts/check_bundle_size.py` — **2,067,927 of 2,100,000**; headroom 32,073,
  down from 40,543.
- **`pytest` was not run, per §18.** This change does not cross `serialize.py`
  or the payload contract; the only Python-adjacent file in the diff is the
  regenerated template, whose gate is `sync_template.py --check`.

### Remaining Phase 3 work

Unchanged from §16, less this item:

- **PR 18 — import history.** The landing page's `Recent imports` placeholder.
- **Import preview, import animations, navigation redesign, the Forecast
  Insights panel and the desktop application** are all still unbuilt and were
  explicitly out of scope here.
- **Still owed, and now six PRs old:** one pass in a real browser for keyboard
  activation and live resizing.
- **Headroom is the thing to watch.** 32 KB against the 2.1 MB budget, down
  from 40 KB. §8 names the lever when it goes: a custom Plotly partial bundle,
  not a trimmed payload.

---

## 18. Testing Workflow Instructions

**Standing instruction for Claude Code sessions on this repository.** It is
about *when* to run the suites, not what they cover — §4 has the suite's health
and §9 has what CI runs.

This repository has an established CI pipeline (§9), and **the current branch
should be assumed to be passing unless there is evidence otherwise.**

**Do not run the full Python suite (`pytest tests/ -q`) at the start of a task
or a PR request.** It takes several minutes. Run it only:

- before a final PR or commit;
- when explicitly requested;
- when the change touches broad backend functionality and targeted testing is
  not sufficient to cover it.

During implementation:

- Skip baseline test verification.
- Inspect the relevant files first.
- Run targeted tests for the files actually modified, where that is possible.
- Do not spend time validating unrelated parts of the repository.

Preferred workflow:

1. Understand the requested change.
2. Inspect the relevant code paths.
3. Implement the change.
4. Run targeted validation.
5. Run the complete suite only before final completion.

**For frontend-only changes** (React / TypeScript / UI), do not run the Python
suite at all unless the change affects Python-generated data contracts,
serializers, APIs or backend behaviour. `serialize.py` and the payload contract
are the line: a change that does not cross it is checked by `npm run typecheck`,
`npm test`, `npm run build` and `scripts/sync_template.py --check`.

*Note that a frontend change still regenerates
`call_forecast/assets/dashboard_template.html` (§6, §8) — that is a build
artefact, not backend behaviour, and `sync_template.py --check` is its gate.
Regenerating it is not on its own a reason to run pytest.*

---

## 19. Phase 3 — Import Experience, and the bug report that was not one

**Added by PR 19** (branch `feature/import-experience`). Frontend, plus two
build scripts' advisory constants and the regenerated template artefact. No
`call_forecast/` behaviour changed, no payload field added, `SCHEMA_VERSION`
untouched.

**The first new runtime dependency since the migration began:**
`read-excel-file@9.3.5`. See "File formats" below for why, and what it cost.

### It started as "the import is dropping my data". It was not.

A real customer export (172 calls, 74 days) was imported and the dashboard
looked empty. The reported symptom was data loss. **The parser was correct and
it always had been** — verified by running `buildFromCsv` over the exact file:

```
rows_read 172 · rows_kept 172 · dropped {} · all 8 columns matched
74 daily rows (32 active) · 168 hourly cells summing to 172 · total_cost 28.41
2026-05-18: avg 10.0 · median 9.5 · max 23 · cost 0.22   (checked by hand)
```

Three separate things had stacked into one impression of failure, and only the
last two were defects:

1. **By design (§12).** A raw CSV has no forecasts, models, SHAP or anomalies;
   those *are* the Python package. Every one of those sections correctly
   returned `null`.
2. **A regression introduced by PR 17.** The executive summary sits at the top
   of the page and all eight of its metrics derive from `forecasts`,
   `evaluations` or `anomalies` — so a CSV import resolved every one to
   `value: null` and the first thing a reader saw after a *successful* import
   was a grid of eight em-dashes. §17 designed the per-card `unavailable`
   reason for a pipeline that ran and skipped a target, which is a finding
   worth showing; it is the wrong shape for "no pipeline ran", which is one
   fact about the whole payload. The grid is now replaced by a single sentence
   on that route, worded so it does not repeat the import note above it.
3. **The footer bug §12 predicted.** ***`DashboardFooter` read `config`
   unconditionally, and on the import route that config is
   `buildFromCsv`'s `placeholderConfig()` — all zeros.*** §12 closed with "a
   future section that reads `config` unconditionally must check"; this was
   that section, and it had been publishing:

   ```
   Interval level: 0% · simulated from 0 bootstrap trajectories
   Validation: rolling origin, 0-day horizon, selection on      <- no metric
   Business hours: 00:00–00:00 · overnight window 00:00–00:00
   Generated by call_forecast · <the import's own timestamp>
   ```

   Those are not empty states. They are false statements about settings, in the
   voice of the report's own methodology note, and the reader who hit them was
   already trying to work out why their import looked wrong. Gated now on the
   same `analysisAvailable` flag as the anomalies section, and for the identical
   reason: **an absent methodology and a methodology of zeroes mean different
   things, and the payload cannot tell them apart.**

**The lesson worth keeping.** A section that renders an empty state for missing
*data* is doing its job. A section that renders an empty state for a missing
*run* is asserting something false. Every new section that reads `config`, or
derives a figure from `forecasts`/`evaluations`/`anomalies`, must decide which
of those two it is doing — and `analysisAvailable` beside the payload, never a
field on it, is where that answer lives.

### Four parser bugs, none of which touched the reported file

Found by auditing `lib/import/` against `ingest.py` rather than by looking at
the data. Each was verified against the Python before anything changed.

| Bug | Was | Is | Why it mattered |
|---|---|---|---|
| `MAX_BAD_TIMESTAMP_SHARE` | `0.2` | `0.05` | The comment *claimed* 0.2 was the Python default. It is `0.05` (`config.py:69`). The importer had been **4× more permissive than the pipeline** since PR 12, so a file with one row in six unreadable imported clean. |
| `parseDurationToSeconds('2:')` | `120` | `NaN` | `Number('')` is `0` in JS where `float('')` raises. A truncated cell became an invented two-minute call that landed silently in the mean. |
| Duration range checks | absent | ported | `ingest.py:522` nulls a duration over 4h or below 0. One negative duration drags a day's average below every call in it. |
| Cost range checks | absent | ported | Same block; over $100 or below 0, nulled *before* the blank-cost `fillna(0)`, which is the order Python uses. |

A value failing a range check nulls the value, **not** the row — the call still
happened and still counts toward `call_volume`, matching Python. The counts
surface in `ingestion.dropped`, so the preview names them.

**Tightening the timestamp threshold is a real behaviour change** and is
recorded as one: a badly-malformed file that imported before may now be refused.
That is the audited pipeline's behaviour, and the refusal names the count, the
share and the limit.

**De-duplication is deliberately still not ported**, and the docblock now says
so instead of leaving the gap silent. Python de-dupes because it reads a
*directory* and two overlapping exports would double-count; a browser import
reads one file and replaces the payload wholesale, so re-importing the same file
yields the same dashboard rather than a doubled one. It is the first stage to
port if an import ever merges files.

**`crossValidation.test.ts` passed unchanged through all four fixes** — 630
value comparisons against the Python-generated fixture over 1,711 calls. That is
the evidence parity was restored rather than traded away.

### The remount that ate the success confirmation

***`AppShell` rendered `main` as a direct child without a rail and as a wrapper's
child with one, and React reconciles by position and type — so the rail
appearing or disappearing changed the shape of the tree and remounted the entire
report.***

A CSV or XLSX import is exactly that transition: the imported payload has no
targets, so `tabs` empties and the rail goes. `ImportPanel` set its success
state and was destroyed in the same commit, which is why the confirmation for
the *primary* import route could never be seen — while a `dashboard_data.json`
import, which keeps its targets and therefore its rail, showed it correctly.
Caught in browser verification, not by a test.

**It had already been documented as expected behaviour.** A PR 13 test in
`App.test.tsx` reopened the export panel after an import, under a comment
explaining that the import "remounts the report subtree — including the panel's
own open/closed state". That is a bug being accommodated in prose. The wrapper
is now unconditional with a `.layoutNoNav` modifier collapsing it to one column,
`main` holds its position, and the test asserts the panel *stayed open* instead.

Two `AppShell` tests now pin the property that actually broke — a stateful child
keeps its state across the rail appearing and disappearing — rather than
asserting class names, which would pass while the remount carried on.

### Import UX

Built on a base that already had drag & drop, keyboard activation,
`aria-live="polite"`, `role="alert"` and `aria-busy` from PR 12; none of it was
regressed. Added: an indeterminate spinner with a per-stage label, a
check-that-draws success state naming the file and rows kept, and every stage
change announced.

**Progress is stages, not a percentage.** `ImportStage` and
`IMPORT_STAGE_LABELS` live in `types.ts` beside the rest of the contract, so the
reader and the UI cannot disagree about what a stage is called. Reading a
172-row export is instant; a percentage animated to look like work would be a
lie about a duration nobody can predict from file size. `decoding` exists only
for `.xlsx`, the one step that can genuinely take a moment.

`prefers-reduced-motion` needed no new handling — `styles/global.css` already
collapses every animation globally, which is the payoff for having put it there.

**Errors render `ImportProblem.message` verbatim**, all of them when there are
several, plus a guidance line. Verified through the real file input: an
unsupported extension, a CSV with no timestamp column, an empty file and a
corrupt workbook each produce a specific actionable sentence. Never
"Import failed."

The file input's `aria-label` is now derived from `ACCEPTED_EXTENSIONS` — it
said "Choose a CSV or JSON file" while the picker already offered `.xlsx`, which
is the failure mode a hardcoded label always eventually has.

### File formats: `.xlsx`, and the one assumption in it

`readXlsx.ts` is deliberately thin: workbook → `string[][]` → the existing
`buildFromCsv`. Column mapping, duration/currency parsing and the daily rollup
stay a single audited implementation for both formats. Only the first worksheet
is read, matching a CSV's single implicit sheet.

**`read-excel-file` was chosen over SheetJS.** `xlsx` is oversized and no longer
publishes current versions to the npm registry; `exceljs` measured roughly 8×
larger for read-only use. Measured cost: `dist/index.html` 1,796,098 →
1,867,549 (+71,451), which is essentially the whole delta, since nothing was
reimplemented.

***The one real surprise is Excel's, not the reader's.*** The CSV export writes
`Call Duration` as `M:SS`, but whatever produced the `.xlsx` typed that same
text into a cell and let Excel's time auto-detection read `"1:29"` as **1 hour
29 minutes**. Every duration cell in the real workbook therefore lands with
`:00` seconds, and that is the signal: a zero-seconds cell is re-read as `M:SS`,
undoing Excel's mistake; a genuine nonzero-seconds cell is trusted as
`H:MM:SS`. **The unrecoverable case is a real multi-hour call whose minutes and
seconds are both exact** — indistinguishable by the time it is a `Date`. It does
not occur here because these are phone calls, but a workbook of a different
shape would need this revisited, and it is the first thing to suspect if xlsx
durations ever look wrong by a factor of sixty.

### Verified in a live browser, both fixes and both formats

Against the **correct clone** (§13's hazard is real; `github-clone-dashboard`
on port 5175). Screenshots were unavailable — the Browser pane was not
compositing — so verification was driven through `javascript_tool` against the
real file input, which exercises the same code paths.

```
fixture payload   11 sections · footer: 80%, 1,000 trajectories, MASE, 08:00–17:00
import a CSV       5 sections · 0 summary cards · 1 info callout
                   footer: "Rendered from an imported file", no 0%, no 00:00
                   success: "Imported …: 5 rows kept covering 2026-07-28 to 2026-07-30"
import the .xlsx   3/3 rows · all 8 columns mapped · preview table correct
four error paths   each a specific sentence in role="alert"
375px, loaded cold no horizontal overflow at any stage
console            no errors
```

**One measurement worth not misreading.** Resizing to 375px *after* load reports
page overflow, because Plotly does not re-measure on viewport change. Loaded
cold at 375px there is none, at any stage. The stale reading is a Plotly
characteristic, not a layout defect — check responsiveness on a cold load.

### The real `.xlsx` reproduces the CSV baseline

`LatestRetellAIData.xlsx` on the Desktop, through the real reader: 172/172 rows,
`dropped {}`, the same 74 daily rows and 32 active days, the same 168-cell grid
summing to 172, and `2026-05-18` identical at avg 10.0 / median 9.5 / max 23.

Total cost is **28.37 against the CSV's 28.41** — not a bug. The workbook holds
full-precision floats (`0.183`) where the CSV export rounded to cents
(`$0.18`). The workbook is the more accurate of the two.

*The CSV was removed from the Desktop between sessions, so the committed
comparison is a generated fixture workbook; the real-file agreement above was
confirmed against the recorded baseline instead.*

### Verified locally, PR 19

- `npm run typecheck` clean (both projects) · `npm test` **509 passed**.
- `npm run build` → `dist/index.html` **1,867,697 bytes**.
- `sync_template.py --check` and `gen_tokens.py --check` clean.
- `check_bundle_size.py` — projected **2,142,971 of 2,160,000**.
- **`pytest` ran, targeted:** `test_bundle_size_check.py`, `test_tokens.py` and
  `test_react_dashboard.py` — **52 passed**. Per §18 the full suite is not
  indicated: no `call_forecast/` behaviour changed, the parser work is
  TypeScript, and the TS parser's parity is held by `crossValidation.test.ts`
  against a Python-generated fixture rather than by pytest.

### Both advisories were raised, and that is the policy working

| Gate | Was | Now | Measured |
|---|---|---|---|
| Generated dashboard | 2,100,000 | 2,160,000 | 2,142,971 |
| Committed template | 1,800,000 | 1,880,000 | 1,867,697 |

Neither **limit** moved (3,000,000 / 2,600,000). §12 says raising an advisory is
a normal part of the PR that crosses it, and unlike PR 14 this growth genuinely
*is* a dependency, named and measured above.

**Headroom is now 17 KB against the dashboard advisory**, the tightest it has
been. The next PR of any size crosses it and prints the NOTE, exactly as the
two-tier design intends. The lever, still unused and still correct, is a custom
Plotly partial bundle (`plotly.js/lib/core` + scatter/bar/heatmap, roughly half
of the current 1.42 MB), which also means revisiting `src/types/plotly.d.ts`.
Trimming the payload remains the wrong move — it is the contract.

### Left for later

- **`AtAGlanceSection` still reports "Alerts raised: 0" on an imported file.**
  This is the *same class* of bug as the footer one — an all-clear from an
  analysis that never ran — and it is the third instance found in three PRs
  (`AnomaliesSection` in §12, `DashboardFooter` here). It was left alone
  deliberately: it is pre-existing, it is not what this PR was asked to change,
  and the fix wants the same `analysisAvailable` gate. **It should be the first
  thing the next import-adjacent PR picks up.**
- **The two clones on the work machine are still both there** (§13), still both
  syncing through OneDrive, still a file-lock hazard.
- A `Callout` `ReactNode` overload is still the change if a provenance note ever
  needs a link (§12).
