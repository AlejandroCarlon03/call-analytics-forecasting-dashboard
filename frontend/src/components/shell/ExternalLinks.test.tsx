// @vitest-environment jsdom
import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExternalLinks } from './ExternalLinks';
import { SideNav } from './SideNav';
import { EXTERNAL_LINKS } from '../../config/externalLinks';

const TABS = [
  { target: 'call_volume', label: 'Daily calls' },
  { target: 'total_cost', label: 'Daily cost' },
];

describe('ExternalLinks', () => {
  it('renders one link per configured entry, in order', () => {
    render(<ExternalLinks />);

    const nav = screen.getByRole('navigation', { name: 'External resources' });
    const links = within(nav).getAllByRole('link');

    expect(links).toHaveLength(EXTERNAL_LINKS.length);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      EXTERNAL_LINKS.map((link) => link.href),
    );
  });

  it('is titled External Resources', () => {
    render(<ExternalLinks />);
    expect(screen.getByText('External Resources')).toBeInTheDocument();
  });

  // The requirement the whole component exists to satisfy.
  it('opens every link in a new tab, with the opener denied', () => {
    render(<ExternalLinks />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      const rel = link.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });

  it('sends every link off-site rather than into the fragment', () => {
    // A relative or `#`-prefixed href here would edit the URL that carries the
    // model selection and the docs route. Absolute https only.
    for (const link of EXTERNAL_LINKS) {
      expect(link.href).toMatch(/^https:\/\//);
    }
  });

  /* These are shortcuts, not pages of this report. `aria-current` is how the
     rails mark the selected one, so its absence here is the assertion that an
     external link can never render as the current dashboard page. */
  it('never marks a link as the current page', () => {
    render(<ExternalLinks />);

    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('names the destination and the new tab in the accessible name', () => {
    render(<ExternalLinks />);

    const links = screen.getAllByRole('link');

    EXTERNAL_LINKS.forEach((entry, index) => {
      const link = links[index] as HTMLElement;
      // Matched positionally rather than by name: the assertion here *is* what
      // the name contains, so looking the element up by it would be circular.
      expect(link.textContent).toBe(`${entry.label} — ${entry.description}`);
      expect(link).toHaveAttribute('title', entry.description);
    });
  });

  it('hides every icon from the accessibility tree', () => {
    const { container } = render(<ExternalLinks />);
    const svgs = Array.from(container.querySelectorAll('svg'));

    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('is reachable by keyboard, one link at a time', async () => {
    const user = userEvent.setup();
    render(<ExternalLinks />);

    const links = screen.getAllByRole('link');
    for (const link of links) {
      await user.tab();
      expect(link).toHaveFocus();
    }
  });
});

describe('ExternalLinks inside the model rail', () => {
  it('sits outside the tab list, so nothing about the tabs changes', () => {
    const { container } = render(<SideNav tabs={TABS} selected={null} onSelect={() => {}} />);

    // `moveFocus` reads the tab container's buttons; an anchor is not one, and
    // the section is not inside that container either.
    const external = screen.getByRole('navigation', { name: 'External resources' });
    const tabButtons = Array.from(container.querySelectorAll('button'));

    expect(tabButtons).toHaveLength(TABS.length + 1); // + the synthetic "All"
    expect(external.querySelectorAll('button')).toHaveLength(0);
    expect(external.contains(tabButtons[0] as Node)).toBe(false);
  });

  it('leaves the rail its own labelled navigation region', () => {
    render(<SideNav tabs={TABS} selected="total_cost" onSelect={() => {}} />);

    expect(screen.getByRole('navigation', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'External resources' })).toBeInTheDocument();
  });

  /* Arrow keys wrap across the model tabs and must not walk into the links —
     PR 11's contract, re-pinned here because this PR is what could break it. */
  it('keeps arrow-key focus movement inside the model tabs', async () => {
    const user = userEvent.setup();
    render(<SideNav tabs={TABS} selected={null} onSelect={() => {}} />);

    const all = screen.getByRole('button', { name: 'All' });
    all.focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Daily cost' })).toHaveFocus();

    // End is the last *tab*, so one more step wraps to the first tab rather
    // than continuing into the external links.
    await user.keyboard('{ArrowDown}');
    expect(all).toHaveFocus();
  });
});

