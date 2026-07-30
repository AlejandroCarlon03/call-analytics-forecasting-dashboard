/**
 * The documentation content model.
 *
 * **This file is the contract, and it is deliberately data-only.** Pages are
 * plain values — no JSX, no components, no imports from `components/`. That is
 * what lets the content be written, reviewed and tested independently of how it
 * is rendered, and it is what keeps a markdown renderer out of the bundle: the
 * structure a doc page needs is small and closed, so it is cheaper to enumerate
 * it than to ship a parser for it (§13's bundle advisory has 8 KB of headroom).
 *
 * The split it enforces:
 *
 * ```
 * content/docs/*.ts        DocPage values          — what the docs say
 * components/docs/blocks/  one renderer per kind   — how a block looks
 * components/docs/         nav, layout, crumbs     — how pages are reached
 * ```
 *
 * A block kind is added by extending `DocBlock` here, adding a renderer to the
 * blocks barrel, and using it from content. All three steps are required — the
 * union is exhaustively switched, so a missing renderer is a type error rather
 * than a silently blank page.
 */

import type { CalloutTone } from '../../components/primitives';

/**
 * A documentation page's stable identifier.
 *
 * These are URL fragment values (`#view=docs&page=models`), so they outlive the
 * build that produced them — an emailed link to the models page must not break
 * because a heading was reworded. Renaming one is a breaking change to a link
 * somebody may have saved; adding one is not.
 */
export type DocPageId =
  | 'about'
  | 'how-a-prediction-is-made'
  | 'models'
  | 'forecasting'
  | 'metrics'
  | 'data-quality';

/**
 * Every page id, in the order the sidebar lists them.
 *
 * The order is the reading order, and it widens as it goes: what this is, how
 * one prediction gets made end to end, then the three reference pages a reader
 * comes back to. `how-a-prediction-is-made` sits second deliberately — it is
 * the orientation page, and a reader who reads only it should still be able to
 * follow a number from a CSV row to a chart.
 */
export const DOC_PAGE_IDS: readonly DocPageId[] = [
  'about',
  'how-a-prediction-is-made',
  'models',
  'forecasting',
  'metrics',
  'data-quality',
];

/** The page a reader lands on when they open the docs with no page named. */
export const DEFAULT_DOC_PAGE: DocPageId = 'about';

/** Ordinary prose. One idea per block; the renderer supplies the spacing. */
export interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
}

/**
 * A subheading inside a page.
 *
 * There is no level: the page title is the `h2` and every heading inside it is
 * an `h3`. A doc page deep enough to need `h4` is a page that should have been
 * two pages, and letting content choose a level is how a heading hierarchy ends
 * up skipping one — which is a real accessibility failure, not a style
 * preference.
 */
export interface HeadingBlock {
  kind: 'heading';
  text: string;
}

/** A bulleted or numbered list. Numbered means the order carries meaning. */
export interface ListBlock {
  kind: 'list';
  ordered?: boolean;
  items: readonly string[];
}

/**
 * An aside, reusing the dashboard's own `Callout` tones.
 *
 * The same four tones the report uses, so a caution in the docs reads exactly
 * like a caution on a card. `title` is optional because most asides are one
 * sentence and a heading on those is noise.
 */
export interface CalloutBlock {
  kind: 'callout';
  tone?: CalloutTone;
  title?: string;
  text: string;
}

/**
 * A small reference table.
 *
 * Cells are strings, not numbers: nothing here is computed from the payload, so
 * a number in a doc table is a written example and formatting it through
 * `lib/format.ts` would imply a precision it does not have.
 */
export interface TableBlock {
  kind: 'table';
  /** Required — it becomes the table's accessible name. */
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

/** A term list — glossary entries, config keys, metric definitions. */
export interface DefinitionsBlock {
  kind: 'definitions';
  items: readonly { term: string; description: string }[];
}

/**
 * A fixed-width block: a CLI invocation, a config snippet, a payload shape.
 *
 * `language` is a hint for styling only. There is **no syntax highlighter** —
 * that is a dependency and a bundle cost for prose nobody reads for colour.
 */
export interface CodeBlock {
  kind: 'code';
  language?: string;
  code: string;
}

/**
 * A linear flow, rendered as labelled steps rather than as an image.
 *
 * The dashboard's diagrams are pipelines and workflows, which are lists with an
 * arrow between them. Built from DOM and CSS, a step sequence stays readable at
 * 375px, respects the theme, is selectable text, and needs no `alt` that
 * restates it — none of which an SVG or a Mermaid dependency would give for
 * free.
 */
export interface DiagramBlock {
  kind: 'diagram';
  /** Required — it becomes the figure's accessible name. */
  caption: string;
  steps: readonly { label: string; detail?: string }[];
}

/**
 * One forecasting model, in the five fields every model is documented with.
 *
 * A structured block rather than prose, so the models page cannot end up
 * describing one model's weaknesses and omitting another's. The renderer lays
 * all five out identically, which is what makes the page scannable as a
 * comparison instead of readable only end to end.
 */
export interface ModelCardBlock {
  kind: 'modelCard';
  /** The registry name, e.g. `random_forest` — what `config.yaml` calls it. */
  id: string;
  /** The display name, e.g. "Random Forest". */
  name: string;
  purpose: string;
  strengths: readonly string[];
  weaknesses: readonly string[];
  assumptions: readonly string[];
  idealUseCases: readonly string[];
}

/**
 * Expandable question-and-answer pairs.
 *
 * Native `<details>`/`<summary>`, so it is keyboard operable, findable by the
 * browser's own find-in-page in supporting engines, and printable — without a
 * disclosure widget to build or an `aria-expanded` to keep in step.
 */
export interface FaqBlock {
  kind: 'faq';
  items: readonly { question: string; answer: string }[];
}

/** Every block a documentation page may contain. */
export type DocBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | CalloutBlock
  | TableBlock
  | DefinitionsBlock
  | CodeBlock
  | DiagramBlock
  | ModelCardBlock
  | FaqBlock;

/** A documentation page. */
export interface DocPage {
  id: DocPageId;
  /** The `h2`, and the last breadcrumb. */
  title: string;
  /** Short label for the sidebar, when the title is too long for it. */
  navLabel?: string;
  /** One sentence under the title saying what the page answers. */
  summary: string;
  blocks: readonly DocBlock[];
}
