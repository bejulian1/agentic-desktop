import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Thread } from "../../shared/protocol.ts";
import { flow, openProject, pane, send, threadItem, toolShown, waitFor, type Harness } from "./harness.ts";

const stored = async (h: Harness, id: string): Promise<Thread> => (await h.api("GET", "/api/bootstrap")).threads.find((t: Thread) => t.id === id);
const focused = (h: Harness) => h.page.locator(".pane-inner.focused").getAttribute("data-thread-id");

async function namedThread(h: Harness, mode: "chat" | "code", title: string): Promise<Thread> {
  const thread = await h.api<Thread>("POST", "/api/threads", { mode, projectId: null });
  await h.api("PATCH", `/api/threads/${thread.id}`, { title });
  return { ...thread, title };
}

async function finished(h: Harness, id: string, turns: number): Promise<void> {
  await waitFor(async () => (await h.events(id)).filter((e) => e.event.type === "run.finished").length === turns && !(await stored(h, id)).running, `tur ${turns} ferdig`);
  await waitFor(async () => (await pane(h.page, id).getByTestId("now-line").count()) === 0, "nå-linjen er borte");
}

flow("Direkte festing i Chat og Kode uten prosjekt bevarer aktiv tråd, plassering og valg etter omlasting", async (h) => {
  const { page } = h;
  for (const mode of ["chat", "code"] as const) {
    const target = await namedThread(h, mode, `Fest meg ${mode}`);
    const active = await namedThread(h, mode, `Aktiv ${mode}`);
    await page.locator(".sidebar .mode-button", { hasText: mode === "chat" ? "Chat" : "Kode" }).click();
    await threadItem(page, active.id).click();
    await pane(page, active.id).waitFor();
    const row = threadItem(page, target.id);
    assert.equal(await row.count(), 1);
    await row.hover();
    await row.getByRole("button", { name: "Fest tråden", exact: true }).click();
    await waitFor(async () => (await stored(h, target.id)).pinned === true, "festing lagret");
    await page.locator(`.pinned-projects [data-thread-item="${target.id}"]`).waitFor();
    assert.equal(await row.count(), 1, "festet tråd vises bare én gang");
    assert.equal(await row.getByRole("button", { name: "Løsne tråden", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await focused(h), active.id, "pin-knappen åpner ikke en annen tråd");
    assert.equal((await stored(h, active.id)).pinned, false);
    await h.reload();
    await page.locator(`.pinned-projects [data-thread-item="${target.id}"]`).waitFor();
    assert.equal(await focused(h), active.id);
    const unpin = row.getByRole("button", { name: "Løsne tråden", exact: true });
    await unpin.focus();
    await unpin.press("Space");
    await waitFor(async () => (await stored(h, target.id)).pinned === false, "løsning lagret fra tastaturet");
    await waitFor(async () => (await row.locator(".thread-pin").evaluate((button) => document.activeElement === button)), "tastaturfokus følger knappen etter flytting");
    assert.equal(await focused(h), active.id);
    assert.equal(await row.count(), 1);
    assert.equal(await page.locator(`.pinned-projects [data-thread-item="${target.id}"]`).count(), 0);
    await h.reload();
    await row.waitFor();
    await row.hover();
    assert.equal(await row.getByRole("button", { name: "Fest tråden", exact: true }).getAttribute("aria-pressed"), "false");
    assert.equal(await row.count(), 1);
  }
});

flow("Mislykket festing beholder lagret tilstand og kan prøves på nytt direkte på tråden", async (h) => {
  const { page } = h;
  const target = await namedThread(h, "chat", "Prøv festing igjen");
  const active = await namedThread(h, "chat", "Behold aktiv");
  await threadItem(page, active.id).click();
  await pane(page, active.id).waitFor();
  h.allow(/status of 503/);
  let fails = true;
  await page.route(`**/api/threads/${target.id}`, (route) => {
    const request = route.request();
    if (fails && request.method() === "PATCH" && typeof request.postDataJSON()?.pinned === "boolean") {
      return route.fulfill({ status: 503, json: { error: "Festing kunne ikke lagres nå" } });
    }
    return route.continue();
  });
  const row = threadItem(page, target.id);
  await row.hover();
  await row.getByRole("button", { name: "Fest tråden", exact: true }).click();
  await page.locator(".toast.error", { hasText: "Festing kunne ikke lagres nå" }).waitFor();
  assert.equal((await stored(h, target.id)).pinned, false);
  assert.equal(await row.getByRole("button", { name: "Fest tråden", exact: true }).getAttribute("aria-pressed"), "false");
  assert.equal(await row.getByRole("button", { name: "Fest tråden", exact: true }).isDisabled(), false);
  assert.equal(await focused(h), active.id);
  fails = false;
  await row.getByRole("button", { name: "Fest tråden", exact: true }).click();
  await waitFor(async () => (await stored(h, target.id)).pinned === true, "nytt forsøk lagret");
  await page.locator(`.pinned-projects [data-thread-item="${target.id}"]`).waitFor();
  assert.equal(await row.count(), 1);
  assert.equal(await focused(h), active.id);
});

flow("Kode viser ingen endringskort for hilsen, lesing eller en kommando som ikke endrer filer", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  await send(page, "hvem er du?");
  await page.locator(".row-text", { hasText: "kodeagenten" }).first().waitFor();
  const id = (await focused(h))!;
  await finished(h, id, 1);
  assert.equal(await page.getByTestId("changes-card").count(), 0);
  assert.equal(await page.getByTestId("turn-summary").count(), 0);
  await h.api("PATCH", `/api/threads/${id}`, { planMode: true });
  await send(page, "undersøk prosjektmappen");
  await finished(h, id, 2);
  assert.ok((await h.events(id)).some((e) => e.event.type === "tool.started" && e.event.tool === "list_dir"), "den andre turen bruker bare mappevisning");
  assert.equal(await page.getByTestId("changes-card").count(), 0, "lesing lager ingen filkort");
  assert.equal(await page.getByTestId("turn-summary").count(), 0);
  await h.api("PATCH", `/api/threads/${id}`, { planMode: false });
  await send(page, "!printf 'bare-kommando\\n'");
  await page.locator('.row-tool[data-tool="run_command"][data-status="done"]').waitFor();
  await finished(h, id, 3);
  assert.equal(await page.getByTestId("changes-card").count(), 0, "kommando uten filendringer lager ingen kort");
  assert.equal(await page.getByTestId("turn-summary").count(), 0);
  const events = await h.events(id);
  assert.ok(events.some((e) => e.event.type === "tool.started" && e.event.tool === "run_command"), "skallkommandoen ble faktisk kjørt");
  assert.ok(events.every((e) => e.event.type !== "turn.changes" || e.event.files.length === 0), "ingen av turene endret filer");
  await h.reload();
  assert.equal(await page.getByTestId("changes-card").count(), 0);
  assert.equal(await page.getByTestId("turn-summary").count(), 0);
});

flow("Ekte filendring beholder ett kort med diff og Angre, mens senere tekstsvar ikke lager ekstra kort", async (h) => {
  const { page } = h;
  const project = await openProject(h);
  await h.api("PATCH", `/api/projects/${project.id}`, { permissionMode: "full" });
  const file = path.join(h.projectDir, "index.html");
  const original = "<!doctype html><title>Originalen</title><p>Bevar denne teksten</p>\n";
  writeFileSync(file, original);
  await send(page, "lag en side");
  const card = page.getByTestId("changes-card");
  await card.waitFor();
  const id = (await focused(h))!;
  await finished(h, id, 1);
  assert.equal(await card.count(), 1);
  await card.getByText("Endret 1 fil", { exact: true }).waitFor();
  assert.equal(await card.locator(".changes-file").count(), 1);
  await card.locator(".changes-name", { hasText: "index.html" }).waitFor();
  assert.match((await card.locator(".changes-totals").innerText()).replace(/\s+/g, " "), /\+\d+ −\d+/);
  const summary = page.getByTestId("turn-summary");
  assert.equal(await summary.count(), 1);
  assert.match(await summary.innerText(), /1 fil endret/);
  assert.notEqual(readFileSync(file, "utf8"), original);
  await send(page, "hvem er du?");
  await finished(h, id, 2);
  assert.equal(await card.count(), 1, "rent tekstsvar legger ikke til et tomt kort");
  assert.equal(await summary.count(), 1);
  await card.getByRole("button", { name: "Vis endringer", exact: true }).click();
  await toolShown(page, "Diff");
  const diff = page.locator('[data-testid="diff-file"][data-path="index.html"]');
  await diff.waitFor();
  assert.match(await diff.innerText(), /Originalen|Hei fra demo-modellen/);
  await card.getByRole("button", { name: "Angre", exact: true }).click();
  await card.getByText("Angret", { exact: true }).waitFor();
  assert.equal(readFileSync(file, "utf8"), original, "Angre gjenoppretter innholdet før turen");
  assert.equal(await card.getByRole("button", { name: "Angre", exact: true }).count(), 0);
});
