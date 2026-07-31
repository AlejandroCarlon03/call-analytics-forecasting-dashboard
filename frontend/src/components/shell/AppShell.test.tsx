// @vitest-environment jsdom
/**
 * The shell grew a skip link in PR 11, and the one thing that could go wrong
 * with it is invisible in a screenshot: `href="#report"` writes the location
 * fragment, and on this page the fragment *is* the model selection. A skip
 * that cleared the reader's filter would look perfect and be wrong.
 *
 * These tests therefore assert the two halves separately — focus lands on the
 * report, and `location.hash` is untouched by it — rather than trusting that
 * an anchor with an `onClick` does the second for free.
 */

import '@testing-library/jest-dom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';

function renderShell(withNav = true) {
  return render(
    <AppShell
      header={<header>Header</header>}
      {...(withNav ? { nav: <nav aria-label="Models">Rail</nav> } : {})}
      footer={<footer>Footer</footer>}
    >
      <p>Report body</p>
    </AppShell>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    location.hash = '';
  });

  afterEach(() => {
    location.hash = '';
  });

  it('puts the skip link first in the tab order', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.tab();

    expect(screen.getByRole('link', { name: /skip to report/i })).toHaveFocus();
  });

  it('renders main as the skip link target, focusable but out of the tab sequence', () => {
    renderShell();

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'report');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /skip to report/i })).toHaveAttribute(
      'href',
      '#report',
    );
  });

  it('moves focus into the report when the skip link is activated', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('link', { name: /skip to report/i }));

    expect(screen.getByRole('main')).toHaveFocus();
  });

  /* The regression this file exists for. */
  it('leaves an existing selection fragment untouched when skipping', async () => {
    location.hash = '#model=total_cost&horizon=30';
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('link', { name: /skip to report/i }));

    expect(location.hash).toBe('#model=total_cost&horizon=30');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('does not write a fragment when there was none', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('link', { name: /skip to report/i }));

    expect(location.hash).toBe('');
  });

  it('keeps one main, and the skip link, with no rail', () => {
    renderShell(false);

    expect(screen.getByRole('main')).toHaveAttribute('id', 'report');
    expect(screen.getByRole('link', { name: /skip to report/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByText('Report body')).toBeInTheDocument();
  });

  /*
   * The PR 19 regression, and the reason the layout wrapper is unconditional.
   *
   * The rail disappears on every CSV/XLSX import, because an imported payload
   * has no targets. While `main` was a direct child without a rail and a
   * wrapper's child with one, that transition changed the shape of the tree and
   * React remounted the whole report — `ImportPanel` set its success state and
   * was destroyed in the same commit, so the confirmation for the primary
   * import route could never be seen.
   *
   * "The child kept its state" is the property that actually broke. Asserting
   * class names instead would pass while the remount carried on.
   */
  describe('rail transitions', () => {
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <button type="button" onClick={() => setN((v) => v + 1)}>
          count {n}
        </button>
      );
    }

    function Harness({ withNav }: { withNav: boolean }) {
      return (
        <AppShell
          header={<header>Header</header>}
          {...(withNav ? { nav: <nav aria-label="Models">Rail</nav> } : {})}
          footer={<footer>Footer</footer>}
        >
          <Counter />
        </AppShell>
      );
    }

    it('does not remount the report when the rail disappears', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Harness withNav />);

      await user.click(screen.getByRole('button', { name: /count 0/i }));
      expect(screen.getByRole('button', { name: /count 1/i })).toBeInTheDocument();

      // The rail goes away, exactly as it does on a CSV import.
      rerender(<Harness withNav={false} />);

      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
      // A remount would have reset this to "count 0".
      expect(screen.getByRole('button', { name: /count 1/i })).toBeInTheDocument();
    });

    it('does not remount the report when the rail appears', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<Harness withNav={false} />);

      await user.click(screen.getByRole('button', { name: /count 0/i }));

      // The other direction: importing a dashboard_data.json over a CSV.
      rerender(<Harness withNav />);

      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /count 1/i })).toBeInTheDocument();
    });
  });
});
