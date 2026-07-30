import type { FaqBlock } from '../../../lib/docs/types';
import styles from './DocFaq.module.css';

/**
 * Expandable question-and-answer pairs — the port of the contract's
 * `FaqBlock`.
 *
 * Native `<details>`/`<summary>` per entry: keyboard operable, findable by the
 * browser's own find-in-page, and printable, with no `aria-expanded`
 * bookkeeping of our own.
 */
export function DocFaq({ block }: { block: FaqBlock }) {
  return (
    <div className={styles.faq}>
      {block.items.map((item) => (
        <details key={item.question} className={styles.item}>
          <summary className={styles.summary}>{item.question}</summary>
          <p className={styles.answer}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
