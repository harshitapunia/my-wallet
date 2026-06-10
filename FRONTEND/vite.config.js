import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  /**
   * ─── Dev server config ────────────────────────────────────────────────────
   * open: false  →  stop Vite auto-launching a browser tab on `npm run dev`.
   *                 The extension runs from dist/ (Load Unpacked), not the
   *                 dev server, so auto-open just creates a confusing stray tab.
   */
  server: {
    open:  false,   // ← THE FIX: no auto browser tab
    port:  5173,
  },

  /**
   * ─── CRITICAL for Chrome Extensions ──────────────────────────────────────
   *
   * By default Vite outputs absolute paths like:
   *   <script src="/assets/index-abc123.js">
   *
   * Inside a chrome-extension:// page there is no web server, so the browser
   * interprets "/assets/…" as chrome-extension:///assets/… (triple-slash),
   * which is an invalid URL — the script silently fails to load and the
   * popup renders a blank white screen.
   *
   * Setting base: './' makes Vite emit relative paths instead:
   *   <script src="./assets/index-abc123.js">
   *
   * Relative paths resolve correctly relative to index.html regardless of
   * the protocol (chrome-extension://, http://, file://, etc.).
   */
  base: './',

  build: {
    /**
     * Output directory — 'dist' is the default.
     * Load unpacked → point Chrome at this folder.
     */
    outDir: 'dist',

    /**
     * Emit source maps so that "Inspect popup" in Chrome DevTools shows
     * your original JSX/JS source instead of minified bundle noise.
     * Set to false for a leaner production build when you no longer need them.
     */
    sourcemap: true,

    rollupOptions: {
      output: {
        /**
         * Keep chunk filenames predictable (no content hash) so that the
         * extension's CSP doesn't need to be updated on every rebuild.
         * Remove [hash] if you prefer stable names; keep it for cache-busting
         * if you ever serve this as a website too.
         */
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },
  },
})
