import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadPayload, type PayloadSource } from './data/loadPayload';
import type { DashboardPayload } from './data/types';
import { useHashSelection } from './lib/useHashSelection';
import type { SelectionDomain } from './lib/selection';
import type { ImportPreview } from './lib/import/types';
import { availableAnalytics, runExport } from './lib/export';
import type { ExportContext, ExportOutcome, ExportRequest } from './lib/export/types';
import { useChartPalette } from './components/charts/useChartPalette';
import { AppShell } from './components/shell/AppShell';
import { DashboardHeader } from './components/shell/DashboardHeader';
import { DashboardFooter } from './components/shell/DashboardFooter';
import { SideNav, type NavTab } from './components/shell/SideNav';
import { Callout, Section } from './components/primitives';
import { ImportPanel } from './components/import';
import { ExportCenter } from './components/export/ExportCenter';
import {
  AnomaliesSection,
  ArrivalsSection,
  AtAGlanceSection,
  DataQualitySection,
  ExplainabilitySection,
  ForecastsSection,
  ModelComparisonSection,
  MonthlyCostSection,
  ScenariosSection,
} from './components/sections';
import styles from './App.module.css';

type State =
  | { status: 'loading' }
  /**
   * `activeSourceLabel` is a label only, never a second copy of the payload's
   * provenance used to drive rendering. It starts as a word derived from
   * `loadPayload()`'s `PayloadSource` and becomes the imported file's name
   * after a swap — either way this is the *only* payload slice `App` holds; an
   * import replaces it in place through this same `setState` rather than
   * living beside it in a second slice (SESSION_CONTEXT §10).
   */
  | {
      status: 'ready';
      payload: DashboardPayload;
      activeSourceLabel: string;
      /**
       * Whether a pipeline actually analysed this data.
       *
       * ***An empty analysis section and an absent one mean different things,
       * and the payload cannot tell them apart.*** A run whose detector fired
       * on nothing and a CSV the detector never saw both arrive here with zero
       * anomaly rows — but "we checked and found nothing" is a finding, and
       * "nothing was checked" is not. `AnomaliesSection` has no empty guard, so
       * it draws a clean volume line either way and the reader cannot tell
       * which they are looking at.
       *
       * The flag is held *beside* the payload rather than added to it. The JSON
       * contract describes a pipeline run; a field whose meaning is "this is
       * not one" belongs to the app, not to `serialize.py`.
       */
      analysisAvailable: boolean;
    }
  | { status: 'error'; message: string };

/** How each `loadPayload()` source reads before any import has happened. */
function initialSourceLabel(source: PayloadSource): string {
  switch (source) {
    case 'inline':
      return 'This run';
    case 'fetch':
      return 'dashboard_data.json';
    case 'fixture':
      return 'Sample data';
  }
}

/** A payload-shaped domain for a run that has not loaded yet. */
const NO_TARGETS: string[] = [];
const NO_HORIZONS: number[] = [];

/**
 * The dashboard.
 *
 * **`App` owns the selection, and the URL owns `App`.** The rail's target and
 * the forecast horizon both live in the location fragment, read through the one
 * `useHashSelection` subscriber below and passed down as props. No section
 * reads `location`, and none keeps its own copy — a second copy would need
 * keeping in step with the back button, a hand-edited fragment and a reload
 * separately, and the first one to drift is a filtered view that does not match
 * the link that produced it.
 *
 * What a target selection filters is every section that *has* a target:
 * forecasts, model comparison, explainability, and the monthly cost card, which
 * is a `total_cost` forecast and so belongs to that target as much as the
 * others do. Data quality, at a glance, arrivals, anomalies and scenarios
 * describe the whole run and stay put — filtering them would be filtering the
 * report to a model that never had its own copy of them.
 */
