// @vitest-environment jsdom
/**
 * Data quality under a selection.
 *
 * The advisories are properties of the ingested dataset, which every model
 * shares — so the contract worth pinning is that they do *not* filter, and that
 * a filtered page says so instead of leaving the banner looking stale.
 */

import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataQualitySection } from './DataQualitySection';
import type { IngestionReport } from '../../data/types';

/** 71 days, 41% coverage — the real export, which trips both thresholds. */
const INGESTION: IngestionReport = {
  files: ['export.csv'],
  rows_read: 200,
  rows_kept: 159,
  dropped: {},
  warnings: ['A shipped ingestion warning.'],
  missing_columns: [],
  date_min: '2025-01-01',
  date_max: '2025-03-12',
  active_days: 29,
  calendar_days: 71,
  coverage_pct: 41,
};

const CLEAN: IngestionReport = {
  ...INGESTION,
  warnings: [],
  active_days: 200,
  calendar_days: 200,
  coverage_pct: 100,
};

describe('DataQualitySection', () => {
  it('shows the same advisories under a selection as under All', () => {
    const { unmount } = render(
      <DataQualitySection ingestion={INGESTION} selectedTarget={null} />,
    );
    expect(screen.getByText(/29 of 71 days contain calls/)).toBeInTheDocument();
    expect(screen.getByText('A shipped ingestion warning.')).toBeInTheDocument();
    unmount();

    render(
      <DataQualitySection
        ingestion={INGESTION}
        selectedTarget="total_cost"
        selectedLabel="Daily cost"
      />,
    );
    expect(screen.getByText(/29 of 71 days contain calls/)).toBeInTheDocument();
    expect(screen.getByText('A shipped ingestion warning.')).toBeInTheDocument();
  });

  it('names the selection so the banner does not read as filtered', () => {
    render(
      <DataQualitySection
        ingestion={INGESTION}
        selectedTarget="total_cost"
        selectedLabel="Daily cost"
      />,
    );

    expect(screen.getByText(/Showing Daily cost only/)).toBeInTheDocument();
  });

  it('falls back to the target key when there is no label', () => {
    render(<DataQualitySection ingestion={INGESTION} selectedTarget="total_cost" />);

    expect(screen.getByText(/Showing total_cost only/)).toBeInTheDocument();
  });

  it('carries no scope note under All', () => {
    render(<DataQualitySection ingestion={INGESTION} selectedTarget={null} />);

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('still renders nothing on a clean run, selection or not', () => {
    const { container } = render(
      <DataQualitySection ingestion={CLEAN} selectedTarget="total_cost" selectedLabel="Cost" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
