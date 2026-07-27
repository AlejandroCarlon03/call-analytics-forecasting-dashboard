import type { DashboardPayload } from '../../data/types';
import { formatCount } from '../../lib/format';
import styles from './PendingSections.module.css';

/**
 * Temporary scaffolding for the shell PR.
 *
 * Lists the sections of the Python dashboard that are still to be migrated,
 * each with a live count read from the payload — so this doubles as proof that
 * the payload is loaded, parsed and reachable, not just that a layout renders.
 *
 * Every entry here is deleted as its real section lands in PRs 3-5, and this
 * file goes with the last one.
 */
export function PendingSections({ payload }: { payload: DashboardPayload }) {
  const targets = payload.targets.length;

  const pending: Array<{ name: string; detail: string; pr: string }> = [
    {
      name: 'Forecasts',
      detail: `${targets} forecast(s), ` +
        `${formatCount(Object.values(payload.forecasts)[0]?.daily.length ?? 0)} days each`,
      pr: 'PR 4',
    },
    {
      name: 'Monthly cost projection',
      detail: `${payload.forecasts['total_cost']?.monthly.length ?? 0} month(s) projected`,
      pr: 'PR 5',
    },
    {
      name: 'When calls arrive',
      detail: `${payload.hourly.length} weekday x hour cells, ` +
        `${formatCount(payload.ingestion.rows_kept)} calls`,
      pr: 'PR 5',
    },
    {
      name: 'Model comparison',
      detail: `${Object.keys(payload.evaluations).length} leaderboard(s)`,
      pr: 'PR 5',
    },
    {
      name: 'What drives the forecast',
      detail: `${Object.keys(payload.explanations).length} explanation(s)`,
      pr: 'PR 5',
    },
    {
      name: 'Anomaly timeline chart',
      detail: `${formatCount(payload.anomalies.items.length)} flagged day(s), ` +
        `${payload.anomalies.counts.critical} critical — the tables below are live`,
      pr: 'PR 5',
    },
  ];

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Migration in progress</h2>
      <p className={styles.blurb}>
        Data quality, at a glance, anomalies and scenarios now render from React. What remains
        is chart-bearing; each entry below shows live counts read from the loaded payload and
        will be replaced by its React implementation in the pull request named beside it.
      </p>
      {pending.map((item) => (
        <div className={styles.card} key={item.name}>
          <div>
            <div className={styles.name}>{item.name}</div>
            <div className={styles.detail}>{item.detail}</div>
          </div>
          <span className={styles.badge}>{item.pr}</span>
        </div>
      ))}
    </section>
  );
}
