// @vitest-environment jsdom
/**
 * The header grew two navigation affordances in the navigation-polish PR: the
 * title became the home control, and the Docs control gained a current-page
 * cue. Both are invisible in a screenshot and easy to regress —
 *
 *  - the title must be a real, keyboard-operable control whose accessible name
 *    is still the visible title (so it reads as a heading, not a mystery
 *    button), and it must call the home handler rather than write a fragment;
 *  - the Docs control must carry `aria-current="page"` in the docs view and
 *    nowhere else, the same cue the rails carry.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardHeader } from './DashboardHeader';
import { ThemeProvider } from '../../theme/ThemeProvider';
import type { IngestionReport } from '../../data/types';

const INGESTION: IngestionReport = {
  files: ['sample_export.csv'],
  rows_read: 1711,
  rows_kept: 1711,
  dropped: {},
  warnings: [],
  missing_columns: [],
  date_min: '2026-01-01',
  date_max: '2026-07-30',
  active_days: 128,
  calendar_days: 210,
  coverage_pct: 61,
};

const GENERATED_AT = '2026-07-30T15:15:00Z';

function renderHeader(props: Partial<Parameters<typeof DashboardHeader>[0]> = {}) {
  const onNavigateHome = props.onNavigateHome ?? vi.fn();
  const utils = render(
    <ThemeProvider>
      <DashboardHeader
        ingestion={INGESTION}
        generatedAt={GENERATED_AT}
        onNavigateHome={onNavigateHome}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ...utils, onNavigateHome };
}

describe('DashboardHeader', () => {
  it('keeps a single level-1 heading whose name is the visible title', () => {
    renderHeader();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Call Analytics Forecast' }),
    ).toBeInTheDocument();
  });

  it('exposes the title as a button that returns home', async () => {
    const user = userEvent.setup();
    const { onNavigateHome } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Call Analytics Forecast' }));

    expect(onNavigateHome).toHaveBeenCalledTimes(1);
  });

  it('returns home from the keyboard too', async () => {
    const user = userEvent.setup();
    const { onNavigateHome } = renderHeader();

    // The title is first in the header's tab order; Enter activates a button.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Call Analytics Forecast' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onNavigateHome).toHaveBeenCalledTimes(1);
  });

  it('does not render a Docs control when there is nothing to open', () => {
    renderHeader();

    expect(screen.queryByRole('button', { name: 'Docs' })).not.toBeInTheDocument();
  });

  it('marks Docs current in the docs view and only there', () => {
    const { rerender } = renderHeader({ onOpenDocs: vi.fn(), view: 'report' });

    expect(screen.getByRole('button', { name: 'Docs' })).not.toHaveAttribute('aria-current');

    rerender(
      <ThemeProvider>
        <DashboardHeader
          ingestion={INGESTION}
          generatedAt={GENERATED_AT}
          onNavigateHome={vi.fn()}
          onOpenDocs={vi.fn()}
          view="docs"
        />
      </ThemeProvider>,
    );

    expect(screen.getByRole('button', { name: 'Docs' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens the docs when the Docs control is activated', async () => {
    const user = userEvent.setup();
    const onOpenDocs = vi.fn();
    renderHeader({ onOpenDocs, view: 'report' });

    await user.click(screen.getByRole('button', { name: 'Docs' }));

    expect(onOpenDocs).toHaveBeenCalledTimes(1);
  });
});
