import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration.
 *
 * `base: './'` matters more than it looks: the production build is destined to
 * be opened from `file://` as a single self-contained page, where absolute
 * asset paths resolve against the filesystem root and silently 404. Relative
 * paths are what make an offline, mailable report possible.
 *
 * Single-file bundling (vite-plugin-singlefile) and the Python template
 * handoff arrive in PR 6; this config deliberately stops short of that so the
 * scaffold stays reviewable on its own.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    // Source maps would be dead weight inside a single-file report, and the
    // bundle-size budget in PR 6 is measured against the real output.
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // The figure builders are pure functions over payload rows, so the tests
  // need neither a DOM nor a real Plotly. Keeping it that way is deliberate:
  // it is what makes the silent chart failures (a lost category axis, a marker
  // symbol that reverted to a circle) assertable at all.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
