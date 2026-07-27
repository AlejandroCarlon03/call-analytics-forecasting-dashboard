import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ThemeContext,
  type ThemeMode,
  type ThemePreference,
  type ThemeContextValue,
} from './ThemeContext';

/** localStorage key. Namespaced so it cannot collide on a shared origin. */
const STORAGE_KEY = 'call-forecast:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Read the stored preference.
 *
 * Wrapped because `localStorage` throws rather than returning null in a few
 * real situations — Safari private browsing, and any page opened from
 * `file://` with site data disabled. The production dashboard is opened from
 * `file://` by design, so this is a path that will be taken.
 */
function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // No persistence available; follow the OS and carry on.
  }
  return 'system';
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // Persistence is a convenience, never a requirement.
  }
}

function systemMode(): ThemeMode {
  return window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Owns the theme and keeps `documentElement` in step with it.
 *
 * The `data-theme` attribute is set **only** when the viewer has expressed a
 * preference. While following the OS the attribute stays absent, and the
 * `@media (prefers-color-scheme: dark)` rule in `tokens.css` does the work —
 * which is exactly how the Python dashboard behaves, and means the correct
 * palette is applied by the CSS cascade before React mounts rather than
 * flashing the wrong one and correcting it.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [osMode, setOsMode] = useState<ThemeMode>(systemMode);

  // Track the OS while the viewer has not overridden it. The listener stays
  // attached either way so that returning to 'system' resumes immediately.
  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => {
      setOsMode(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const mode: ThemeMode = preference === 'system' ? osMode : preference;

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeStoredPreference(next);
  }, []);

  // Toggling pins the result: someone who clicks "Dark mode" wants dark, not
  // "dark until the OS changes its mind at sunset".
  const toggle = useCallback(() => {
    setPreference(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setPreference]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, preference, toggle, setPreference }),
    [mode, preference, toggle, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
