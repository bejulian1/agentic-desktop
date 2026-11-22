// Round 8 (agent G): every colour theme holds WCAG AA for text (Høy kontrast AAA), and each palette
// sets the same tokens in its light and dark variant. The check itself is scripts/kontrast.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { THEME_PRESETS } from "../../shared/protocol.ts";
import { checkAll, loadThemes, mismatchedTokens, missingAccents } from "../../scripts/kontrast.ts";

test("alle temaene holder WCAG AA for tekst", () => {
  const themes = loadThemes();
  assert.equal(themes.filter((t) => !t.id.startsWith("aksent-")).length, 22, "elleve temaer, lys og mørk");
  // And the six accent colours from Innstillinger, in both modes (round 8, UI-retter 2; red in round 9).
  assert.equal(themes.filter((t) => t.id.startsWith("aksent-")).length, 12, "seks aksentfarger, lys og mørk");
  assert.deepEqual(missingAccents(), [], "every accent in Innstillinger has its tokens");
  const failed = checkAll().filter((c) => !c.ok).map((c) => `${c.theme}: ${c.fg} på ${c.bg} ${c.ratio.toFixed(2)}:1 < ${c.min}:1`);
  assert.deepEqual(failed, []);
});

test("hvert tema setter de samme tokenene i lys og mørk", () => {
  assert.deepEqual(mismatchedTokens(), {});
});

// v1.2.0: the picker's small previews are drawn from web/src/state/themes.ts, and must be the colours
// the stylesheet really sets. The file is read as text, since it needs the browser's i18n.
test("fargene i temavelgeren er de samme som i stilarket", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../../web/src/state/themes.ts"), "utf8");
  const entries = [...source.matchAll(/id: "([a-z]+)",[\s\S]*?light: \{([^}]*)\},\s*dark: \{([^}]*)\},/g)];
  assert.deepEqual(entries.map((e) => e[1]), [...THEME_PRESETS], "same ids, in the same order as the protocol");
  const tokens: Record<string, string> = { bg: "--bg", side: "--bg-sidebar", surface: "--surface-2", text: "--text", muted: "--text-3", accent: "--accent", keyword: "--tok-keyword", string: "--tok-string", fn: "--tok-function" };
  const all = new Map(loadThemes().map((t) => [t.id, t]));
  const wrong: string[] = [];
  for (const [, id, light, dark] of entries) {
    for (const [variant, body] of [["lys", light], ["mørk", dark]] as const) {
      const theme = all.get(`${id}-${variant}`)!;
      for (const m of body.matchAll(/(\w+): "(#[0-9a-f]{6})"/gi)) {
        const actual = theme.tokens[tokens[m[1]]]?.toLowerCase();
        if (actual !== m[2].toLowerCase()) wrong.push(`${id}-${variant} ${m[1]}: ${m[2]} er ikke ${actual}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test("de nye temaene har sine kjennetegn", () => {
  const all = new Map(loadThemes().map((t) => [t.id, t.tokens]));
  const expected: Record<string, { darkBg: string; darkSide: string; darkAccent: string; lightAccent: string; lightBg: string }> = {
    ocean: { darkBg: "#141c24", darkSide: "#10171f", darkAccent: "#4dd4d0", lightAccent: "#0d7c86", lightBg: "#f5f9fc" },
    rosa: { darkBg: "#1e141b", darkSide: "#191016", darkAccent: "#f06292", lightAccent: "#c2185b", lightBg: "#fdf6f9" },
    skog: { darkBg: "#141c17", darkSide: "#101713", darkAccent: "#52c98e", lightAccent: "#1f7a4d", lightBg: "#f6faf7" },
    glod: { darkBg: "#1c1714", darkSide: "#171310", darkAccent: "#e88c54", lightAccent: "#b54d1d", lightBg: "#fcf8f4" },
    iris: { darkBg: "#171622", darkSide: "#13121c", darkAccent: "#a38bff", lightAccent: "#5e47c7", lightBg: "#f8f7fc" },
  };
  for (const [id, e] of Object.entries(expected)) {
    assert.equal(all.get(`${id}-mørk`)!["--bg"], e.darkBg, id);
    assert.equal(all.get(`${id}-mørk`)!["--bg-sidebar"], e.darkSide, id);
    assert.equal(all.get(`${id}-mørk`)!["--accent"], e.darkAccent, id);
    assert.equal(all.get(`${id}-lys`)!["--accent"], e.lightAccent, id);
    assert.equal(all.get(`${id}-lys`)!["--bg"], e.lightBg, id);
  }
  // The six older ones are still there with their old ids, so saved settings keep working.
  for (const old of ["standard", "kontrast", "varm", "kald", "fjord", "solbleket"]) assert.ok(THEME_PRESETS.includes(old as never), old);
});
