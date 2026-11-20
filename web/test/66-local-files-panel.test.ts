import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openTool, waitFor } from "./harness.ts";

flow("uten prosjekt: lokale filer, mapper og alle verktøy kan åpnes uten å opprette prosjekt", async (h) => {
  const { page } = h;
  writeFileSync(path.join(h.home, "les-meg.txt"), "En lokal fil uten prosjekt.\n");
  const other = path.join(h.projectDir, "manuelt valgt mappe");
  mkdirSync(other);
  writeFileSync(path.join(other, "valgt.txt"), "Valgt med mappevelgeren.\n");
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await openTool(page, "Filer");
  const files = page.getByTestId("files-panel");
  await files.getByLabel("Mappesti").waitFor();
  await waitFor(async () => await files.getByLabel("Mappesti").inputValue() === h.home, "starter i den isolerte hjemmemappen");
  await files.locator(".tree-item", { hasText: "les-meg.txt" }).click();
  await files.getByTestId("editor").getByText("En lokal fil uten prosjekt.", { exact: true }).waitFor();
  assert.equal(await files.getByRole("button", { name: "Rediger", exact: true }).count(), 0, "lokale filer åpnes i lesemodus");
  await page.route("**/api/fs/pick-folder", (route) => route.fulfill({ json: { path: other } }));
  await files.getByRole("button", { name: "Åpne mappe", exact: true }).click();
  await files.locator(".tree-item", { hasText: "valgt.txt" }).click();
  await files.getByTestId("editor").getByText("Valgt med mappevelgeren.", { exact: true }).waitFor();
  assert.equal(await files.getByLabel("Mappesti").inputValue(), other);
  await files.getByRole("button", { name: "Opp ett nivå" }).click();
  await waitFor(async () => await files.getByLabel("Mappesti").inputValue() === h.projectDir, "kan gå til overordnet mappe uten prosjekt");
  await files.getByRole("button", { name: "Hjem", exact: true }).click();
  await waitFor(async () => await files.getByLabel("Mappesti").inputValue() === h.home, "Hjem går tilbake");
  await openTool(page, "Oversikt");
  await page.getByTestId("local-overview").getByText(h.home, { exact: true }).waitFor();
  for (const name of ["Endringer", "Økt", "Team", "GitHub"]) {
    await openTool(page, name);
    assert.equal(await page.locator(".right-panel").getByRole("tab", { name, selected: true, exact: true }).count(), 1);
    if (name === "Team" || name === "GitHub") await page.getByTestId(`local-${name === "Team" ? "team" : "github"}`).waitFor();
    await waitFor(async () => (await page.locator(".panel-body").innerText()).trim().length > 0, `${name} har innhold uten prosjekt`);
  }
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.length, 0);
  await page.locator(".sidebar .mode-button", { hasText: "Chat" }).click();
  assert.equal(await page.locator(".right-panel").count(), 0, "Chat beholder sitt eget grensesnitt");
});

flow("lokale filer: sene fil-/mappesvar, feil og gjenåpning kan ikke vise tidligere innhold", async (h) => {
  const { page } = h;
  const a = path.join(h.home, "a.txt"), b = path.join(h.home, "b.txt");
  writeFileSync(a, "Dette er A.\n");writeFileSync(b, "Dette er B.\n");
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click();
  await openTool(page, "Filer");
  const files = page.getByTestId("files-panel"), preview = files.getByTestId("editor");
  await files.locator(".tree-item", { hasText: "a.txt" }).click();
  await preview.getByText("Dette er A.", { exact: true }).waitFor();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const url = `**/api/local/files/file?path=${encodeURIComponent(a)}`;
  await page.route(url, async (route) => { await pending; await route.fulfill({ json: { path:a, text:"For sent A.", size:11, binary:false, truncated:false } }); });
  try {
    const requested = page.waitForRequest((r) => r.url().includes("/api/local/files/file?") && new URL(r.url()).searchParams.get("path") === a);
    await files.locator(".tree-item", { hasText: "a.txt" }).click();
    await requested;
    assert.equal(await preview.isVisible(), false);
    await files.locator(".tree-item", { hasText: "b.txt" }).click();
    await preview.getByText("Dette er B.", { exact: true }).waitFor();
    const response = page.waitForResponse((r) => r.url().includes("/api/local/files/file?") && new URL(r.url()).searchParams.get("path") === a);
    release(); await response;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    assert.match(await preview.innerText(), /Dette er B\./);
    assert.equal(await preview.getByText("For sent A.").count(), 0);
  } finally { release(); }
  h.allow(/status of 403/);
  await page.route("**/api/local/files/tree?path=**", (route) => new URL(route.request().url()).searchParams.get("path") === "/avvist"
    ? route.fulfill({ status:403,json:{error:"Ingen tilgang til denne mappen"} }) : route.continue());
  await files.getByLabel("Mappesti").fill("/avvist");
  await files.getByLabel("Mappesti").press("Enter");
  await files.getByRole("alert").getByText("Ingen tilgang til denne mappen").waitFor();
  assert.equal(await files.getByLabel("Mappesti").inputValue(), h.home);
  await files.getByRole("button", { name: "Hjem", exact: true }).click();
  await files.getByRole("alert").waitFor({ state:"detached" });
  await files.locator(".tree-item", { hasText: "b.txt" }).click();
  await preview.getByText("Dette er B.", { exact: true }).waitFor();
  await openTool(page, "Oversikt"); await openTool(page, "Filer");
  await waitFor(async () => await files.getByLabel("Mappesti").inputValue() === h.home, "mappen beholdes ved gjenåpning");
  assert.equal(await preview.isVisible(), false, "gjenåpning viser ingen gammel fil");
});
