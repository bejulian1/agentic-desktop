// Round 15 (SPEC 31.2): the files of the React preview's runtime (react.js, boot.js and their
// chunks), which web/vite-preview-runtime.ts builds into <web dist>/preview-runtime/. The preview
// server hands them out on its own origin. Nothing else is ever read here: a name must look like
// one of the built files and be in that one folder's listing, so no path from a request reaches
// the disk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.js$/;

export interface RuntimeFile {
  body: Buffer;
  etag: string;
}

export class PreviewRuntime {
  private readonly dir: string;
  private names: Set<string> | null = null;

  constructor(dir: string) {
    this.dir = dir;
  }

  // Listed once, the first time a React preview asks: the folder only changes with a new build.
  private listing(): Set<string> {
    if (!this.names) {
      try {
        this.names = new Set(readdirSync(this.dir).filter((name) => NAME.test(name)));
      } catch {
        this.names = new Set();
      }
    }
    return this.names;
  }

  // Whether the runtime was built: without it, a React preview says so instead of failing.
  get available(): boolean {
    return this.listing().has("boot.js");
  }

  // Read when asked and not kept, so the server's memory stays as it was after a preview.
  file(name: string): RuntimeFile | undefined {
    if (!NAME.test(name) || !this.listing().has(name)) return undefined;
    const file = path.join(this.dir, name);
    try {
      const info = statSync(file);
      return { body: readFileSync(file), etag: `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"` };
    } catch {
      return undefined;
    }
  }
}
