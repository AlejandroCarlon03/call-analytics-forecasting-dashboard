import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Vite configuration.
 *
 * `base: './'` matters more than it looks: the production build is destined to
 * be opened from `file://` as a single self-contained page, where absolute
 * asset paths resolve against the filesystem root and silently 404. Relative
 * paths are what make an offline, mailable report possible.
 *
 * PR 6: `vite-plugin-singlefile` inlines the JS bundle and the CSS into
 * `dist/index.html` as a `<script>` and a `<style>` tag, so `dist/` ships a
 * single file rather than an `index.html` plus a `assets/` directory. The
 * plugin's own `useRecommendedBuildConfig` (left at its default of `true`)
 * is what actually does most of the work below — it forces
 * `assetsInlineLimit`, `cssCodeSplit: false`, `assetsDir: ''` and
 * `rollupOptions.output.inlineDynamicImports: true` onto the build, so those
 * are not duplicated here. `inlineDynamicImports` is the one that matters for
 * `loadPayload.ts`'s dev-fixture `import()`: without it, Rollup would put the
 * dynamic-import branch in its own chunk even though `import.meta.env.DEV`
 * guarantees it is never reached in production, and the plugin has no second
 * HTML file to inline that chunk into.
 */
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    outDir: 'dist',
    // Source maps would be dead weight inside a single-file report, and the
    // bundle-size budget in PR 6 is measured against the real output.
    sourcemap: false,
    // Plotly alone is over the default 500 kB chunk-size warning; the real
    // budget is the ≤ 2 MB single-file target checked after `npm run build`,
    // not Rollup's generic chunk heuristic.
    chunkSizeWarningLimit: 2000,
    // Every byte here is measured against the size budget by hand after the
    // build; the size-report step Vite would otherwise spend time on is
    // redundant work when the whole point is a single small file.
    reportCompressedSize: false,
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
