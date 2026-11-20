import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const guide = readFileSync(new URL("../../docs/SLASH-SKILLS.md", import.meta.url), "utf8");
const section = guide.split("## Innebygde skills\n")[1];
assert.ok(section, "Missing bundled skill catalog in the user guide");
const rows = [...section.matchAll(/^\| `\/([a-z0-9-]+)` \| ([^\n]+?) \|$/gm)];
assert.ok(rows.length, "Missing skill rows in the user guide");
export const documentedSkills = rows.map(([, name]) => name).sort();
export const sharedSkills = rows.filter(([, , use]) => use.includes("(Chat og Kode)")).map(([, name]) => name).sort();
