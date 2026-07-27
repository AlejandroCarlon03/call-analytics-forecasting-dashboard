import type { ReactNode } from 'react';
import styles from './Section.module.css';

interface SectionProps {
  title: string;
  /** The explanatory paragraph under the heading — `_section()`'s `blurb`. */
  blurb?: string;
  children: ReactNode;
}

/**
 * A titled dashboard section — the port of `_section()` in `dashboard.py`.
 *
 * The heading is a small uppercase label rather than a large title: sections
 * are wayfinding, and the cards inside them carry the weight. That is a
 * deliberate choice inherited from the Python dashboard, not an oversight.
 */
export function Section({ title, blurb, children }: SectionProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      {children}
    </section>
  );
}
