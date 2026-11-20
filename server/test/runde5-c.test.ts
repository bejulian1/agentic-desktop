// Round 5, agent C: the new settings in PATCH /api/settings, and the four providers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startHarness } from "./helpers.ts";

const NEW_FIELDS = ["startMode", "notifyOnDone", "soundOnDone", "confirmQuit", "accent", "uiFontSize", "codeFontSize", "density", "reduceMotion", "codeFont", "tabSize", "wrapCode"];

test("the new settings are left out until set, so the UI's defaults apply", async (t) => {
  const h = await startHarness(t);
  const { settings } = await h.api("GET", "/api/bootstrap");
  for (const key of NEW_FIELDS) assert.equal(settings[key], undefined, key);
  assert.equal(settings.thinkingSummary, undefined, "thinkingSummary is on until turned off");
  assert.equal(settings.expandShell, undefined, "expandShell is off until turned on");
});

test("valid values are saved and survive a read", async (t) => {
  const h = await startHarness(t);
  const value = {
    startMode: "code",
    notifyOnDone: "unfocused",
    soundOnDone: true,
    confirmQuit: true,
    accent: "green",
    uiFontSize: 16,
    codeFontSize: 13,
    density: "compact",
    reduceMotion: true,
    codeFont: "ubuntu",
    tabSize: 2,
    wrapCode: true,
    thinkingSummary: false,
    expandShell: true,
  };
  const saved = await h.api("PATCH", "/api/settings", value);
  for (const [key, v] of Object.entries(value)) assert.equal(saved[key], v, key);
  const { settings } = await h.api("GET", "/api/bootstrap");
  for (const [key, v] of Object.entries(value)) assert.equal(settings[key], v, key);
  assert.equal(settings.theme, "system", "other settings are untouched");
});

test("wrong values are refused with 400 and nothing is saved", async (t) => {
  const h = await startHarness(t);
  const bad: Array<Record<string, unknown>> = [
    { startMode: "kode" },
    { notifyOnDone: true },
    { accent: "#ff0000" },
    { accent: "red; background: url(x)" },
    { density: "tett" },
    { codeFont: "Comic Sans" },
    { uiFontSize: 40 },
    { uiFontSize: "14" },
    { uiFontSize: 14.5 },
    { codeFontSize: 9 },
    { tabSize: 3 },
  ];
  for (const body of bad) await assert.rejects(h.api("PATCH", "/api/settings", { ...body, soundOnDone: true }), /400/, JSON.stringify(body));
  const { settings } = await h.api("GET", "/api/bootstrap");
  for (const key of NEW_FIELDS) assert.equal(settings[key], undefined, `${key} after refused patches`);
});

test("flags are true only for true, and null resets a choice to its default", async (t) => {
  const h = await startHarness(t);
  const saved = await h.api("PATCH", "/api/settings", { soundOnDone: "ja", wrapCode: 1, reduceMotion: true, codeFontSize: 15, accent: "pink" });
  assert.equal(saved.soundOnDone, false);
  assert.equal(saved.wrapCode, false);
  assert.equal(saved.reduceMotion, true);
  const reset = await h.api("PATCH", "/api/settings", { codeFontSize: null, accent: null });
  assert.equal("codeFontSize" in reset, false, "left out again");
  assert.equal("accent" in reset, false);
  assert.equal(reset.reduceMotion, true, "a reset touches only its own field");
});

test("abliteration.ai is an OpenAI-compatible preset, and its key stays on the server", async (t) => {
  const h = await startHarness(t);
  const presets = await h.api("GET", "/api/provider-presets");
  const ablit = presets.find((p: any) => p.id === "abliteration");
  assert.deepEqual([ablit.kind, ablit.baseUrl, ablit.keyRequired, ablit.beta], ["openai-compatible", "https://api.abliteration.ai/v1", true, false]);
  // Pointed at a closed local port, so nothing leaves the machine.
  const provider = await h.api("POST", "/api/providers", { preset: "abliteration", baseUrl: "http://127.0.0.1:9/v1", apiKey: "ablit-hemmelig-42" });
  assert.equal(provider.name, "abliteration.ai");
  assert.equal(provider.hasKey, true);
  const boot = await h.api("GET", "/api/bootstrap");
  assert.ok(!JSON.stringify(boot).includes("ablit-hemmelig-42"), "the key never comes back");
  await h.api("DELETE", `/api/providers/${provider.id}`);
  assert.ok(!(await h.api("GET", "/api/bootstrap")).providers.some((p: any) => p.id === provider.id), "Koble fra removes it");
});

test("shortcuts: the panel tabs can be rebound, and an empty string removes a shortcut", async (t) => {
  const h = await startHarness(t);
  const saved = await h.api("PATCH", "/api/settings", { shortcuts: { "panel.browser": "Mod+Shift+B", "view.panel": "Mod+Alt+4", "thread.new": "" } });
  assert.deepEqual(saved.shortcuts, { "panel.browser": "Mod+Shift+B", "view.panel": "Mod+Alt+4", "thread.new": "" });
  for (const id of ["panel.files", "panel.changes", "panel.terminal", "panel.team", "panel.overview"]) await h.api("PATCH", "/api/settings", { shortcuts: { [id]: "Mod+Alt+9" } });
  await assert.rejects(h.api("PATCH", "/api/settings", { shortcuts: { "panel.ukjent": "Mod+Alt+1" } }), /400/);
  await assert.rejects(h.api("PATCH", "/api/settings", { shortcuts: { "thread.new": " " } }), /400/);
});
