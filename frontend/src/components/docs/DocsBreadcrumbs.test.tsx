// @vitest-environment jsdom
/**
 * Orientation only: the last crumb names the current page and is not a
 * control, and the first crumb is a real button that hands off to `onExit`
 * — the same "leaving is a view change, not a navigation" contract every
 * other exit control in this tree follows.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocsBreadcrumbs } from './DocsBreadcrumbs';

describe('DocsBreadcrumbs', () => {
  it('renders Documentation / <page title>', () => {
    render(<DocsBreadcrumbs pageTitle="Forecasting models" onExit={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Documentation' })).toBeInTheDocument();
    expect(screen.getByText('Forecasting models')).toBeInTheDocument();
  });

  it('marks the last crumb current and not a control', () => {
    render(<DocsBreadcrumbs pageTitle="Forecasting models" onExit={vi.fn()} />);

    const current = screen.getByText('Forecasting models');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).not.toBe('BUTTON');
    expect(current.tagName).not.toBe('A');
  });

  it('wraps the crumbs in a nav labelled Breadcrumb, as an ordered list', () => {
    render(<DocsBreadcrumbs pageTitle="Forecasting models" onExit={vi.fn()} />);

    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav.querySelector('ol')).not.toBeNull();
  });

  it('calls onExit when the first crumb is clicked', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<DocsBreadcrumbs pageTitle="Forecasting models" onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'Documentation' }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
