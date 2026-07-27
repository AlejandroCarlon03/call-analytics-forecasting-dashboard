import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeContext';

/**
 * Read the current theme.
 *
 * Throws outside a `ThemeProvider` rather than returning a plausible default:
 * a chart silently rendering light marks on a dark page is the failure this
 * migration is meant to eliminate, and it is much cheaper to catch here.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }
  return context;
}
