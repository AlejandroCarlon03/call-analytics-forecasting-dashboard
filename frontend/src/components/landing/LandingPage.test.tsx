// @vitest-environment jsdom
/**
 * The landing page's own contract.
 *
 * What belongs here is what the component owns: the actions it offers, that
 * they are the right *kind* of control, that they are reachable from the
 * keyboard, and — the reason the page exists — that it shows no dashboard.
 * Whether entering actually mounts the report is `App`'s contract and is
 * tested there.
 */

import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { EXTERNAL_LINKS } from '../../config/externalLinks';
import { LandingPage } from './LandingPage';

function renderLanding(overrides: Partial<Parameters<typeof LandingPage>[0]> = {}) {
  const props = {
    onEnter: vi.fn(),
    onImport: vi.fn(),
    onOpenDocs: vi.fn(),
    ...overrides,
  };
  render(
    <ThemeProvider>
      <LandingPage {...props} />
    </ThemeProvider>,
  );
  return props;
}

describe('LandingPage', () => {
  it('names the application and says what it does', () => {
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Call Analytics Forecast');
    expect(
      screen.getByText(/Forecast call volume, analyze operational trends/i),
    ).toBeInTheDocument();
  });

  it('offers Import Dashboard as a real button and calls back', async () => {
    const { onImport } = renderLanding();
    const cta = screen.getByRole('button', { name: 'Import Dashboard' });
    await userEvent.click(cta);
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('offers a separate way into the dashboard itself', async () => {
    const { onEnter } = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('opens the documentation through a callback, not a link off the page', async () => {
    const { onOpenDocs } = renderLanding();
    const docs = screen.getByRole('button', { name: /Documentation & about/i });
    await userEvent.click(docs);
    expect(onOpenDocs).toHaveBeenCalledTimes(1);
  });

  it('links to the repository from the shared config, and leaves the page safely', () => {
    renderLanding();
    const repository = EXTERNAL_LINKS.find((link) => link.id === 'github');
    if (!repository) throw new Error('config is missing the github entry');

    const link = screen.getByRole('link', { name: /GitHub/ });
    expect(link).toHaveAttribute('href', repository.href);
    expect(link).toHaveAttribute('target', '_blank');
    // `noopener` denies the opened page a handle on `window.opener`;
    // `noreferrer` keeps a `file://` or intranet URL out of a referrer log.
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    // The destination is spoken, not left to the indicator glyph.
    expect(link).toHaveAccessibleName(new RegExp(repository.description.slice(0, 20), 'i'));
  });

  it('shows a Recent imports placeholder with an honest empty state', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: 'Recent imports' })).toBeInTheDocument();
    expect(screen.getByText('No imports yet')).toBeInTheDocument();
  });

  it('renders no dashboard content: no charts, no tables, no tiles', () => {
    renderLanding();
    expect(document.querySelectorAll('.js-plotly-plot')).toHaveLength(0);
    expect(screen.queryAllByRole('table')).toHaveLength(0);
    // The rail is the report's, and there is no report yet.
    expect(screen.queryByRole('navigation', { name: 'Models' })).not.toBeInTheDocument();
  });

  it('keeps the heading hierarchy intact: one h1, then h2s', () => {
    renderLanding();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
  });

  it('reaches every action from the keyboard, in order', async () => {
    renderLanding();
    const order = [
      screen.getByRole('button', { name: /Switch to (light|dark) mode/ }),
      screen.getByRole('button', { name: 'Import Dashboard' }),
      screen.getByRole('button', { name: 'Open dashboard' }),
      screen.getByRole('button', { name: /Documentation & about/i }),
      screen.getByRole('link', { name: /GitHub/ }),
      screen.getByRole('button', { name: 'Import a dataset' }),
    ];
    for (const element of order) {
      await userEvent.tab();
      expect(element).toHaveFocus();
    }
  });

  it('activates the primary action with the keyboard', async () => {
    const { onImport } = renderLanding();
    screen.getByRole('button', { name: 'Import Dashboard' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it('writes nothing to the location fragment', async () => {
    window.location.hash = '';
    const { onEnter } = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: 'Open dashboard' }));
    await userEvent.click(screen.getByRole('button', { name: /Documentation & about/i }));
    expect(onEnter).toHaveBeenCalled();
    // The fragment is the selection and the docs route; this page owns neither
    // and must not write one. `entered` is component state for this reason.
    expect(window.location.hash).toBe('');
  });
});