export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    loadPayload()
      .then(({ payload, source }) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          payload,
          activeSourceLabel: initialSourceLabel(source),
          // All three of `loadPayload()`'s sources are pipeline output.
          analysisAvailable: true,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    // The payload never changes after load, but a StrictMode double-mount in
    // dev would otherwise race two loads and set state on the discarded one.
    return () => {
      cancelled = true;
    };
  }, []);

  const payload = state.status === 'ready' ? state.payload : null;

  // Hooks cannot be called conditionally, so the domain is empty until the
  // payload lands. An empty domain parses every fragment to "All", which is
  // exactly the right thing to show while loading.
  const domain = useMemo<SelectionDomain>(
    () => ({
      targets: payload?.targets ?? NO_TARGETS,
      horizons: payload?.config.forecast.horizons ?? NO_HORIZONS,
    }),
    [payload],
  );

  const { selection, selectTarget, selectHorizon } = useHashSelection(domain);

  // Resolved from the DOM, not from `useTheme().mode` — see the doc comment on
  // `useChartPalette` for why the theme-context version is one render stale.
  const palette = useChartPalette();

  // Export run state. Ordinary `useState`, held here rather than inside
  // `ExportCenter`, per the same rule the panel's own doc comment states: a
  // second local copy of "did it work" is the disagreement SESSION_CONTEXT §10
  // warns about, so the panel reads these straight from props.
  const [exportBusy, setExportBusy] = useState(false);
  const [exportOutcome, setExportOutcome] = useState<ExportOutcome | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const dismissExport = useCallback(() => {
    setExportOutcome(null);
    setExportError(null);
  }, []);

  // A stale outcome under a rail that has since moved on is the same
  // fabricated-agreement failure §10 exists to remove, so a target or horizon
  // change clears it exactly the way an import already clears the payload.
  useEffect(() => {
    dismissExport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.target, selection.horizon]);

  // An import replaces the one payload slice through the same setter the
  // initial load uses — never a second "imported payload" slice. A stale
  // `#model=…` fragment self-heals for free: `domain` above is recomputed from
  // the new `payload` reference, so `parseHash` sees the new (possibly empty)
  // `targets`/`horizons` on the very next render and degrades an unknown
  // target to "All". Nothing here touches the hash itself.
  const handleImport = useCallback((payload: DashboardPayload, preview: ImportPreview) => {
    setState({
      status: 'ready',
      payload,
      activeSourceLabel: preview.fileName,
      // A `payload` import is an exported pipeline run; a `csv` import is raw
      // calls this browser aggregated, and nothing analysed those.
      analysisAvailable: preview.kind === 'payload',
    });
  }, []);

  const tabs = useMemo<NavTab[]>(() => {
    if (!payload) return [];
    return payload.targets.map((target) => {
      const forecast = payload.forecasts[target];
      const label = payload.targetMeta[target]?.label ?? target;
      return {
        target,
        label: forecast ? `${label} — ${forecast.modelLabel}` : label,
      };
    });
  }, [payload]);

  // `analysisAvailable` only exists on the 'ready' variant; false while
  // loading/erroring is the right degrade — there is nothing to export yet.
  const analysisAvailable = state.status === 'ready' ? state.analysisAvailable : false;

  // The one `ExportContext`, built from state `App` already holds — never a
  // second read of the payload or a re-parse of the hash. Recomputes on a
  // payload swap (import), a selection change (rail/horizon) and a theme
  // change (palette), which are exactly the three things an export's output
  // can legitimately depend on.
  const exportContext = useMemo<ExportContext | null>(() => {
    if (!payload) return null;
    return { payload, selection, analysisAvailable, palette };
  }, [payload, selection, analysisAvailable, palette]);

  const exportAnalytics = useMemo(() => {
    if (!payload) return [];
    return availableAnalytics({ payload, analysisAvailable });
  }, [payload, analysisAvailable]);

  const handleExport = useCallback(
    (request: ExportRequest) => {
      if (!exportContext) return;
      setExportBusy(true);
      setExportError(null);
      runExport(request, exportContext)
        .then((outcome) => {
          setExportOutcome(outcome);
        })
        .catch((error: unknown) => {
          // `runExport` is documented not to throw for per-analytic failures;
          // a caller that assumed otherwise and was wrong would otherwise show
          // the reader nothing at all.
          setExportError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setExportBusy(false);
        });
    },
    [exportContext],
  );

  if (state.status === 'loading') {
    return (
      <div className={styles.status} role="status">
        Loading dashboard…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.status}>
        <div className={styles.error} role="alert">
          <div className={styles.errorTitle}>Could not load the dashboard payload</div>
          <div className={styles.errorDetail}>{state.message}</div>
        </div>
      </div>
    );
  }

  const { target: selectedTarget, horizon } = selection;

  // How the selection reads in prose. The run-wide sections use it to say what
  // they are *not* filtered by, which is the difference between a section that
  // is deliberately whole and one that looks stale.
  const selectedLabel =
    selectedTarget === null
      ? undefined
      : (state.payload.targetMeta[selectedTarget]?.label ?? selectedTarget);

  return (
    <AppShell
      header={
        <DashboardHeader
          ingestion={state.payload.ingestion}
          generatedAt={state.payload.generatedAt}
        />
      }
      {...(tabs.length > 0
        ? {
            nav: <SideNav tabs={tabs} selected={selectedTarget} onSelect={selectTarget} />,
          }
        : {})}
      footer={
        <DashboardFooter config={state.payload.config} generatedAt={state.payload.generatedAt} />
      }
    >
      {/* Page order matches `build_dashboard()`. Every section renders a
          payload it may find empty, and returns null rather than an empty
          card when it does — the same way the Python dashboard omitted a
          block whose frame was empty. */}
      <Section title="Data source">
        <ImportPanel onImport={handleImport} activeSourceLabel={state.activeSourceLabel} />
        {/* Named, rather than left to be inferred from missing sections. A
            reader who imports a CSV and sees no forecasts should learn that
            forecasting is a pipeline step, not wonder whether their file was
            too small or something failed silently. */}
        {state.analysisAvailable ? null : (
          <Callout tone="info">
            {`Showing the descriptive summary of ${state.activeSourceLabel}. Forecasts, model comparison, feature importance, anomaly detection and staffing scenarios are produced by the Python pipeline — run call_forecast against this export, or import an outputs/dashboard_data.json, to see them.`}
          </Callout>
        )}
        {/* Export and import are the same class of concern — the reader's data
            going in and out — so it sits in the same section rather than one
            of its own. */}
        <ExportCenter
          analytics={exportAnalytics}
          busy={exportBusy}
          outcome={exportOutcome}
          error={exportError}
          selectionLabel={selectedLabel ?? 'All models'}
          onExport={handleExport}
          onDismiss={dismissExport}
        />
      </Section>
      <DataQualitySection
        ingestion={state.payload.ingestion}
        selectedTarget={selectedTarget}
        selectedLabel={selectedLabel}
      />
      <AtAGlanceSection
        payload={state.payload}
        selectedTarget={selectedTarget}
        horizon={horizon}
      />
      <ForecastsSection
        forecasts={state.payload.forecasts}
        targets={state.payload.targets}
        targetMeta={state.payload.targetMeta}
        daily={state.payload.daily}
        horizons={state.payload.config.forecast.horizons}
        selectedTarget={selectedTarget}
        horizon={horizon}
        onHorizonChange={selectHorizon}
      />
      {/* Cost is the one target with a monthly rollup, and it is filtered with
          the rest of `total_cost` rather than left standing under a volume
          selection. */}
      <MonthlyCostSection
        forecast={state.payload.forecasts['total_cost']}
        selectedTarget={selectedTarget}
      />
      <ArrivalsSection hourly={state.payload.hourly} />
      <ModelComparisonSection
        evaluations={state.payload.evaluations}
        targets={state.payload.targets}
        targetMeta={state.payload.targetMeta}
        selectedTarget={selectedTarget}
      />
      <ExplainabilitySection
        explanations={state.payload.explanations}
        targets={state.payload.targets}
        targetMeta={state.payload.targetMeta}
        selectedTarget={selectedTarget}
      />
      {/* Omitted outright when nothing analysed this data. An empty alerts
          section is a finding; this one would be a fabricated one. */}
      {state.analysisAvailable ? (
        <AnomaliesSection
          anomalies={state.payload.anomalies}
          config={state.payload.config.anomalies}
          daily={state.payload.daily}
          selectedTarget={selectedTarget}
          selectedLabel={selectedLabel}
        />
      ) : null}
      <ScenariosSection scenarios={state.payload.scenarios} />
    </AppShell>
  );
}
