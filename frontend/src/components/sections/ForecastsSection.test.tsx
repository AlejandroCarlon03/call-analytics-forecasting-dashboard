// @vitest-environment jsdom
/**
 * Component tests for `ForecastsSection`.
 *
 * What is worth pinning here is the selection contract, not the chart: whether
 * a target's card survives `isTargetVisible`, and whether the horizon trims the
 * rollup table to the rows the reader asked for. Plotly cannot run in jsdom —
 * `PlotlyChart` early-returns on `clientWidth === 0`, which jsdom reports for
 * everything — so it is mocked below rather than asserted on.
 */

import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForecastsSection } from './ForecastsSection';
import type { DailyRow, ForecastSection as ForecastPayload, TargetMeta } from '../../data/types';

vi.mock('plotly.js-cartesian-dist-min', () => ({ default: { react: vi.fn(), purge: vi.fn() } }));

const HORIZONS = [30, 60, 90];

/** One forecast, with a daily row landing on each configured horizon boundary. */
function makeForecast(target: string, modelLabel: string): ForecastPayload {
  return {
    target,
    model: 'model',
    modelLabel,
    intervalLevel: 0.9,
    calibrated: true,
    aggregate: 'sum',
    notes: [],
    horizons: [
      { days: 30, measure: 'total', forecast: 100, lower: 90, upper: 110 },
      { days: 60, measure: 'total', forecast: 200, lower: 180, upper: 220 },
      { days: 90, measure: 'total', forecast: 300, lower: 270, upper: 330 },
    ],
    daily: [
      { date: '2026-01-01', yhat: 1, yhat_lower: 0.5, yhat_upper: 1.5, step: 30, horizon_bucket: '30d' },
      { date: '2026-01-31', yhat: 2, yhat_lower: 1.5, yhat_upper: 2.5, step: 60, horizon_bucket: '60d' },
      { date: '2026-03-01', yhat: 3, yhat_lower: 2.5, yhat_upper: 3.5, step: 90, horizon_bucket: '90d' },
    ],
    monthly: [],
  };
}

const DAILY: DailyRow[] = [
  { date: '2025-12-31', call_volume: 10, avg_duration_sec: 100, total_cost: 50 },
];

const TARGET_META: Record<string, TargetMeta> = {
  call_volume: { label: 'Call volume', units: 'calls', aggregate: 'sum' },
  avg_duration_sec: { label: 'Average duration', units: 'seconds', aggregate: 'mean' },
  total_cost: { label: 'Total cost', units: 'USD', aggregate: 'sum' },
};

// `avg_duration_sec` is in `targets` — the run configured it — but produced no
// forecast, matching a model skipped below `min_observations` on real data.
const FORECASTS: Record<string, ForecastPayload> = {
  call_volume: makeForecast('call_volume', 'Prophet'),
  total_cost: makeForecast('total_cost', 'Random Forest'),
};

const TARGETS = ['call_volume', 'avg_duration_sec', 'total_cost'];

type Props = ComponentProps<typeof ForecastsSection>;

function renderSection(overrides: Partial<Props> = {}) {
  const onHorizonChange = vi.fn();
  const utils = render(
    <ForecastsSection
      forecasts={FORECASTS}
      targets={TARGETS}
      targetMeta={TARGET_META}
      daily={DAILY}
      horizons={HORIZONS}
      selectedTarget={null}
      horizon={90}
      onHorizonChange={onHorizonChange}
      {...overrides}
    />,
  );
  return { ...utils, onHorizonChange };
}

describe('ForecastsSection', () => {
  it('renders every target card when nothing is selected', () => {
    const { container } = renderSection({ selectedTarget: null });

    expect(container.querySelector('#model-call_volume')).not.toBeNull();
    expect(container.querySelector('#model-total_cost')).not.toBeNull();
  });

  it('renders only the selected target and drops the rest', () => {
    const { container } = renderSection({ selectedTarget: 'call_volume' });

    expect(container.querySelector('#model-call_volume')).not.toBeNull();
    expect(container.querySelector('#model-total_cost')).toBeNull();
  });

  it('renders nothing when the selected target has no forecast', () => {
    const { container } = renderSection({ selectedTarget: 'avg_duration_sec' });

    expect(container.querySelector('#model-call_volume')).toBeNull();
    expect(container.querySelector('#model-total_cost')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('trims the rollup table to rows at or under the chosen horizon', () => {
    renderSection({ selectedTarget: 'call_volume', horizon: 30 });

    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.queryByText('60 days')).not.toBeInTheDocument();
    expect(screen.queryByText('90 days')).not.toBeInTheDocument();
  });

  it('renders every rollup row at the default (longest) horizon', () => {
    renderSection({ selectedTarget: 'call_volume', horizon: 90 });

    expect(screen.getByText('30 days')).toBeInTheDocument();
    expect(screen.getByText('60 days')).toBeInTheDocument();
    expect(screen.getByText('90 days')).toBeInTheDocument();
  });

  it('reports a horizon change as a number, not the raw select string', async () => {
    const user = userEvent.setup();
    const { container, onHorizonChange } = renderSection({
      selectedTarget: 'call_volume',
      horizon: 90,
    });

    const card = container.querySelector('#model-call_volume');
    expect(card).not.toBeNull();
    const select = within(card as HTMLElement).getByRole('combobox');

    await user.selectOptions(select, '30');

    expect(onHorizonChange).toHaveBeenCalledWith(30);
    expect(typeof onHorizonChange.mock.calls[0]?.[0]).toBe('number');
  });
});
