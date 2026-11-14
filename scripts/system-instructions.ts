import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";

// Keep these editable runtime assets outside the server bundle, under the same app root as docs/.
export function copySystemInstructions(root: string, appRoot: string): void {
  mkdirSync(path.join(appRoot, "docs"), { recursive: true });
  cpSync(path.join(root, "docs/system-instructions"), path.join(appRoot, "docs/system-instructions"), { recursive: true });
}
