# call_forecast

Forecasting, anomaly detection and capacity planning for call-analytics exports.

Drop a RetellAI-style CSV into `data/`, run one command, and get 30/60/90-day
forecasts of call volume, average duration and cost — with calibrated
confidence intervals, an automatically selected model, anomaly alerts, SHAP
explanations, staffing scenarios, and a self-contained HTML dashboard.

```bash
python -m call_forecast run -v
```

---

## Read this first: what your current data can and cannot support

The package was built against an export of **159 calls spanning 18 May – 27 Jul
2026**. That is 71 calendar days, of which **only 29 contain any calls** — 41%
coverage — and three partial months. The tooling is built for the data volume
you will have in six months. Today, it is honest about the following:

| Question | Answer on today's data |
|---|---|
| Is there a usable weekly pattern? | Yes — weekday/weekend separation is real and the models pick it up. |
| Can it forecast monthly cost? | Yes, but **derived from the daily cost forecast**, not fitted on monthly totals. Three partial months is not a series you can fit. |
| Does any model beat the naive benchmark? | **Barely.** Random Forest wins on volume with MAE 3.29 vs the seasonal-naive 3.43 — a 4% improvement over "repeat recent same-weekday values". |
| Is R² positive? | **No** — it is negative for every volume and cost model. See below. |
| Can it forecast average duration? | Only with the baseline. Every learned model is **skipped**: 29 observed days is below the 30-observation floor. |
| Are the 90-day numbers trustworthy? | Treat them as directional. Intervals are calibrated on real backtest error only out to day 7; beyond that they are extrapolated, and the dashboard says so. |

**Negative R² is not a bug.** It means the models track the day-to-day series
worse than a flat line drawn at the period's mean. On an intermittent series
where 59% of days are zero, that is the expected result and it is why R² is
reported but *not* used for model selection.

**MASE is the number to watch.** MASE below 1 means a model beats a
seasonal-naive forecast; at or above 1 it does not. Current values are 1.34
(volume) and 1.36 (cost) — above 1. The honest reading: **the models are not yet
earning their keep, and the intervals are the trustworthy part of the output.**
That should improve as history accumulates; `models/metrics_history.csv` tracks
it across runs so you can see when it does.

The single most valuable thing you can do for forecast quality is **accumulate
more history**. Roughly 6 months makes weekly seasonality solid; a year makes
monthly and holiday effects estimable.

---

## Install

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> **Windows + OneDrive:** create the virtualenv **outside** your OneDrive
> folder (e.g. `C:\Users\you\.venvs\callforecast`). OneDrive's sync locks files
> mid-install and corrupts `pip`.

`prophet` and `shap` are optional. If either fails to install, the pipeline
detects it, logs the reason, and continues — you lose the Prophet model and
SHAP attribution, not the run.

