import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  /** Optional `h3` above the body. */
  title?: string;
  /**
   * DOM id, so the model rail can scroll the card into view.
   *
   * Named `anchor` rather than `id` to match `_card()` and to keep it clear
   * that it is a scroll target, not an arbitrary attribute passthrough.
   */
  anchor?: string;
  /**
   * A line of context between the title and the body — the `<p class='blurb'>`
   * the Python model-comparison and explainability cards open with.
   *
   * `ReactNode` rather than `string` because the selected-model line emphasises
   * the winner's name. It is not a `Callout`: those carry a severity icon and
   * read as an aside, and this is the card's own subtitle.
   */
  blurb?: ReactNode;
  children: ReactNode;
}

/** A surface card — the port of `_card()` in `dashboard.py`. */
export function Card({ title, anchor, blurb, children }: CardProps) {
  return (
    <div className={styles.card} {...(anchor ? { id: anchor } : {})}>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      {children}
    </div>
  );
}
