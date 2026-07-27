import styles from './Callout.module.css';

export type CalloutTone = 'critical' | 'warning' | 'info' | 'good';

/**
 * Icon per tone — the port of `SEVERITY_ICON`.
 *
 * The icon exists so a status is never carried by colour alone. `good` has no
 * entry in the Python map and falls through to `_callout()`'s default glyph;
 * that default is reproduced here rather than inventing a new one.
 */
const TONE_ICON: Record<CalloutTone, string> = {
  critical: '▲',
  warning: '◆',
  info: '●',
  good: '●',
};

/** Python writes the tone as its own label via `tone.title()`. */
const TONE_LABEL: Record<CalloutTone, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
  good: 'Good',
};

interface CalloutProps {
  tone?: CalloutTone;
  children: string;
}

/**
 * A status message carrying an icon and a written label — the port of
 * `_callout()`.
 *
 * The icon is `aria-hidden`: it is a redundant encoding of the tone for
 * sighted readers, and the adjacent text label is what a screen reader
 * announces. Reading both would just be "triangle Critical …".
 */
export function Callout({ tone = 'info', children }: CalloutProps) {
  return (
    <div className={`${styles.callout} ${styles[tone]}`}>
      <span className={styles.icon} aria-hidden="true">
        {TONE_ICON[tone]}
      </span>
      <span className={styles.label}>{TONE_LABEL[tone]}</span>
      <span className={styles.text}>{children}</span>
    </div>
  );
}
