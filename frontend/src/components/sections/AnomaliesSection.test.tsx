// @vitest-environment jsdom
/**
 * Anomalies under a selection.
 *
 * The tally table and the at-a-glance alert tile read the same derivation, so
 * what matters here is that the table narrows with the rail and comes back
 * whole under "All". Plotly cannot run in jsdom and is mocked.
 */

import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AnomaliesSection } from './AnomaliesSection';
import type { AnomalyRow, AnomalySection, ConfigSummary, DailyRow } from '../../data/types';

vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

function item(metric: string, rule: string, severity: AnomalyRow['severity']): AnomalyRow {
  return {
    date: '2026-01-01',
    rule,
    metric,
    actual: 10,
    expected: 5,
    deviation: 5,
    severity,
    message: `${rule} fired`,
  };
}

const ANOMALIES: AnomalySection = {
  items: [
    item('total_cost', 'cost_overrun', 'critical'),
    item('call_volume', 'statistical_outlier', 'warning'),
    item('overnight_calls', 'overnight_activity', 'info'),
  ],
  byRule: [
    { rule: 'cost_overrun', severity: 'critical', count: 1 },
    { rule: 'statistical_outlier', severity: 'warning', count: 1 },
    { rule: 'overnight_activity', severity: 'info', count: 1 },
  ],
  notes: [],
  counts: { critical: 1, warning: 1, info: 1 },
};

const CONFIG: ConfigSummary['anomalies'] = {
  cost_overrun_pct: 0.25,
  duration_sigma: 3,
  missed_spike_sigma: 3,
  robust_z_threshold: 3.5,
  baseline_window_days: 28,
};

const DAILY: DailyRow[] = [
  { date: '2026-01-01', call_volume: 10, avg_duration_sec: 100, total_cost: 5 },
];

/**
 * The tally table specifically.
 *
 * Rule names appear twice on the page — once in the tally and once in the
 * recent-alerts disclosure — so a bare `getByText` matches two nodes. Scoping
 * to the table also asserts the thing this section promises: the tally is a
 * count of what is being shown.
 */
function tally(): HTMLElement {
  return screen.getByRole('table', { name: /Flagged days per rule/ });
}

type Props = ComponentProps<typeof AnomaliesSection>;

function renderSection(overrides: Partial<Props> = {}) {
  return render(
    <AnomaliesSection
      anomalies={ANOMALIES}
      config={CONFIG}
      daily={DAILY}
      selectedTarget={null}
      {...overrides}
    />,
  );
}

describe('AnomaliesSection', () => {
  it('tallies every rule under All', () => {
    renderSection();

    expect(within(tally()).getByText('cost_overrun')).toBeInTheDocument();
    expect(within(tally()).getByText('statistical_outlier')).toBeInTheDocument();
    expect(within(tally()).getByText('overnight_activity')).toBeInTheDocument();
  });

  it("keeps only the selected target's rules", () => {
    renderSection({ selectedTarget: 'total_cost', selectedLabel: 'Daily cost' });

    expect(within(tally()).getByText('cost_overrun')).toBeInTheDocument();
    expect(screen.queryByText('statistical_outlier')).not.toBeInTheDocument();
    expect(screen.queryByText('overnight_activity')).not.toBeInTheDocument();
  });

  it('says a filter is in force, so a short table is not read as a quiet week', () => {
    renderSection({ selectedTarget: 'total_cost', selectedLabel: 'Daily cost' });

    expect(screen.getByText(/Showing alerts on Daily cost only/)).toBeInTheDocument();
  });

  it('carries no scope note under All', () => {
    renderSection();

    expect(screen.queryByText(/Showing alerts on/)).not.toBeInTheDocument();
  });

  it('restores every rule when the selection returns to All', () => {
    const { rerender } = renderSection({ selectedTarget: 'total_cost' });
    expect(screen.queryByText('statistical_outlier')).not.toBeInTheDocument();

    rerender(
      <AnomaliesSection
        anomalies={ANOMALIES}
        config={CONFIG}
        daily={DAILY}
        selectedTarget={null}
      />,
    );

    expect(within(tally()).getByText('statistical_outlier')).toBeInTheDocument();
    expect(within(tally()).getByText('overnight_activity')).toBeInTheDocument();
  });

  it('reports the empty case rather than an empty table', () => {
    renderSection({ selectedTarget: 'avg_duration_sec' });

    expect(screen.getByText('No rules fired.')).toBeInTheDocument();
  });
});
