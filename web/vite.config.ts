import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { previewRuntime } from "./vite-preview-runtime.ts";

export default defineConfig({
  // previewRuntime: the React preview's runtime, beside the app (SPEC 31.2).
  plugins: [solid(), previewRuntime()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The app runs only in Chromium: Chrome in the tests and localhost, Electron 45 (Chromium 156).
    target: "chrome150",
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // Everything the first view needs in one file instead of four, and the CSS for it in one
        // file in the same order. What is lazy stays in chunks of its own (docs/perf/web-bunten.md).
        codeSplitting: { groups: [{ name: "app", tags: ["$initial"] }] },
      },
    },
  },
  worker: { format: "es" },
});
