import type { DocBlock } from '../../../lib/docs/types';
import { Callout } from '../../primitives';
import type { Column } from '../../primitives';
import { DataTable } from '../../primitives';
import { DocCode } from './DocCode';
import { DocDiagram } from './DocDiagram';
import { DocFaq } from './DocFaq';
import { DocModelCard } from './DocModelCard';
import styles from './blocks.module.css';

/** A table block's row is just its own cells; the column index is the key. */
function tableColumns(columns: readonly string[]): ReadonlyArray<Column<readonly string[]>> {
  return columns.map((header, index) => ({
    key: String(index),
    header,
    value: (row: readonly string[]) => row[index],
  }));
}

/**
 * Renders one `DocBlock`.
 *
 * Kept in `DocBlocks.tsx` alongside the dispatcher for the simple kinds
 * (paragraph, heading, list, definitions, callout, table); the four kinds
 * complex enough to earn their own layout and stylesheet — code, diagram,
 * modelCard, faq — live in their own files and are delegated to here.
 */
function renderBlock(block: DocBlock, index: number) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={index} className={styles.paragraph}>
          {block.text}
        </p>
      );

    case 'heading':
      return (
        <h3 key={index} className={styles.heading}>
          {block.text}
        </h3>
      );

    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={index} className={styles.list}>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ListTag>
      );
    }

    case 'callout':
      return (
        <div key={index} className={styles.calloutBlock}>
          {block.title ? <p className={styles.calloutTitle}>{block.title}</p> : null}
          <Callout {...(block.tone ? { tone: block.tone } : {})}>{block.text}</Callout>
        </div>
      );

    case 'table':
      return (
        <div key={index} className={styles.tableWrap}>
          <DataTable columns={tableColumns(block.columns)} rows={block.rows} caption={block.caption} />
        </div>
      );

    case 'definitions':
      return (
        <dl key={index} className={styles.definitions}>
          {block.items.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.description}</dd>
            </div>
          ))}
        </dl>
      );

    case 'code':
      return <DocCode key={index} block={block} />;

    case 'diagram':
      return <DocDiagram key={index} block={block} />;

    case 'modelCard':
      return <DocModelCard key={index} block={block} />;

    case 'faq':
      return <DocFaq key={index} block={block} />;

    default: {
      // Exhaustiveness check: adding a block kind without a renderer here is a
      // compile error, per the contract's promise in `lib/docs/types.ts`.
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}

/** Maps a documentation page's blocks to their renderers, in order. */
export function DocBlocks({ blocks }: { blocks: readonly DocBlock[] }) {
  return <>{blocks.map((block, index) => renderBlock(block, index))}</>;
}
