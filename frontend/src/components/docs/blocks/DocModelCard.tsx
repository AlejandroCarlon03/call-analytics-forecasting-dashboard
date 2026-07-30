import type { ModelCardBlock } from '../../../lib/docs/types';
import styles from './DocModelCard.module.css';

/**
 * One forecasting model, laid out in the five fields every model shares — the
 * port of the contract's `ModelCardBlock`.
 *
 * Every field group appears for every model, in the same order, so the page
 * scans as a comparison rather than reading as five different structures.
 * Strengths and weaknesses are told apart by a written label ("Strengths" /
 * "Weaknesses"), never by colour alone (SESSION_CONTEXT §6).
 */
export function DocModelCard({ block }: { block: ModelCardBlock }) {
  return (
    <article className={styles.card} aria-label={block.name}>
      <header className={styles.header}>
        <h3 className={styles.name}>{block.name}</h3>
        <span className={styles.id}>{block.id}</span>
      </header>
      <p className={styles.purpose}>{block.purpose}</p>

      <div className={styles.field}>
        <h4 className={styles.fieldLabel}>Strengths</h4>
        <ul className={styles.fieldList}>
          {block.strengths.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className={styles.field}>
        <h4 className={styles.fieldLabel}>Weaknesses</h4>
        <ul className={styles.fieldList}>
          {block.weaknesses.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className={styles.field}>
        <h4 className={styles.fieldLabel}>Assumptions</h4>
        <ul className={styles.fieldList}>
          {block.assumptions.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>

      <div className={styles.field}>
        <h4 className={styles.fieldLabel}>Ideal use cases</h4>
        <ul className={styles.fieldList}>
          {block.idealUseCases.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
