import type { ReactNode } from 'react';
import styles from './Section.module.css';

interface SectionProps {
  title: string;
  /** The explanatory paragraph under the heading — `_section()`'s `blurb`. */
  blurb?: string;
  /**
   * A DOM id, so a caller can scroll to or focus into this section.
   *
   * Optional and unset by default: the report's sections are found by reading
   * down the page, and only the landing page's "Import Dashboard" action needs
   * to send a reader to one in particular. It is deliberately *not* used as a
   * fragment anchor — the fragment on this page carries the selection, and a
   * bare `#anchor` would overwrite it (§11's skip-link trap).
   */
  id?: string;
  children: ReactNode;
}

/**
 * A titled dashboard section — the port of `_section()` in `dashboard.py`.
 *
 * The heading is a small uppercase label rather than a large title: sections
 * are wayfinding, and the cards inside them carry the weight. That is a
 * deliberate choice inherited from the Python dashboard, not an oversight.
 */
export function Section({ title, blurb, id, children }: SectionProps) {
  return (
    <section className={styles.section} id={id}>
      <h2 className={styles.heading}>{title}</h2>
      {blurb ? <p className={styles.blurb}>{blurb}</p> : null}
      {children}
    </section>
  );
}
