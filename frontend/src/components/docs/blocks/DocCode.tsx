import type { CodeBlock } from '../../../lib/docs/types';
import styles from './DocCode.module.css';

/**
 * A fixed-width snippet — the port of the contract's `CodeBlock`.
 *
 * No syntax highlighter: `language` is carried only as `data-language`, a
 * styling hook, never used to select a tokenizer. `tabIndex={0}` on the
 * `<pre>` lets a keyboard user scroll a snippet wider than its column without
 * needing to first tab into a focusable descendant.
 */
export function DocCode({ block }: { block: CodeBlock }) {
  return (
    <pre className={styles.pre} data-language={block.language} tabIndex={0}>
      <code>{block.code}</code>
    </pre>
  );
}
