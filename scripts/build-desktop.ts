// Builds the Electron shell to JavaScript in desktop/build (or the folder given with --out):
//   main.mjs          the main process (desktop/main.ts)
//   preload.cjs       the preload, CommonJS because a sandboxed preload cannot be a module
//   server/server.mjs the server (desktop/server-entry.ts and server/src), for Electron's Node
//   shell/            the app's own pages and the icons
// Vite's bundler does it, the one web/ already uses. node-pty, playwright-core, ws and ignore stay
// outside the bundle and are loaded from node_modules, as with `npm start`.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { build, type InlineConfig } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");

export async function buildDesktop(out = path.join(ROOT, "desktop/build")): Promise<string> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const bundle = (entry: string, outDir: string, file: string, format: "es" | "cjs"): InlineConfig => ({
    configFile: false,
    root: ROOT,
    publicDir: false,
    logLevel: "warn",
    build: {
      ssr: path.join(ROOT, entry),
      outDir,
      emptyOutDir: false,
      target: "node24", // Electron 45 has Node 24
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rollupOptions: { output: { format, entryFileNames: file, codeSplitting: false } },
    },
    ssr: { target: "node" },
  });

  await build(bundle("desktop/main.ts", out, "main.mjs", "es"));
  await build(bundle("desktop/preload.ts", out, "preload.cjs", "cjs"));
  await build(bundle("desktop/server-entry.ts", path.join(out, "server"), "server.mjs", "es"));

  cpSync(path.join(ROOT, "desktop/shell"), path.join(out, "shell"), { recursive: true });
  cpSync(path.join(ROOT, "desktop/icons/png"), path.join(out, "shell/icons"), { recursive: true });
  return out;
}

if (import.meta.main) {
  const at = process.argv.indexOf("--out");
  const out = await buildDesktop(at > 0 ? path.resolve(process.argv[at + 1]) : undefined);
  console.log(`Electron-skallet er bygget i ${path.relative(ROOT, out) || "."}.`);
}
