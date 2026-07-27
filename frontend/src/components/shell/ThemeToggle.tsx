import { useTheme } from '../../theme/useTheme';
import styles from './ThemeToggle.module.css';

/**
 * Light/dark switch.
 *
 * The label names the mode the click will *produce*, not the current one —
 * carried over from the Python dashboard, where the button reads "Dark mode"
 * while the page is light.
 */
export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const next = mode === 'dark' ? 'light' : 'dark';

  return (
    <button
      id="theme-toggle"
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
    >
      {next === 'dark' ? 'Dark mode' : 'Light mode'}
    </button>
  );
}
