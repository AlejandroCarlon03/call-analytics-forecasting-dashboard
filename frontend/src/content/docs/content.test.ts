import { describe, expect, it } from 'vitest';
import { DOC_PAGE_IDS } from '../../lib/docs/types';
import type { DocBlock, DocPageId } from '../../lib/docs/types';
import { DOC_PAGES } from './index';

// Hardcoded from call_forecast/models/registry.py's REGISTRY. Update this
// list only if that registry actually changes.
const REGISTRY_MODEL_NAMES = [
  'seasonal_naive',
  'linear_regression',
  'random_forest',
  'xgboost',
  'prophet',
  'sarima',
] as const;

const HOW_A_PREDICTION_IS_MADE_STEPS = [
  'Historical Call Data',
  'Data Cleaning',
  'Feature Engineering',
  'Model Training',
  'Forecast Generation',
  'Confidence Estimation',
  'Dashboard Visualizations',
] as const;

describe('DOC_PAGES structural invariants', () => {
  it('has exactly six pages, one per DocPageId', () => {
    expect(DOC_PAGE_IDS).toHaveLength(6);
    expect(Object.keys(DOC_PAGES).sort()).toEqual([...DOC_PAGE_IDS].sort());
  });

  it.each(DOC_PAGE_IDS)('page %s has an id matching its key', (id: DocPageId) => {
    const page = DOC_PAGES[id];
    expect(page).toBeDefined();
    expect(page.id).toBe(id);
  });

  it.each(DOC_PAGE_IDS)('page %s has a non-empty title, summary and blocks', (id: DocPageId) => {
    const page = DOC_PAGES[id];
    expect(page.title.trim().length).toBeGreaterThan(0);
    expect(page.summary.trim().length).toBeGreaterThan(0);
    expect(page.blocks.length).toBeGreaterThan(0);
  });

  it('the models page has a modelCard for every name in the Python REGISTRY', () => {
    const modelCards = DOC_PAGES.models.blocks.filter(
      (b): b is Extract<DocBlock, { kind: 'modelCard' }> => b.kind === 'modelCard'
    );
    const cardIds = modelCards.map((c) => c.id).sort();
    expect(cardIds).toEqual([...REGISTRY_MODEL_NAMES].sort());
  });

  it('every modelCard has all five fields non-empty', () => {
    const modelCards = DOC_PAGES.models.blocks.filter(
      (b): b is Extract<DocBlock, { kind: 'modelCard' }> => b.kind === 'modelCard'
    );
    expect(modelCards.length).toBeGreaterThan(0);
    for (const card of modelCards) {
      expect(card.purpose.trim().length).toBeGreaterThan(0);
      expect(card.strengths.length).toBeGreaterThan(0);
      expect(card.weaknesses.length).toBeGreaterThan(0);
      expect(card.assumptions.length).toBeGreaterThan(0);
      expect(card.idealUseCases.length).toBeGreaterThan(0);
      for (const list of [card.strengths, card.weaknesses, card.assumptions, card.idealUseCases]) {
        for (const item of list) {
          expect(item.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it.each(DOC_PAGE_IDS)('every table block on %s has a caption and uniform row widths', (id: DocPageId) => {
    const tables = DOC_PAGES[id].blocks.filter(
      (b): b is Extract<DocBlock, { kind: 'table' }> => b.kind === 'table'
    );
    for (const table of tables) {
      expect(table.caption.trim().length).toBeGreaterThan(0);
      for (const row of table.rows) {
        expect(row.length).toBe(table.columns.length);
      }
    }
  });

  it.each(DOC_PAGE_IDS)('every diagram block on %s has a caption and at least two steps', (id: DocPageId) => {
    const diagrams = DOC_PAGES[id].blocks.filter(
      (b): b is Extract<DocBlock, { kind: 'diagram' }> => b.kind === 'diagram'
    );
    for (const diagram of diagrams) {
      expect(diagram.caption.trim().length).toBeGreaterThan(0);
      expect(diagram.steps.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the how-a-prediction-is-made page's diagram has exactly the seven specified steps in order", () => {
    const page = DOC_PAGES['how-a-prediction-is-made'];
    const diagrams = page.blocks.filter(
      (b): b is Extract<DocBlock, { kind: 'diagram' }> => b.kind === 'diagram'
    );
    expect(diagrams).toHaveLength(1);
    const labels = diagrams[0]?.steps.map((s) => s.label);
    expect(labels).toEqual([...HOW_A_PREDICTION_IS_MADE_STEPS]);
  });
});
