import { useId } from 'react';
import styles from './HorizonSelect.module.css';

interface HorizonSelectProps {
  /** The configured horizons, in days — `config.forecast.horizons`. */
  horizons: readonly number[];
  /** The selected horizon. Always one of `horizons`. */
  value: number;
  onChange: (horizon: number) => void;
}

/**
 * How far into the forecast to show.
 *
 * A native `<select>` rather than a segmented button group: the options are
 * mutually exclusive, and a real select brings arrow keys, type-ahead, the
 * platform's own touch and screen-reader affordances and a correct accessible
 * name from its `<label>` — all of which a group of buttons would have to
 * reimplement as a roving-tabindex radiogroup to match.
 *
 * The selection is dashboard-wide, so every forecast card renders one of these
 * bound to the same value. Hence the hint after the control: three selects that
 * move together are confusing without a line saying they are meant to.
 */
export function HorizonSelect({ horizons, value, onChange }: HorizonSelectProps) {
  const id = useId();

  // Nothing to choose between. A run with one configured horizon — or none —
  // gets the report it would have had before this control existed.
  if (horizons.length < 2) return null;

  return (
    <div className={styles.horizon}>
      <label className={styles.label} htmlFor={id}>
        Show
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {horizons.map((horizon) => (
          <option key={horizon} value={horizon}>
            First {horizon} days
          </option>
        ))}
      </select>
      <span className={styles.hint}>applies to every forecast</span>
    </div>
  );
}
