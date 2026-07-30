// @vitest-environment jsdom
/**
 * One assertion per block kind: that it renders the semantic element the
 * contract in `lib/docs/types.ts` promises, not that it carries particular
 * CSS. The FAQ and code-block cases also check the structural details the
 * contract calls out explicitly (native `<details>`, `data-language`).
 */

import '@testing-library/jest-dom';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocBlocks } from './index';
import type { DocBlock, ModelCardBlock } from '../../../lib/docs/types';

describe('DocBlocks', () => {
  it('renders a paragraph as a <p>', () => {
    const blocks: DocBlock[] = [{ kind: 'paragraph', text: 'Some prose about forecasting.' }];
    render(<DocBlocks blocks={blocks} />);
    expect(screen.getByText('Some prose about forecasting.').tagName).toBe('P');
  });

  it('renders a heading as an h3', () => {
    const blocks: DocBlock[] = [{ kind: 'heading', text: 'Data sources' }];
    render(<DocBlocks blocks={blocks} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Data sources' })).toBeInTheDocument();
  });

  it('renders an unordered list with real list semantics', () => {
    const blocks: DocBlock[] = [{ kind: 'list', items: ['First', 'Second'] }];
    render(<DocBlocks blocks={blocks} />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders an ordered list as <ol> when ordered is set', () => {
    const blocks: DocBlock[] = [{ kind: 'list', ordered: true, items: ['Step one', 'Step two'] }];
    render(<DocBlocks blocks={blocks} />);
    expect(screen.getByRole('list').tagName).toBe('OL');
  });

  it('delegates a callout to the Callout primitive and renders an optional title', () => {
    const blocks: DocBlock[] = [
      { kind: 'callout', tone: 'warning', title: 'Heads up', text: 'Coverage below 60%.' },
    ];
    render(<DocBlocks blocks={blocks} />);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Coverage below 60%.')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
  });

  it('renders a table with an accessible name from the caption and matching cells', () => {
    const blocks: DocBlock[] = [
      {
        kind: 'table',
        caption: 'Model comparison',
        columns: ['Model', 'MAE'],
        rows: [
          ['Random Forest', '4.2'],
          ['Prophet', '5.1'],
        ],
      },
    ];
    render(<DocBlocks blocks={blocks} />);
    const table = screen.getByRole('table', { name: 'Model comparison' });
    expect(table).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    // Header row + two data rows.
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'Random Forest' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4.2' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'MAE' })).toBeInTheDocument();
  });

  it('renders definitions as a real dl/dt/dd', () => {
    const blocks: DocBlock[] = [
      {
        kind: 'definitions',
        items: [{ term: 'MAE', description: 'Mean absolute error.' }],
      },
    ];
    const { container } = render(<DocBlocks blocks={blocks} />);
    expect(container.querySelector('dl')).toBeInTheDocument();
    expect(container.querySelector('dt')?.textContent).toBe('MAE');
    expect(container.querySelector('dd')?.textContent).toBe('Mean absolute error.');
  });

  it('renders a code block as <pre><code> with a data-language attribute', () => {
    const blocks: DocBlock[] = [{ kind: 'code', language: 'bash', code: 'npm run build' }];
    const { container } = render(<DocBlocks blocks={blocks} />);
    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveAttribute('data-language', 'bash');
    expect(pre?.querySelector('code')?.textContent).toBe('npm run build');
    expect(pre).toHaveAttribute('tabIndex', '0');
  });

  it('renders a diagram as a figure with the caption as a real figcaption', () => {
    const blocks: DocBlock[] = [
      {
        kind: 'diagram',
        caption: 'Ingestion pipeline',
        steps: [{ label: 'Ingest' }, { label: 'Clean', detail: 'Drop bad rows' }, { label: 'Forecast' }],
      },
    ];
    render(<DocBlocks blocks={blocks} />);
    const figure = screen.getByRole('figure', { name: 'Ingestion pipeline' });
    expect(figure).toBeInTheDocument();
    expect(screen.getByText('Ingest')).toBeInTheDocument();
    expect(screen.getByText('Drop bad rows')).toBeInTheDocument();
  });

  it('renders a model card with all five field groups visibly labelled', () => {
    const modelCard: ModelCardBlock = {
      kind: 'modelCard',
      id: 'random_forest',
      name: 'Random Forest',
      purpose: 'Ensemble regression for tabular features.',
      strengths: ['Handles nonlinearity'],
      weaknesses: ['No native seasonality'],
      assumptions: ['Stationary feature relationships'],
      idealUseCases: ['Short-horizon volume forecasts'],
    };
    render(<DocBlocks blocks={[modelCard]} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Random Forest' })).toBeInTheDocument();
    expect(screen.getByText('random_forest')).toBeInTheDocument();
    expect(screen.getByText('Strengths')).toBeInTheDocument();
    expect(screen.getByText('Weaknesses')).toBeInTheDocument();
    expect(screen.getByText('Assumptions')).toBeInTheDocument();
    expect(screen.getByText('Ideal use cases')).toBeInTheDocument();
    expect(screen.getByText('Handles nonlinearity')).toBeInTheDocument();
    expect(screen.getByText('No native seasonality')).toBeInTheDocument();
  });

  it('renders an FAQ as native details/summary that toggles open', async () => {
    const blocks: DocBlock[] = [
      {
        kind: 'faq',
        items: [{ question: 'Why is coverage low?', answer: 'Fewer than 60% of days have calls logged.' }],
      },
    ];
    const { container } = render(<DocBlocks blocks={blocks} />);
    const details = container.querySelector('details');
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText('Why is coverage low?').tagName).toBe('SUMMARY');

    // Native disclosure toggling needs no React state or aria-expanded of our
    // own — setting the `open` attribute is what the browser does natively.
    details?.setAttribute('open', '');
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Fewer than 60% of days have calls logged.')).toBeInTheDocument();
  });

  it('renders every block kind for a mixed page without throwing', () => {
    const blocks: DocBlock[] = [
      { kind: 'paragraph', text: 'Intro.' },
      { kind: 'heading', text: 'Section' },
      { kind: 'list', items: ['a', 'b'] },
      { kind: 'callout', text: 'Note.' },
      { kind: 'table', caption: 'Cap', columns: ['A'], rows: [['1']] },
      { kind: 'definitions', items: [{ term: 'T', description: 'D' }] },
      { kind: 'code', code: 'x = 1' },
      { kind: 'diagram', caption: 'Flow', steps: [{ label: 'One' }] },
      {
        kind: 'modelCard',
        id: 'm',
        name: 'M',
        purpose: 'p',
        strengths: ['s'],
        weaknesses: ['w'],
        assumptions: ['a'],
        idealUseCases: ['u'],
      },
      { kind: 'faq', items: [{ question: 'Q?', answer: 'A.' }] },
    ];
    expect(() => render(<DocBlocks blocks={blocks} />)).not.toThrow();
  });
});
