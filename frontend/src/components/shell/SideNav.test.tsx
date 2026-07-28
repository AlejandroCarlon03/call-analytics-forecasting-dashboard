// @vitest-environment jsdom
/**
 * The rail became a real filter in PR 7, so its tests are the first in this
 * codebase that need a DOM at all: `aria-current` moving between buttons,
 * the live region's text, and keyboard activation are all things a pure
 * function over props can't observe.
 *
 * `selected`/`onSelect` are asserted through the same contract `App` uses —
 * a controlled `target | null` — never through `location.hash`. `SideNav`
 * doesn't read the URL and neither do these tests.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideNav, type NavTab } from './SideNav';

const TABS: NavTab[] = [
  { target: 'call_volume', label: 'Call volume' },
  { target: 'aht', label: 'Handle time' },
];

function currentTabs(): HTMLElement[] {
  return screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page');
}

describe('SideNav', () => {
  it('renders an "All" tab first, current when nothing is selected', () => {
    render(<SideNav tabs={TABS} selected={null} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['All', 'Call volume', 'Handle time']);
    expect(buttons[0]).toHaveAttribute('aria-current', 'page');
  });

  it('moves aria-current to the selected target and off "All", with exactly one current tab', () => {
    render(<SideNav tabs={TABS} selected="aht" onSelect={vi.fn()} />);

    expect(currentTabs()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Handle time' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'All' })).not.toHaveAttribute('aria-current');
  });

  it('has exactly one current tab in every selection state', () => {
    for (const selected of [null, 'call_volume', 'aht'] as const) {
      const { unmount } = render(<SideNav tabs={TABS} selected={selected} onSelect={vi.fn()} />);
      expect(currentTabs()).toHaveLength(1);
      unmount();
    }
  });

  it('calls onSelect with the target key when a tab is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected={null} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Handle time' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('aht');
  });

  it('calls onSelect with null when "All" is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected="aht" onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'All' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('renders every tab as a real button, and Tab reaches each in visual order', async () => {
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected={null} onSelect={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
    }

    await user.tab();
    expect(buttons[0]).toHaveFocus();
    await user.tab();
    expect(buttons[1]).toHaveFocus();
    await user.tab();
    expect(buttons[2]).toHaveFocus();
  });

  it('fires onSelect on Enter when a tab has focus', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected={null} onSelect={onSelect} />);

    screen.getByRole('button', { name: 'Call volume' }).focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('call_volume');
  });

  it('fires onSelect on Space when a tab has focus', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected={null} onSelect={onSelect} />);

    screen.getByRole('button', { name: 'Call volume' }).focus();
    await user.keyboard(' ');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('call_volume');
  });

  it('does not lose focus when a selection change re-renders the rail', () => {
    const { rerender } = render(<SideNav tabs={TABS} selected={null} onSelect={vi.fn()} />);

    const handleTime = screen.getByRole('button', { name: 'Handle time' });
    handleTime.focus();
    expect(handleTime).toHaveFocus();

    // Same tab identity re-rendered with a new `selected`, exactly as App
    // re-renders SideNav after writing the hash — not a fresh mount.
    rerender(<SideNav tabs={TABS} selected="aht" onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Handle time' })).toHaveFocus();
  });

  it('announces the selection through the live region, and updates it when the selection changes', () => {
    const { rerender } = render(<SideNav tabs={TABS} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByText(/showing all models/i)).toBeInTheDocument();

    rerender(<SideNav tabs={TABS} selected="call_volume" onSelect={vi.fn()} />);

    expect(screen.getByText(/showing call volume only/i)).toBeInTheDocument();
  });
});
