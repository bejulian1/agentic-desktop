import { cpSync, existsSync } from "node:fs";
import path from "node:path";

// Editable app assets live beside the bundled server, under AD_APP_ROOT.
export function copyAppSkills(root: string, appRoot: string): void {
  const source = path.join(root, "skills");
  if (existsSync(source)) cpSync(source, path.join(appRoot, "skills"), { recursive: true });
}
