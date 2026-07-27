import { defineConfig } from 'vite';
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
});
