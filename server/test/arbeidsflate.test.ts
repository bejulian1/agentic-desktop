// v1.4.0, Innstillinger → Utseende → Arbeidsflate: the settings are checked and can be reset, and
// a project's automatic colour is stable, never grey, and never overrides a colour the user picked.
// Only the demo model; nothing leaves the machine.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO_PROJECT_COLORS, defaultProjectColor, isFullWorkspace, isSimpleWorkspace, PROJECT_COLORS, projectColorId, SIMPLE_WORKSPACE } from "../../shared/protocol.ts";
import { startHarness } from "./helpers.ts";

const JSON_HEADERS = { "content-type": "application/json" };

test("Arbeidsflate: the settings are saved, checked and reset with null", async (t) => {
  const h = await startHarness(t);
  const before = (await h.api("GET", "/api/bootstrap")).settings;
  for (const key of ["topbarLayout", "topbarShowPanes", "sidebarSimple", "composerSimple"]) assert.equal(key in before, false, `${key} is unset by default`);
  assert.equal(isFullWorkspace(before), true);

  const saved = await h.api("PATCH", "/api/settings", { ...SIMPLE_WORKSPACE });
  assert.deepEqual([saved.topbarLayout, saved.topbarShowPanes, saved.sidebarSimple, saved.composerSimple], ["minimal", false, true, true]);
  assert.equal(isSimpleWorkspace((await h.api("GET", "/api/bootstrap")).settings), true);

  for (const body of [{ topbarLayout: "kompakt" }, { topbarLayout: 1 }, { sidebarSimple: "ja" }, { composerSimple: 1 }, { topbarShowPanes: "nei" }]) {
    const res = await h.raw("PATCH", "/api/settings", { headers: JSON_HEADERS, body: JSON.stringify(body) });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await h.api("GET", "/api/bootstrap")).settings.topbarLayout, "minimal", "a bad value changes nothing");

  await h.api("PATCH", "/api/settings", { topbarLayout: null, topbarShowPanes: null, sidebarSimple: null, composerSimple: null });
  const after = (await h.api("GET", "/api/bootstrap")).settings;
  for (const key of ["topbarLayout", "topbarShowPanes", "sidebarSimple", "composerSimple"]) assert.equal(key in after, false, `${key} is reset`);
});

test("project colours: automatic from the id, stable, never grey, and the user's choice wins", () => {
  assert.equal(AUTO_PROJECT_COLORS.includes("gray"), false);
  assert.equal(AUTO_PROJECT_COLORS.length, PROJECT_COLORS.length - 1);
  const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const picked = ids.map(defaultProjectColor);
  assert.deepEqual(ids.map(defaultProjectColor), picked, "the same id gives the same colour");
  assert.ok(picked.every((id) => AUTO_PROJECT_COLORS.includes(id)));
  assert.ok(new Set(picked).size >= AUTO_PROJECT_COLORS.length - 2, `spread over the palette (${new Set(picked).size})`);
  assert.equal(projectColorId({ color: "gray", id: ids[0] }), "gray", "grey on purpose stays grey");
  assert.equal(projectColorId({ color: null, id: ids[0] }), picked[0]);
  assert.equal(projectColorId({ color: "turkis", id: ids[0] }), picked[0], "an unknown colour falls back to the automatic one");
  assert.equal(projectColorId({ color: null }), null, "nothing to pick from");
});
