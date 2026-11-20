// Round 8 (agent G): every colour theme holds WCAG AA for text (Høy kontrast AAA), and each palette
// sets the same tokens in its light and dark variant. The check itself is scripts/kontrast.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll, loadThemes, mismatchedTokens, missingAccents } from "../../scripts/kontrast.ts";

test("alle temaene holder WCAG AA for tekst", () => {
  const themes = loadThemes();
  assert.equal(themes.filter((t) => !t.id.startsWith("aksent-")).length, 12, "seks temaer, lys og mørk");
  // And the six accent colours from Innstillinger, in both modes (round 8, UI-retter 2; red in round 9).
  assert.equal(themes.filter((t) => t.id.startsWith("aksent-")).length, 12, "seks aksentfarger, lys og mørk");
  assert.deepEqual(missingAccents(), [], "every accent in Innstillinger has its tokens");
  const failed = checkAll().filter((c) => !c.ok).map((c) => `${c.theme}: ${c.fg} på ${c.bg} ${c.ratio.toFixed(2)}:1 < ${c.min}:1`);
  assert.deepEqual(failed, []);
});

test("hvert tema setter de samme tokenene i lys og mørk", () => {
  assert.deepEqual(mismatchedTokens(), {});
});
