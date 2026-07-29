// @vitest-environment jsdom
/**
 * The at-a-glance tiles under a selection.
 *
 * This is the regression these tests exist for: the tiles used to render the
 * whole run regardless of the rail, so a page filtered to call volume still
 * carried a cost tile and a whole-run alert count. Every assertion below is
 * about the tiles agreeing with the page around them.
 */

import '@testing-library/jest-dom';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AtAGlanceSection } from './AtAGlanceSection';
import type {
  AnomalySection,
  DashboardPayload,
  ForecastSection,
  HorizonRollup,
} from '../../data/types';

function rollups(scale: number): HorizonRollup[] {
  return [30, 60, 90].map((days) => ({
    days,
    measure: 'total' as const,
    forecast: days * scale,
    lower: days * scale * 0.9,
    upper: days * scale * 1.1,
  }));
}

function forecast(target: string, scale: number): ForecastSection {
  return {
    target,
    model: 'random_forest',
    modelLabel: 'Random Forest',
    intervalLevel: 0.9,
    calibrated: true,
    aggregate: 'sum',
    notes: [],
    horizons: rollups(scale),
    daily: [],
    monthly: [],
  };
}

const ANOMALIES: AnomalySection = {
  items: [
    {
      date: '2026-01-01',
      rule: 'cost_overrun',
      metric: 'total_cost',
      actual: 10,
      expected: 5,
      deviation: 5,
      severity: 'critical',
      message: 'cost',
    },
    {
      date: '2026-01-02',
      rule: 'statistical_outlier',
      metric: 'call_volume',
      actual: 10,
      expected: 5,
      deviation: 5,
      severity: 'warning',
      message: 'volume',
    },
  ],
  byRule: [
    { rule: 'cost_overrun', severity: 'critical', count: 1 },
    { rule: 'statistical_outlier', severity: 'warning', count: 1 },
  ],
  notes: [],
  counts: { critical: 1, warning: 1, info: 0 },
};

/** Only the fields this section reads; the rest of the payload is irrelevant here. */
const PAYLOAD = {
  ingestion: { rows_kept: 1711, calendar_days: 210 },
  anomalies: ANOMALIES,
  forecasts: {
    call_volume: forecast('call_volume', 10),
    total_cost: forecast('total_cost', 2),
  },
} as unknown as DashboardPayload;

type Props = ComponentProps<typeof AtAGlanceSection>;

function renderTiles(overrides: Partial<Props> = {}) {
  return render(
    <AtAGlanceSection payload={PAYLOAD} selectedTarget={null} horizon={90} {...overrides} />,
  );
}

describe('AtAGlanceSection', () => {
  it('shows every target tile under All', () => {
    renderTiles();

    expect(screen.getByText('Next 30 days')).toBeInTheDocument();
    expect(screen.getByText('30-day cost')).toBeInTheDocument();
  });

  it('drops the tiles of targets the rail filtered away', () => {
    renderTiles({ selectedTarget: 'call_volume' });

    expect(screen.getByText('Next 30 days')).toBeInTheDocument();
    expect(screen.queryByText('30-day cost')).not.toBeInTheDocument();
  });

  it('restores the aggregate tiles when the selection returns to All', () => {
    const { rerender } = renderTiles({ selectedTarget: 'total_cost' });
    expect(screen.queryByText('Next 30 days')).not.toBeInTheDocument();

    rerender(<AtAGlanceSection payload={PAYLOAD} selectedTarget={null} horizon={90} />);

    expect(screen.getByText('Next 30 days')).toBeInTheDocument();
    expect(screen.getByText('30-day cost')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // both alerts again
  });

  it('scopes the alert tile to the selected target', () => {
    renderTiles({ selectedTarget: 'total_cost' });

    expect(screen.getByText('1 critical · 0 warning')).toBeInTheDocument();
  });

  it('counts every alert under All', () => {
    renderTiles();

    expect(screen.getByText('1 critical · 1 warning')).toBeInTheDocument();
  });

  it('keeps the ingestion tile, which no model selection changes', () => {
    renderTiles({ selectedTarget: 'total_cost' });

    expect(screen.getByText('Calls in period')).toBeInTheDocument();
    expect(screen.getByText('1,711')).toBeInTheDocument();
  });

  it('never quotes a horizon the forecast cards have trimmed away', () => {
    renderTiles({ selectedTarget: 'call_volume', horizon: 30 });

    // 30 is both the preferred headline and the chosen horizon, so the label
    // is unchanged from before the horizon control existed.
    expect(screen.getByText('Next 30 days')).toBeInTheDocument();
  });

  it('writes its label from the row it quotes', () => {
    const shortRun = {
      ...PAYLOAD,
      forecasts: {
        call_volume: {
          ...forecast('call_volume', 10),
          horizons: [
            { days: 60, measure: 'total' as const, forecast: 600, lower: 540, upper: 660 },
          ],
        },
      },
    } as unknown as DashboardPayload;

    render(
      <AtAGlanceSection payload={shortRun} selectedTarget="call_volume" horizon={90} />,
    );

    expect(screen.getByText('Next 60 days')).toBeInTheDocument();
    expect(screen.queryByText('Next 30 days')).not.toBeInTheDocument();
  });
});
