// @vitest-environment jsdom
/**
 * The executive summary section.
 *
 * The derivations are asserted in `lib/executiveSummary.test.ts`; these are
 * the questions only a rendered tree can answer — that the cards are a real
 * list, that an unavailable card states its reason instead of showing a lone
 * em dash, and that a selection change moves the grid on the next render with
 * no state of its own to keep in step.
 */

import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ExecutiveSummarySection } from './ExecutiveSummarySection';
import type {
  DashboardPayload,
  ForecastSection,
  HorizonRollup,
} from '../../data/types';

function rollups(perDay: number): HorizonRollup[] {
  return [30, 60, 90].map((days) => ({
    days,
    measure: 'total' as const,
    forecast: perDay * days,
    lower: perDay * days * 0.9,
    upper: perDay * days * 1.1,
  }));
}

function forecast(target: string, perDay: number): ForecastSection {
  return {
    target,
    model: 'random_forest',
    modelLabel: 'Random Forest',
    intervalLevel: 0.9,
    calibrated: true,
    aggregate: 'sum',
    notes: [],
    horizons: rollups(perDay),
    daily: [
      {
        date: '2026-03-04',
        yhat: perDay * 2,
        yhat_lower: null,
        yhat_upper: null,
        step: 1,
        horizon_bucket: null,
      },
    ],
    monthly: [],
  };
}

/** No `avg_duration_sec` forecast — the real 71-day export's shape. */
const PAYLOAD = {
  targets: ['call_volume', 'avg_duration_sec', 'total_cost'],
  targetMeta: {
    call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' },
    avg_duration_sec: { label: 'Avg duration', units: 'seconds', aggregate: 'mean' },
    total_cost: { label: 'Daily cost', units: 'USD', aggregate: 'sum' },
  },
  forecasts: {
    call_volume: forecast('call_volume', 10),
    total_cost: forecast('total_cost', 2),
  },
  evaluations: {
    call_volume: {
      target: 'call_volume',
      bestModel: 'random_forest',
      selectionMetric: 'mase',
      nFolds: 12,
      horizon: 7,
      notes: [],
      leaderboard: [
        {
          model: 'random_forest',
          label: 'Random Forest',
          status: 'ok',
          selected: true,
          n_folds: 12,
          fit_seconds: 1,
          mae: 3,
          rmse: 4,
          r2: 0.3,
          mape: null,
          mape_n: null,
          smape: null,
          mase: 0.79,
          bias: 0,
        },
      ],
    },
  },
  daily: Array.from({ length: 40 }, (_, index) => ({
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    call_volume: 10,
    avg_duration_sec: null,
    total_cost: 2,
  })),
  anomalies: {
    items: [
      {
        date: '2026-02-11',
        rule: 'cost_overrun',
        metric: 'total_cost',
        actual: 10,
        expected: 5,
        deviation: 5,
        severity: 'critical' as const,
        message: 'cost',
      },
    ],
    byRule: [{ rule: 'cost_overrun', severity: 'critical' as const, count: 1 }],
    notes: [],
    counts: { critical: 1, warning: 0, info: 0 },
  },
} as unknown as DashboardPayload;

type Props = ComponentProps<typeof ExecutiveSummarySection>;

function renderSection(overrides: Partial<Props> = {}) {
  return render(
    <ExecutiveSummarySection
      payload={PAYLOAD}
      selectedTarget={null}
      horizon={90}
      analysisAvailable
      {...overrides}
    />,
  );
}

/** The grid, as a list — which is also the assertion that it *is* one. */
function cards() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

describe('ExecutiveSummarySection', () => {
  it('renders under its own heading', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Executive summary' })).toBeInTheDocument();
  });

  it('renders the cards as a list, so a screen reader gets the count', () => {
    renderSection();

    expect(cards()).toHaveLength(8);
  });

  it('shows the headline figures without the reader opening a chart', () => {
    renderSection();

    expect(screen.getByText('Forecasted calls')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
    expect(screen.getByText('Random Forest')).toBeInTheDocument();
  });

  it('states why a metric is unavailable instead of showing a bare dash', () => {
    renderSection();

    expect(
      screen.getByText(/No duration forecast — the pipeline skipped this target/),
    ).toBeInTheDocument();
  });

  it('says what the grid is scoped to', () => {
    renderSection();
    expect(screen.getByText(/across every model/)).toBeInTheDocument();

    renderSection({ selectedTarget: 'total_cost', selectedLabel: 'Daily cost' });
    expect(screen.getByText(/filtered to Daily cost/)).toBeInTheDocument();
  });

  // -------------------------------------------------------- state updates --

  it('updates immediately when the model selection changes', () => {
    const { rerender } = renderSection();
    expect(screen.getByText('300')).toBeInTheDocument();

    rerender(
      <ExecutiveSummarySection
        payload={PAYLOAD}
        selectedTarget="total_cost"
        horizon={90}
        analysisAvailable
        selectedLabel="Daily cost"
      />,
    );

    // The volume card is gone and the cost card stands.
    expect(screen.queryByText('Forecasted calls')).not.toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
  });

  it('restores the aggregate values when the selection returns to All', () => {
    const { rerender } = renderSection({ selectedTarget: 'total_cost', selectedLabel: 'Daily cost' });
    expect(screen.queryByText('Forecasted calls')).not.toBeInTheDocument();

    rerender(
      <ExecutiveSummarySection
        payload={PAYLOAD}
        selectedTarget={null}
        horizon={90}
        analysisAvailable
      />,
    );

    expect(screen.getByText('Forecasted calls')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
  });

  it('follows the horizon the forecast cards are trimmed to', () => {
    const { rerender } = renderSection();
    // Several cards quote it — the calls, cost and change lines all do.
    expect(screen.getAllByText(/next 30 days/).length).toBeGreaterThan(0);

    rerender(
      <ExecutiveSummarySection
        payload={PAYLOAD}
        selectedTarget={null}
        horizon={15}
        analysisAvailable
      />,
    );

    // 30 is past the trim, so no card may keep quoting it.
    expect(screen.queryAllByText(/next 30 days/)).toHaveLength(0);
  });

  it('updates when a new payload is imported', () => {
    const { rerender } = renderSection();
    expect(screen.getByText('300')).toBeInTheDocument();

    const imported = {
      ...PAYLOAD,
      forecasts: { call_volume: forecast('call_volume', 40) },
    } as unknown as DashboardPayload;

    rerender(
      <ExecutiveSummarySection
        payload={imported}
        selectedTarget={null}
        horizon={90}
        analysisAvailable={false}
      />,
    );

    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.queryByText('300')).not.toBeInTheDocument();
    // A CSV nothing analysed must not report an absence of anomalies as a
    // finding — the `analysisAvailable` distinction, rendered.
    expect(screen.getByText(/anomaly detection is a pipeline step/)).toBeInTheDocument();
  });
});
