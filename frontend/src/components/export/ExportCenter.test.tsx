// @vitest-environment jsdom

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportCenter } from './ExportCenter';
import type { AnalyticDescriptor, ExportOutcome } from '../../lib/export/types';

const FORECASTS: AnalyticDescriptor = {
  id: 'forecasts',
  label: 'Forecasts',
  description: 'Daily forecast with calibrated intervals.',
  slug: 'forecasts',
  formats: ['csv', 'json', 'png'],
  requiresAnalysis: true,
};

const MONTHLY_COST: AnalyticDescriptor = {
  id: 'monthlyCost',
  label: 'Monthly cost',
  description: 'Projected cost per calendar month.',
  slug: 'monthly-cost',
  formats: ['csv', 'json', 'png'],
  requiresAnalysis: true,
};

// A PNG-incapable analytic, so the format-disabling behaviour has something
// real to test against without inventing a fourth format.
const HEATMAP_NO_PNG: AnalyticDescriptor = {
  id: 'heatmap',
  label: 'Arrivals heatmap',
  description: 'Observed call volume by weekday and hour.',
  slug: 'arrivals-heatmap',
  formats: ['csv', 'json'],
  requiresAnalysis: false,
};

const ANALYTICS = [FORECASTS, MONTHLY_COST, HEATMAP_NO_PNG];

function renderPanel(overrides: Partial<React.ComponentProps<typeof ExportCenter>> = {}) {
  const onExport = vi.fn();
  const onDismiss = vi.fn();
  const props = {
    analytics: ANALYTICS,
    busy: false,
    outcome: null,
    error: null,
    selectionLabel: 'All models',
    onExport,
    onDismiss,
    ...overrides,
  };
  const utils = render(<ExportCenter {...props} />);
  return { ...utils, onExport, onDismiss };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Export…' }));
}

