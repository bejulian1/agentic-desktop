// Round 12, part B: the shortcuts that could not be bound again (browser.newTab, browser.newTabFull),
// and Økt's own shortcut.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers.ts";

test("Ny fane, Ny fane i fullvisning and Økt can be bound to other keys", async (t) => {
  const h = await startHarness(t);
  const shortcuts = { "browser.newTab": "Mod+Alt+N", "browser.newTabFull": "Mod+Alt+Shift+N", "panel.session": "Mod+Alt+0" };
  const settings = await h.api("PATCH", "/api/settings", { shortcuts });
  assert.deepEqual(settings.shortcuts, shortcuts);
  // An unknown id is still refused.
  const res = await h.raw("PATCH", "/api/settings", { headers: { "content-type": "application/json" }, body: JSON.stringify({ shortcuts: { "browser.ukjent": "Mod+Alt+U" } }) });
  assert.equal(res.status, 400);
});