No Node.js or npm install is needed to use the tool — the dashboard's React
bundle ships pre-built. See [Dashboard](#dashboard) for what that means and
when Node actually matters.

---

## Use

```bash
python -m call_forecast run -v              # full pipeline, React dashboard (default)
python -m call_forecast run --legacy-dashboard  # same run, classic Python-rendered dashboard
python -m call_forecast run --only-if-changed   # retrain only if data changed
python -m call_forecast check               # has new data arrived?
python -m call_forecast watch --interval 300    # poll and retrain automatically
python -m call_forecast forecast call_volume    # one target, straight to stdout
python -m call_forecast inspect             # data-quality report, no modelling
```

Windows users can double-click **`Run_Forecast.bat`**.

Point it somewhere else with `--root` / `--data-dir`, or use a config file:

```bash
python -m call_forecast run -c config.yaml
```

### From Python

```python
from call_forecast import AppConfig, run_pipeline

result = run_pipeline(AppConfig.from_yaml("config.yaml"))
print(result.summary())

volume = result.forecasts["call_volume"]
print(volume.total(30))       # {'total': 132.0, 'lower': 107.5, 'upper': 156.0}
print(volume.daily.head())    # yhat / yhat_lower / yhat_upper by date
```

---

## Outputs

Written to `outputs/` (CSV), `reports/` (HTML) and `models/` (state):

| File | Contents |
|---|---|
| `forecast_daily.csv` | Every target, every day, with interval bounds |
| `forecast_30d/60d/90d.csv` | Horizon slices of the same forecast |
| `forecast_summary.csv` | The roll-ups you would actually quote |
| `forecast_monthly.csv` | Calendar-month totals, partial months flagged |
| `model_leaderboard.csv` | Every model × target with MAE/RMSE/R²/MAPE/sMAPE/MASE |
| `cv_predictions.csv` | Fold-level backtest predictions, for auditing |
| `anomalies.csv`, `alerts_critical.csv`, `alert_summary.csv` | Flagged days and counts |
| `feature_importance.csv` | Combined SHAP + permutation + native ranking |
| `shap_forecast_contributions.csv` | Per-day SHAP values across the horizon |
| `scenarios.csv` | Volume uplift → cost, wait, staffing, missed calls |
| `daily_metrics.csv`, `daily_features.csv` | The modelling tables themselves |
| `reports/dashboard.html` | Self-contained interactive dashboard — React by default (~1.95 MB), or the classic Python-rendered one (~5.08 MB) with `--legacy-dashboard` |
| `models/manifest.json` | Run fingerprint, driving retrain detection |
| `models/metrics_history.csv` | Accuracy across runs — watch this for drift |

---

## How it works

```
data/*.csv
    │
    ├─ ingest.py      parse, validate, range-check, de-duplicate
    ├─ features.py    daily aggregation + feature engineering
    ├─ evaluation.py  walk-forward CV across 6 models → pick a winner
    ├─ forecast.py    refit on all history → 30/60/90 days + intervals
    ├─ anomalies.py   outliers + four standing alert rules
    ├─ explain.py     SHAP, permutation, native importance
    ├─ scenarios.py   Erlang-C/A capacity modelling
    └─ dashboard.py   one self-contained HTML file
                      React bundle by default, or the Python-assembled
                      page with --legacy-dashboard
```

### Features engineered

**Calendar** (known for any future date): day of week, week of year, month, day
of month, quarter, weekend flag, month start/end, cyclical sin/cos encodings for
weekday and month, a linear trend term, and holiday / holiday-eve /
day-after-holiday flags from the configured country and state.

**Autoregressive** (from the target's own history): lags 1, 2, 3, 7, 14; 7- and
30-day rolling means and standard deviations; the 7-vs-30-day momentum gap;
week-over-week difference; an expanding per-weekday norm ("what do Tuesdays
usually look like"); and days since the last call, which captures the bursty
pattern plain lags miss.

**Exogenous** (observed call properties): cost per minute, cost per call,
missed-call percentage, business-hours and after-hours share, inbound/outbound
ratio, success rate, agent-hangup rate, sentiment score, average latency.

> Your current export has **no direction column**, so the inbound/outbound ratio
> is constant and gets dropped automatically by the zero-variance filter. If a
> future export includes direction, the feature activates with no code change.

### The leakage rule

Every autoregressive feature is shifted by at least one day before any rolling
window is applied, so the row for day *t* only ever sees day *t-1* and earlier.
Exogenous features are shifted too — they describe *observed* calls, which
cannot describe the day being predicted.

This is enforced, not just intended. `tests/test_features.py` multiplies one
day's target by 50 and asserts that **no feature for that same day moves**, and
that the *next* day's lag does. A leak makes backtests look excellent and
forecasts useless; without a test asserting against it, it is invisible.

The forecaster re-runs the same `engineer()` function on a growing frame rather
than maintaining a separate prediction-time feature path, which is the usual
place train/serve skew creeps in.

### Models

| Model | Notes |
|---|---|
| Seasonal naive | The benchmark. Keeps the leaderboard honest and is MASE's denominator. |
| Linear regression | L2-regularised via `RidgeCV`. With ~40 features and ~40 training days, unregularised OLS is numerically arbitrary; with `alpha → 0` this reduces to plain OLS. |
| Random forest | Robust to outlier days. Cannot extrapolate a trend beyond the observed range. |
| XGBoost | Handles NaN natively, so its features are passed through unimputed. Same extrapolation limit. |
| Prophet | Trend + weekly + holidays. Covers the trend case the trees cannot. Yearly seasonality is force-disabled below 2 years of history. |
| SARIMA | State-space model; handles missing days natively via its Kalman filter. Seasonal terms are demoted when there are too few complete cycles to identify them. |

Models below their minimum-observation floor are **skipped with a logged
reason** rather than fitted on a handful of points and quietly trusted.

### Validation and selection

Rolling-origin (walk-forward) cross-validation: train to a cut-off, forecast
forward, score against what actually happened, advance the cut-off, repeat.
A random train/test split would leak the future and report excellent accuracy
for a useless model.

Selection is on **MASE** by default, because MAPE is undefined on zero-call days
and explodes on 1–2 call days. MAPE is still reported — alongside `mape_n`, the
number of days it could actually be computed from, so a percentage based on four
days is never mistaken for one based on forty.

### Confidence intervals

Intervals come from **out-of-sample backtest residuals**, grouped by horizon
step. A day-90 interval is wider than a day-1 interval because the model was
genuinely worse at 90 days, not because of an assumed formula. In-sample
residuals are used only as a clearly-logged fallback.

Two details that matter:

**Monthly totals are simulated, not summed.** Adding 30 daily upper bounds
describes a month where every day independently hits its worst case — far less
likely than the stated level. Instead, whole trajectories are drawn with a
**moving-block bootstrap** (7-day blocks, preserving day-to-day error
correlation), each path is summed, and the interval is read from the
distribution of sums.

**Residuals are mean-centred, and non-negative targets are re-centred after
clipping.** Both guard the same failure: an interval that does not contain its
own point forecast. A biased model's uncentred residuals shift every simulated
path; and clipping a symmetric residual distribution at zero moves probability
mass upward, an effect that compounds with the residual scale — which grows with
horizon. Left unrepaired, the 10th percentile of a 30-day cost total lands
*above* the point forecast. Measured backtest bias is reported as a caveat
rather than silently subtracted, because with this few folds the bias estimate
is mostly noise.

### Alerts

| Rule | Fires when |
|---|---|
| `cost_overrun` | Daily cost exceeds expectation by >20% (configurable) |
| `duration_spike` | Average duration >2σ above the trailing norm |
| `missed_call_spike` | Missed-call share >2σ above norm **and** ≥3 missed calls |
| `overnight_activity` | Any call between 22:00 and 06:00 |
| `statistical_outlier` | Robust (median/MAD) z-score beyond ±3 |

Every baseline is **trailing and weekday-aware**: a Tuesday's expectation comes
from previous Tuesdays only. No day contributes to its own baseline, so a
sustained shift raises alerts instead of quietly redefining normal — and the
same detector runs unchanged on a live feed.

The overnight rule is a fixed threshold on purpose. A 03:00 call to a business
line is worth a look on its own terms, and should not stop being reported
because it has happened often enough to become statistically "normal".

The z-score uses median and MAD rather than mean and standard deviation, because
a single freak day inflates a standard deviation enough to hide itself.

### Explainability

Three views, because each answers a different question:

- **SHAP** attributes each individual prediction additively — the only one that
  answers "why *this* Tuesday?". Exported per forecast day in
  `shap_forecast_contributions.csv`.
- **Permutation importance** measures what actually degrades when a feature is
  shuffled, so it is comparable across model families.
- **Native importance** is free but biased — tree impurity importance favours
  continuous features over binary ones.

Prophet instead reports its additive trend/weekly/holiday decomposition, and
SARIMA its coefficients with significance. With a few dozen training rows the
top two or three features are usually stable and the tail is not; the training
row count travels with the ranking so that caveat is not lost.

### Scenario analysis

Cost scales with volume. Wait time, staffing and missed calls **do not** — a 10%
volume rise does not produce a 10% longer wait, and near capacity it can double
it. So those come from queueing theory rather than multiplication:

- **Erlang C** → probability of waiting, average speed of answer, service level
- **Erlang A** (Erlang C + exponential patience) → callers who abandon, which is
  what converts a longer wait into additional missed calls

Only the *incremental* modelled abandonment is added to the historical
missed-call rate, since that rate already includes abandonment at today's load.

> **These numbers are only as good as `cfg.scenarios`.** The shipped defaults —
> 1 agent, 9 staffed hours, 80%-in-30s target, 100s mean patience — are
> placeholders, not measurements. On your current volume the offered load is
> 0.003 erlangs (an essentially idle queue), so the model reports 1 agent
> sufficient at every uplift. That is a correct reading of a very low-volume
> line, not a bug. Set these to how the line is actually run before quoting the
> staffing column.

Assumptions: Poisson arrivals, exponential handling times, interchangeable
agents. Real traffic is burstier than Poisson, making these mildly optimistic.
They are sizing tools — right for "do we need a second person on the phones?",
not for contractual service-level promises.

### Automatic retraining

Each run writes `models/manifest.json` with a SHA-256 over the **contents** of
every input file. `--only-if-changed` compares against it, so dropping a new
export in triggers a retrain and re-running unchanged data is a no-op.

Content hashing, not modification time: OneDrive, Dropbox and `git checkout` all
rewrite mtimes on files whose bytes never changed, and mtime-based detection
would retrain on every sync. Filenames are excluded and ordering is normalised,
so a rename is correctly a no-op.

Models are **rebuilt rather than serialised**. A full retrain takes seconds to a
couple of minutes, and pickled Prophet/statsmodels objects break across library
upgrades — a stale unpicklable model is a worse failure than a short refit.

Schedule it with Task Scheduler:

```bat
python -m call_forecast run --only-if-changed --root "C:\path\to\call-forecast"
```

`check` exits **1** when a retrain is pending and **0** otherwise, so shell
scripts can branch on it.

---

## Dashboard

`python -m call_forecast run` writes a **React** dashboard by default. Pass
`--legacy-dashboard` (also available on `watch`) to get the classic
Python-assembled one instead:

```bash
python -m call_forecast run                     # React dashboard (default)
python -m call_forecast run --legacy-dashboard  # classic Python-rendered dashboard
```

Both write the same path, `reports/dashboard.html`, from the same run, with the
same nine sections. The difference that drove the migration is size:

```
1,946,364 B  reports/dashboard.html   React renderer   (default)
5,082,765 B  reports/dashboard.html   Python renderer  (--legacy-dashboard)
```

Both are single self-contained files — Plotly (or the React bundle) inlined,
no CDN, no server, no network access at run time. Open either from disk, email
it, or drop it on a share.

The React version adds two things the static page could not do: filtering by
target and choosing a forecast horizon, both of which live in the URL fragment
so a filtered view is linkable —

```
dashboard.html                              all three models, 90 days
dashboard.html#model=total_cost             cost only
dashboard.html#model=call_volume&horizon=30 volume, first 30 days
```

**`--legacy-dashboard` is retained for one release cycle and then removed.**
`--react-dashboard` still parses but is deprecated and does nothing — React is
what it used to select, and React is now the default. If you need the classic
renderer past this release, say why now.

Sections, same in both renderers: data quality → at-a-glance KPIs → forecasts
with interval bands → monthly cost → weekday×hour heatmap → model comparison →
what drives the forecast → anomalies → scenarios.

Light and dark themes are both explicitly designed (not auto-inverted); the page
follows your OS preference and the header toggle overrides it. Every chart has a
table-view twin, so no value is reachable only by hovering. Alerts carry an icon
and a text label, never colour alone.

### Node.js — do you need it?

**No, not to use the tool.** `pip install -r requirements.txt` and the CLI
commands above are the whole story for generating a dashboard. There is no
Node toolchain and no network access at run time.

The React bundle is built ahead of time and **committed** to the package as
`call_forecast/assets/dashboard_template.html`. Generating a dashboard
substitutes the run's JSON payload into that committed template — that's the
entire mechanism. The generated `reports/dashboard.html` then works standalone:
open it from disk, email it, drop it on a share, same as the legacy one.

Node is required **only** if you're modifying the frontend source or rebuilding
the bundle, i.e. contributing under `frontend/`. That workflow is:

```bash
cd frontend
npm ci
npm run build
python scripts/sync_template.py
```

See `frontend/README.md` for the full contributor workflow.

---

## Configuration

Every tunable lives in `call_forecast/config.py` as a typed dataclass, and
`config.yaml` writes out the shipped defaults for easy editing. Unknown keys
raise with the list of valid ones, so a typo fails loudly instead of being
silently ignored.

Worth reviewing for your own line: `business_hours`, `data.holiday_subdiv`,
`scenarios.current_agents` and its companions, and `anomalies.cost_overrun_pct`.

---

## Tests

```bash
python -m pytest tests/ -q
python -m pytest --doctest-modules call_forecast/ -q
```

240+ tests covering parsing, de-duplication, leakage, metric correctness against
hand-computed values, Erlang functions against textbook values, interval
coherence, and a full end-to-end run. They use **synthetic** data with a planted
weekly cycle and a planted anomaly, so they assert on properties under our
control and keep passing when the real export changes.

Three deserve specific mention, because each guards a bug that shipped and was
caught here:

- `test_spiking_one_day_does_not_change_that_days_features` — the leakage guard.
- `test_aggregate_interval_contains_the_aggregate_point` — caught intervals
  sitting entirely above their own point forecast.
- `test_simulated_paths_are_non_negative_and_unbiased` — caught the zero-clipping
  bias inflating long-horizon cost totals by ~30%.

---

## Known limitations

- **90-day intervals are extrapolated** past the 7-day CV horizon.
- **Average duration currently has no learned model** — 29 observed days is
  below the 30-observation floor. It activates on its own as data accumulates.
- **Exogenous features are held at a trailing average** over the forecast
  horizon. Cost per minute or after-hours mix cannot be known in advance;
  scenario analysis is where you vary them deliberately.
- **No intra-day forecasting.** The heatmap shows the hourly pattern, but
  forecasting is daily. Hourly staffing would need an intra-day model.
- **Timestamps are minute-resolution and there is no call ID**, so cross-file
  de-duplication matches on content plus within-file position. Two genuinely
  distinct calls in the same minute with identical duration and cost are kept
  (correct); a call ID in a future export would make this exact.
- **A full run takes ~2–3 minutes**, dominated by Prophet refitting on each CV
  fold. Drop `prophet` from `models.enabled` for a much faster run.
