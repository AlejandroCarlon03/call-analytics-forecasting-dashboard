import { createContext } from 'react';

/** The two rendered appearances. */
export type ThemeMode = 'light' | 'dark';

/**
 * What the viewer has asked for.
 *
 * `'system'` is a real, distinct state rather than the absence of a choice: it
 * means "keep following the OS", and a viewer who has been in dark mode all
 * along because their OS is dark has not thereby chosen dark.
 */
export type ThemePreference = ThemeMode | 'system';

export interface ThemeContextValue {
  /** The appearance currently rendered. */
  mode: ThemeMode;
  /** What the viewer asked for, which may be `'system'`. */
  preference: ThemePreference;
  /** Flip between light and dark, pinning the result. */
  toggle: () => void;
  /** Set an explicit preference, or hand control back to the OS. */
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
