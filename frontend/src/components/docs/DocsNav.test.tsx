// @vitest-environment jsdom
/**
 * `DocsNav` is the docs view's sibling to the model rail (`SideNav`), and its
 * tests port `SideNav.test.tsx`'s conventions: `aria-current` moving between
 * buttons, the live region text, and keyboard focus movement are all things a
 * pure function over props can't observe.
 *
 * Assertions are driven off `DOC_PAGE_IDS` and the real `DOC_PAGES` content
 * (Agent 2's), never a literal page count or a hardcoded label, so a page
 * added later — as `how-a-prediction-is-made` was mid-PR — does not break
 * this suite.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DOC_PAGE_IDS, type DocPageId } from '../../lib/docs/types';
import { DOC_PAGES } from '../../content/docs';
import { DocsNav } from './DocsNav';

function labelFor(id: DocPageId): string {
  const page = DOC_PAGES[id];
  return page.navLabel ?? page.title;
}

function idAt(index: number): DocPageId {
  const id = DOC_PAGE_IDS[index];
  if (id === undefined) throw new Error(`No doc page at index ${index}`);
  return id;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function currentTabs(): HTMLElement[] {
  return screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page');
}

describe('DocsNav', () => {
  it('lists every doc page, in DOC_PAGE_IDS order, labelled from content', () => {
    render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />);

    // "Back to report" is also a button, so scope to the ones carrying a
    // data-label — the page tabs.
    const tabs = screen.getAllByRole('button').filter((button) => button.hasAttribute('data-label'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(DOC_PAGE_IDS.map(labelFor));
  });

  it('marks exactly one tab current, matching the `current` prop', () => {
    const target = idAt(2);
    render(<DocsNav current={target} onSelect={vi.fn()} onExit={vi.fn()} />);

    expect(currentTabs()).toHaveLength(1);
    expect(screen.getByRole('button', { name: labelFor(target) })).toHaveAttribute('aria-current', 'page');
  });

  it('has exactly one current tab for every page id', () => {
    for (const id of DOC_PAGE_IDS) {
      const { unmount } = render(<DocsNav current={id} onSelect={vi.fn()} onExit={vi.fn()} />);
      expect(currentTabs()).toHaveLength(1);
      unmount();
    }
  });

  it('calls onSelect with the page id when a tab is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const target = idAt(2);
    render(<DocsNav current={idAt(0)} onSelect={onSelect} onExit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: labelFor(target) }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onExit when "Back to report" is clicked', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'Back to report' }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('renders every page tab as a real button', () => {
    render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />);

    const tabs = screen.getAllByRole('button').filter((button) => button.hasAttribute('data-label'));
    expect(tabs).toHaveLength(DOC_PAGE_IDS.length);
    for (const tab of tabs) {
      expect(tab.tagName).toBe('BUTTON');
      expect(tab).toHaveAttribute('type', 'button');
    }
  });

  describe('arrow-key focus movement', () => {
    it('ArrowDown/ArrowRight move focus forward and wrap at the end', async () => {
      const user = userEvent.setup();
      render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />);

      const first = screen.getByRole('button', { name: labelFor(idAt(0)) });
      const second = screen.getByRole('button', { name: labelFor(idAt(1)) });
      const last = screen.getByRole('button', { name: labelFor(idAt(DOC_PAGE_IDS.length - 1)) });

      first.focus();
      await user.keyboard('{ArrowDown}');
      expect(second).toHaveFocus();

      last.focus();
      await user.keyboard('{ArrowRight}');
      expect(first).toHaveFocus();
    });

    it('ArrowUp/ArrowLeft move focus backward and wrap at the start', async () => {
      const user = userEvent.setup();
      render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />);

      const first = screen.getByRole('button', { name: labelFor(idAt(0)) });
      const last = screen.getByRole('button', { name: labelFor(idAt(DOC_PAGE_IDS.length - 1)) });

      first.focus();
      await user.keyboard('{ArrowUp}');
      expect(last).toHaveFocus();

      await user.keyboard('{ArrowLeft}');
      const secondToLast = screen.getByRole('button', {
        name: labelFor(idAt(DOC_PAGE_IDS.length - 2)),
      });
      expect(secondToLast).toHaveFocus();
    });

    it('Home and End jump to the first and last tab', async () => {
      const user = userEvent.setup();
      render(<DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />);

      const middle = screen.getByRole('button', {
        name: labelFor(idAt(Math.floor(DOC_PAGE_IDS.length / 2))),
      });
      middle.focus();

      await user.keyboard('{End}');
      expect(screen.getByRole('button', { name: labelFor(idAt(DOC_PAGE_IDS.length - 1)) })).toHaveFocus();

      await user.keyboard('{Home}');
      expect(screen.getByRole('button', { name: labelFor(idAt(0)) })).toHaveFocus();
    });

    it('moves focus without selecting — arrowing never calls onSelect', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<DocsNav current={idAt(0)} onSelect={onSelect} onExit={vi.fn()} />);

      screen.getByRole('button', { name: labelFor(idAt(0)) }).focus();
      await user.keyboard('{ArrowDown}{ArrowDown}{End}{Home}');

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('still commits with Enter after arrowing to a tab', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<DocsNav current={idAt(0)} onSelect={onSelect} onExit={vi.fn()} />);

      screen.getByRole('button', { name: labelFor(idAt(0)) }).focus();
      await user.keyboard('{ArrowDown}{Enter}');

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(idAt(1));
    });
  });

  it('carries the bold-width reservation (data-label) on every tab', () => {
    render(<DocsNav current={idAt(2)} onSelect={vi.fn()} onExit={vi.fn()} />);

    const tabs = screen.getAllByRole('button').filter((button) => button.hasAttribute('data-label'));
    expect(tabs.map((tab) => tab.getAttribute('data-label'))).toEqual(DOC_PAGE_IDS.map(labelFor));
  });

  it('announces the current page through the live region, and updates it when current changes', () => {
    const { container, rerender } = render(
      <DocsNav current={idAt(0)} onSelect={vi.fn()} onExit={vi.fn()} />,
    );
    const liveRegion = () => container.querySelector('[aria-live="polite"]');

    expect(liveRegion()?.textContent).toMatch(new RegExp(escapeRegExp(labelFor(idAt(0))), 'i'));

    rerender(<DocsNav current={idAt(2)} onSelect={vi.fn()} onExit={vi.fn()} />);

    expect(liveRegion()?.textContent).toMatch(new RegExp(escapeRegExp(labelFor(idAt(2))), 'i'));
  });
});
