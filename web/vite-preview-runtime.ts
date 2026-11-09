// Round 15 (SPEC 31.2): the React preview's runtime, built next to the app into
// <outDir>/preview-runtime/. The app never loads it: only the preview server serves it, on its own
// origin, to a sandboxed iframe, and only when a React artifact is shown.
//
//   react.js, react-dom.js, react-dom-client.js, jsx-runtime.js
//                 what the import map in the preview page points "react", "react-dom",
//                 "react-dom/client" and "react/jsx-runtime" at. React 19 ships CommonJS only, so
//                 each is a small ES module made here that names every export of the production
//                 build. They share one copy of React in a chunk of its own.
//   boot.js       reads the code from the page, makes JavaScript of the JSX and TypeScript with
//                 Sucrase (a chunk of its own, loaded by boot.js), checks the imports and renders.
//
// Everything is local: no CDN, nothing fetched from the network.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";

export const RUNTIME_DIR = "preview-runtime";

const require = createRequire(import.meta.url);

// What the import map offers, and the CommonJS production file whose exports each one names.
const MODULES: Record<string, { from: string; file: string }> = {
  react: { from: "react", file: "react/cjs/react.production.js" },
  "react-dom": { from: "react-dom", file: "react-dom/cjs/react-dom.production.js" },
  "react-dom-client": { from: "react-dom/client", file: "react-dom/cjs/react-dom-client.production.js" },
  "jsx-runtime": { from: "react/jsx-runtime", file: "react/cjs/react-jsx-runtime.production.js" },
};

const PREFIX = "\0ad-rt:";

// The package's "exports" hides its cjs/ folder, so the file is found from its package.json.
function exportNames(file: string): string[] {
  const [pkg, ...rest] = file.split("/");
  const source = readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), ...rest), "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(match[1]);
  return [...names].filter((name) => name !== "default").sort();
}

function wrappers(): Plugin {
  return {
    name: "ad-preview-runtime-wrappers",
    resolveId(id) {
      return id.startsWith("ad-rt:") ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const entry = MODULES[id.slice(PREFIX.length)];
      const names = exportNames(entry.file);
      return [
        `import M from ${JSON.stringify(entry.from)};`,
        "export default M;",
        `export const { ${names.join(", ")} } = M;`,
      ].join("\n");
    },
  };
}

export async function buildPreviewRuntime(outDir: string): Promise<void> {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const input: Record<string, string> = { boot: path.join(root, "src/preview-runtime/boot.ts") };
  for (const name of Object.keys(MODULES)) input[name] = `ad-rt:${name}`;
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    mode: "production",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [wrappers()],
    build: {
      outDir: path.join(outDir, RUNTIME_DIR),
      emptyOutDir: true,
      target: "chrome150",
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input,
        preserveEntrySignatures: "strict",
        output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "[name]-[hash].js" },
      },
    },
  });
}

// Runs after the app's own build, into the same outDir.
export function previewRuntime(): Plugin {
  let outDir = "dist";
  return {
    name: "ad-preview-runtime",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await buildPreviewRuntime(outDir);
    },
  };
}
