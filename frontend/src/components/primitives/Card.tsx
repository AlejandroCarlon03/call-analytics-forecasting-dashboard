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
  children: ReactNode;
}

/** A surface card — the port of `_card()` in `dashboard.py`. */
export function Card({ title, anchor, children }: CardProps) {
  return (
    <div className={styles.card} {...(anchor ? { id: anchor } : {})}>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      {children}
    </div>
  );
}