describe('ExportCenter', () => {
  it('opens and closes the panel via the trigger, toggling aria-expanded', async () => {
    const user = userEvent.setup();
    renderPanel();

    const trigger = screen.getByRole('button', { name: 'Export…' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Analytics' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close export panel' }));
    expect(screen.queryByRole('group', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Export…' });

    await openPanel(user);
    // Move focus into the panel so the Escape keydown is heard by its handler
    // (the trigger sits outside the panel subtree it controls).
    await user.tab();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Analytics' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports checking multiple analytics', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole('checkbox', { name: 'Forecasts' }));
    await user.click(screen.getByRole('checkbox', { name: 'Monthly cost' }));

    expect(screen.getByRole('checkbox', { name: 'Forecasts' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Monthly cost' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Arrivals heatmap' })).not.toBeChecked();
  });

  it('Select all checks everything and Clear unchecks everything', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openPanel(user);

    await user.click(screen.getByRole('button', { name: 'Select all' }));
    for (const descriptor of ANALYTICS) {
      expect(screen.getByRole('checkbox', { name: descriptor.label })).toBeChecked();
    }

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    for (const descriptor of ANALYTICS) {
      expect(screen.getByRole('checkbox', { name: descriptor.label })).not.toBeChecked();
    }
  });

  it('calls onExport with checked analytics in catalogue order, not click order', async () => {
    const user = userEvent.setup();
    const { onExport } = renderPanel();
    await openPanel(user);

    // Click in reverse catalogue order.
    await user.click(screen.getByRole('checkbox', { name: 'Arrivals heatmap' }));
    await user.click(screen.getByRole('checkbox', { name: 'Forecasts' }));

    await user.click(screen.getByRole('button', { name: 'Export' }));

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith({
      analytics: ['forecasts', 'heatmap'],
      format: 'csv',
    });
  });

  it('disables a format none of the checked analytics support, and moves selection off it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openPanel(user);

    // Only the PNG-incapable analytic is checked.
    await user.click(screen.getByRole('checkbox', { name: 'Arrivals heatmap' }));

    const pngRadio = screen.getByRole('radio', { name: 'PNG' });
    expect(pngRadio).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeChecked();

    // Select PNG-capable format first, then verify moving to png works, then
    // remove support and confirm fallback.
    await user.click(screen.getByRole('checkbox', { name: 'Forecasts' }));
    await user.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeChecked();

    // Uncheck the only analytic that supports PNG.
    await user.click(screen.getByRole('checkbox', { name: 'Forecasts' }));

    expect(screen.getByRole('radio', { name: 'PNG' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeChecked();
  });

  it('Export is disabled with nothing checked, and while busy', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel();
    await openPanel(user);

    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Forecasts' }));
    expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled();

    rerender(
      <ExportCenter
        analytics={ANALYTICS}
        busy={true}
        outcome={null}
        error={null}
        selectionLabel="All models"
        onExport={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('shows a busy status in a role="status" region and sets aria-busy on the panel', async () => {
    const user = userEvent.setup();
    renderPanel({ busy: true });
    await openPanel(user);

    expect(screen.getByRole('status')).toHaveTextContent('Exporting…');
    // The panel carries aria-busy. It is a sibling of the live region rather
    // than its ancestor — the region is rendered outside the `open` guard so it
    // is in the document before its text changes (see ExportCenter.tsx).
    const panel = document.querySelector('[aria-busy]');
    expect(panel).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a success notification naming files and total size', async () => {
    const user = userEvent.setup();
    const outcome: ExportOutcome = {
      artifacts: [
        { fileName: 'call-forecast-forecasts-20260730-120000.csv', size: 1024 },
        { fileName: 'call-forecast-monthly-cost-20260730-120000.csv', size: 2048 },
      ],
      problems: [],
    };
    renderPanel({ outcome });
    await openPanel(user);

    // The outcome appears twice by design: once in the persistent polite live
    // region so it is *announced*, and once as the visible `Callout`, which is
    // `aria-hidden` so it is not read out a second time. Both halves are pinned
    // here — dropping either one silently loses a reader.
    const live = screen.getByRole('status');
    expect(live).toHaveTextContent('Exported 2 files');
    expect(live).toHaveTextContent('3 KB');
    expect(live).toHaveTextContent('call-forecast-forecasts-20260730-120000.csv');
    expect(live).toHaveTextContent('call-forecast-monthly-cost-20260730-120000.csv');

    const visible = screen.getByText(/Exported 2 files/i, {
      ignore: '[role="status"] *, [role="status"]',
    });
    expect(visible.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders a partial-success notification naming which analytic failed', async () => {
    const user = userEvent.setup();
    const outcome: ExportOutcome = {
      artifacts: [{ fileName: 'call-forecast-forecasts-20260730-120000.csv', size: 512 }],
      problems: [{ message: 'Leaderboard had no rows.', analytic: 'leaderboard' }],
    };
    renderPanel({ outcome });
    await openPanel(user);

    // Announced and shown, same as the full-success case above.
    expect(screen.getByRole('status')).toHaveTextContent('Leaderboard had no rows.');
    expect(
      screen.getByText(/Partial export/i, { ignore: '[role="status"] *, [role="status"]' }),
    ).toHaveTextContent('Leaderboard had no rows.');
  });

  it('renders a whole-run error in a role="alert" region, never in the success path', async () => {
    const user = userEvent.setup();
    renderPanel({ error: 'The disk could not be written to.' });
    await openPanel(user);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The disk could not be written to.');
    expect(screen.queryByText(/Exported/i)).not.toBeInTheDocument();
  });

  it('treats an outcome with no artifacts as an error, not a success', async () => {
    const user = userEvent.setup();
    const outcome: ExportOutcome = {
      artifacts: [],
      problems: [{ message: 'Nothing could be generated.' }],
    };
    renderPanel({ outcome });
    await openPanel(user);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Nothing could be generated.');
  });

  it('calls onDismiss when the notification is dismissed', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderPanel({ error: 'Boom.' });
    await openPanel(user);

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state instead of a fieldset when analytics is empty', async () => {
    const user = userEvent.setup();
    renderPanel({ analytics: [] });
    await openPanel(user);

    expect(screen.getByText(/no analysis to export/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Analytics' })).not.toBeInTheDocument();
  });

  it('is fully keyboard operable: tab to trigger, open, tab through controls', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Export…' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('group', { name: 'Analytics' })).toBeInTheDocument();

    // Space toggles a focused checkbox.
    const forecastsBox = screen.getByRole('checkbox', { name: 'Forecasts' });
    forecastsBox.focus();
    await user.keyboard(' ');
    expect(forecastsBox).toBeChecked();
  });
});
