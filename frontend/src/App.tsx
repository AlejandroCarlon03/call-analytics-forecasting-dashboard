import { useEffect, useMemo, useState } from 'react';
import { loadPayload, type PayloadSource } from './data/loadPayload';
import type { DashboardPayload } from './data/types';
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

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const tabs = useMemo<NavTab[]>(() => {
    if (!payload) return [];
    return payload.targets.map((target) => {
      const forecast = payload.forecasts[target];
      const label = payload.targetMeta[target]?.label ?? target;
      return {
        id: `model-${target}`,
        label: forecast ? `${label} — ${forecast.modelLabel}` : label,
      };
    });
  }, [payload]);

  // Default to the first tab, matching the Python rail's initial aria-current.
  useEffect(() => {
    if (activeId === null && tabs.length > 0) {
      setActiveId(tabs[0]?.id ?? null);
    }
  }, [tabs, activeId]);

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

  const handleSelect = (id: string) => {
    setActiveId(id);
    // Scroll behaviour matches the Python rail. The forecast cards carry these
    // ids; filtering the page to one model is PR 7.
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AppShell
      header={
        <DashboardHeader
          ingestion={state.payload.ingestion}
          generatedAt={state.payload.generatedAt}
        />
      }
      {...(tabs.length > 0
        ? { nav: <SideNav tabs={tabs} activeId={activeId} onSelect={handleSelect} /> }
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
      />
      {/* Cost is the one target with a monthly rollup. */}
      <MonthlyCostSection forecast={state.payload.forecasts['total_cost']} />
      <ArrivalsSection hourly={state.payload.hourly} />
      <ModelComparisonSection
        evaluations={state.payload.evaluations}
        targets={state.payload.targets}
        targetMeta={state.payload.targetMeta}
      />
      <ExplainabilitySection
        explanations={state.payload.explanations}
        targets={state.payload.targets}
        targetMeta={state.payload.targetMeta}
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
