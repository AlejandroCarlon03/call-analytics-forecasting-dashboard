import { useEffect, useMemo, useState } from 'react';
import { loadPayload, type PayloadSource } from './data/loadPayload';
import type { DashboardPayload } from './data/types';
import { useHashSelection } from './lib/useHashSelection';
import type { SelectionDomain } from './lib/selection';
import { AppShell } from './components/shell/AppShell';
import { DashboardHeader } from './components/shell/DashboardHeader';
import { DashboardFooter } from './components/shell/DashboardFooter';
import { SideNav, type NavTab } from './components/shell/SideNav';
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
  | { status: 'ready'; payload: DashboardPayload; source: PayloadSource }
  | { status: 'error'; message: string };

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
        setState({ status: 'ready', payload, source });
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
      <DataQualitySection ingestion={state.payload.ingestion} />
      <AtAGlanceSection payload={state.payload} />
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
      <AnomaliesSection
        anomalies={state.payload.anomalies}
        config={state.payload.config.anomalies}
        daily={state.payload.daily}
      />
      <ScenariosSection scenarios={state.payload.scenarios} />
    </AppShell>
  );
}
