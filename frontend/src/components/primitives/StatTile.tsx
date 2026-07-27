import type { ReactNode } from 'react';
import styles from './StatTile.module.css';

/**
 * Tones a tile may carry.
 *
 * Deliberately narrow: a tile is tinted only when the number itself is the
 * alert. Everything else stays neutral so the tinted one still reads as
 * exceptional.
 */
export type TileTone = 'critical' | 'good';

interface StatTileProps {
  label: string;
  /** Pre-formatted. The tile never formats — units and precision are the caller's. */
  value: string;
  sub?: string;
  tone?: TileTone;
}

/** A single headline number — the port of `_stat_tile()`. The number is the chart. */
export function StatTile({ label, value, sub, tone }: StatTileProps) {
  const className = tone ? `${styles.tile} ${styles[tone]}` : styles.tile;
  return (
    <div className={className}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {sub ? <div className={styles.sub}>{sub}</div> : null}
    </div>
  );
}

/** The auto-fitting grid the tiles sit in — the port of `.tiles`. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
