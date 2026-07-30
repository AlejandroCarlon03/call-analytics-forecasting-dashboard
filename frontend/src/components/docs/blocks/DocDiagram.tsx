import { useId } from 'react';
import type { DiagramBlock } from '../../../lib/docs/types';
import styles from './DocDiagram.module.css';

/**
 * A linear flow rendered as labelled steps with connectors — the port of the
 * contract's `DiagramBlock`.
 *
 * Built from DOM and CSS, no SVG asset and no diagramming dependency: an
 * ordered list of steps stacked vertically below the 480px breakpoint and
 * flowing horizontally above it, so it stays readable at 375px. Connectors
 * between steps are `aria-hidden` — the reading order of the `<ol>` already
 * carries the sequence, so an arrow glyph would be a redundant announcement.
 */
export function DocDiagram({ block }: { block: DiagramBlock }) {
  const captionId = useId();
  return (
    <figure className={styles.figure} aria-labelledby={captionId}>
      <ol className={styles.steps}>
        {block.steps.map((step, index) => (
          <li key={step.label} className={styles.step}>
            <div className={styles.stepBody}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.stepLabel}>{step.label}</span>
              {step.detail ? <span className={styles.stepDetail}>{step.detail}</span> : null}
            </div>
            {index < block.steps.length - 1 ? (
              <span className={styles.connector} aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <figcaption id={captionId} className={styles.caption}>
        {block.caption}
      </figcaption>
    </figure>
  );
}
