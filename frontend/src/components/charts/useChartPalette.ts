import { useMemo, useSyncExternalStore } from 'react';
import { readPalette, type ChartPalette } from '../../lib/chart/palette';

/**
 * The resolved chart palette for the current theme.
 *
 * The palette is read from the CSS custom properties on `documentElement`
 * rather than from a copy of `THEME` in TypeScript, so the audited palette has
 * one source of truth (`tokens.css`, generated and drift-tested). That makes
 * *when* to re-read the interesting question, and the obvious answer is wrong:
 *
 * `useTheme().mode` changes one render **before** the palette does.
 * `ThemeProvider` writes `data-theme` in an effect, and React flushes child
 * effects before parent effects, so anything keyed on `mode` — a `useMemo`, a
 * `useEffect`, a `useLayoutEffect` — reads the *previous* theme's variables and
 * then never runs again. The charts stay in the old palette on a page that has
 * already switched.
 *
 * So this subscribes to the DOM instead of to React state: a MutationObserver
 * on the `data-theme` attribute, which fires after the provider's write, plus
 * the `prefers-color-scheme` media query, which is what changes when the viewer
 * is following the OS and no attribute is written at all. Either one bumps a
 * version, the version re-reads the palette, and every chart rebuilds from it.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Bumped whenever the resolved palette could have changed.
 *
 * A counter rather than the palette itself because `useSyncExternalStore`
 * requires a snapshot that is referentially stable between changes, and
 * `readPalette` builds a fresh object on every call.
 */
let version = 0;

function subscribe(onChange: () => void): () => void {
  const bump = () => {
    version += 1;
    onChange();
  };

  const observer = new MutationObserver(bump);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  const media = window.matchMedia?.(DARK_QUERY);
  media?.addEventListener('change', bump);

  return () => {
    observer.disconnect();
    media?.removeEventListener('change', bump);
  };
}

function getSnapshot(): number {
  return version;
}

export function useChartPalette(): ChartPalette {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => readPalette(document.documentElement), [theme]);
}
