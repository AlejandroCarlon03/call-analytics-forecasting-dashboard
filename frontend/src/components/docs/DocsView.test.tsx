// @vitest-environment jsdom
/**
 * `DocsView` composes content and rendering it does not own — `content/docs`
 * (Agent 2) and `components/docs/blocks` (Agent 3) — through the exact seams
 * the lead specified. Both had landed by the time this suite ran, so it
 * exercises the real modules rather than stand-ins: what matters here is
 * that `DocsView` wires them correctly (title, summary, blocks, prev/next),
 * not that it reimplements block rendering.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DOC_PAGE_IDS, type DocPageId } from '../../lib/docs/types';
import { DOC_PAGES } from '../../content/docs';
import { DocsView } from './DocsView';

function idAt(index: number): DocPageId {
  const id = DOC_PAGE_IDS[index];
  if (id === undefined) throw new Error(`No doc page at index ${index}`);
  return id;
}

function labelFor(id: DocPageId): string {
  const page = DOC_PAGES[id];
  return page.navLabel ?? page.title;
}

describe('DocsView', () => {
  it('renders the breadcrumb, the h2 title, and the summary', () => {
    const target = idAt(0);
    render(<DocsView page={target} onSelect={vi.fn()} onExit={vi.fn()} />);

    expect(
      screen.getByRole('heading', { level: 2, name: DOC_PAGES[target].title }),
    ).toBeInTheDocument();
    expect(screen.getByText(DOC_PAGES[target].summary)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('never skips a heading level: the page title is an h2, not h1', () => {
    render(<DocsView page={idAt(2)} onSelect={vi.fn()} onExit={vi.fn()} />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders every page without throwing, including its blocks', () => {
    for (const id of DOC_PAGE_IDS) {
      const { unmount } = render(<DocsView page={id} onSelect={vi.fn()} onExit={vi.fn()} />);
      expect(screen.getByRole('heading', { level: 2, name: DOC_PAGES[id].title })).toBeInTheDocument();
      unmount();
    }
  });

  it('omits the previous link on the first page and the next link on the last page', () => {
    const firstId = idAt(0);
    const lastId = idAt(DOC_PAGE_IDS.length - 1);

    const { unmount } = render(<DocsView page={firstId} onSelect={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByText('Previous')).not.toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
    unmount();

    render(<DocsView page={lastId} onSelect={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.queryByText('Next')).not.toBeInTheDocument();
  });

  it('shows both prev and next on a page in the middle', () => {
    render(<DocsView page={idAt(Math.floor(DOC_PAGE_IDS.length / 2))} onSelect={vi.fn()} onExit={vi.fn()} />);

    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('calls onSelect with the neighbouring page id when prev/next is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const middleIndex = Math.floor(DOC_PAGE_IDS.length / 2);
    const middleId = idAt(middleIndex);
    const nextId = idAt(middleIndex + 1);
    const prevId = idAt(middleIndex - 1);
    render(<DocsView page={middleId} onSelect={onSelect} onExit={vi.fn()} />);

    await user.click(screen.getByText(labelFor(nextId)));
    expect(onSelect).toHaveBeenCalledWith(nextId);

    await user.click(screen.getByText(labelFor(prevId)));
    expect(onSelect).toHaveBeenCalledWith(prevId);
  });

  it('calls onExit when the breadcrumb "Documentation" crumb is clicked', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<DocsView page={idAt(0)} onSelect={vi.fn()} onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: 'Documentation' }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
