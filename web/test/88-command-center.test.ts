import assert from "node:assert/strict";
import type { PullWatchStatus, Thread } from "../../shared/protocol.ts";
import { flow, send, threadItem, waitFor } from "./harness.ts";

flow("Kommandoguiden: navngitt tråd, gjenåpning, søk og bekreftet nytt svar", async (h) => {
  const { page } = h;
  await send(page, "/new Søndagsplan");
  await page.getByText("Søndagsplan", { exact: true }).first().waitFor();
  const threads = () => h.api<{ threads: Thread[] }>("GET", "/api/bootstrap").then((data) => data.threads);
  const named = (await threads()).find((thread) => thread.title === "Søndagsplan");
  assert.ok(named);
  await threadItem(page, named.id).waitFor();
  await send(page, "/new Mandagsplan");
  await page.getByText("Mandagsplan", { exact: true }).first().waitFor();
  await send(page, "/resume Søndags");
  const palette = page.getByRole("dialog", { name: "Kommandopalett" });
  await palette.waitFor();
  assert.equal(await palette.getByLabel("Søk i paletten").inputValue(), "Søndags");
  await palette.getByRole("option", { name: /Søndagsplan/ }).click();
  await page.locator(`.pane-inner.focused[data-thread-id="${named.id}"]`).waitFor();
  await send(page, "/tools");
  await page.getByRole("menuitemcheckbox", { name: /Python-analyse/ }).waitFor();
  await page.keyboard.press("Escape");
  await send(page, "Den unike søketeksten");
  const events = () => h.events(named.id).then((entries) => entries.map((entry) => entry.event));
  await waitFor(async () => (await events()).some((event) => event.type === "run.finished"), "første svar ferdig");
  await send(page, "/find");
  await page.getByLabel("Søk i samtalen").waitFor();
  await page.getByRole("button", { name: "Lukk søket" }).click();
  const before = await events();
  await send(page, "/retry");
  const confirm = page.getByRole("dialog", { name: "Lag siste svar på nytt?" });
  await confirm.getByRole("button", { name: "Avbryt" }).click();
  assert.deepEqual(await events(), before);
  await send(page, "/retry");
  await confirm.getByRole("button", { name: "Lag svaret på nytt" }).click();
  const first = before.find((event) => event.type === "run.started");
  await waitFor(async () => (await events()).some((event) => event.type === "run.finished" && event.runId !== first?.runId), "erstatningssvaret er ferdig");
  const after = await events();
  assert.equal(after.filter((event) => event.type === "user.message").length, 1);
  assert.equal((await threads()).find((thread) => thread.id === named.id)?.title, "Søndagsplan");
});

flow("Babysit: GitHub-oppfølging varsler om endringer og avslutter etter fletting", async (h) => {
  const { page } = h;
  const title = '<img src=x onerror="alert(1)">';
  const pull: PullWatchStatus = {
    repo: "acme/rakett", number: 42, title, url: "https://github.com/acme/rakett/pull/42",
    state: "OPEN", draft: false, head: "a".repeat(40), checks: "PENDING", review: "REVIEW_REQUIRED",
  };
  const queries: string[] = [];
  await page.route("**/api/github/pull-watch?*", async (route) => {
    queries.push(new URL(route.request().url()).search);
    await route.fulfill({ json: pull });
  });
  await page.clock.install();
  const card = page.getByRole("dialog", { name: "Babysit" });
  const close = () => card.getByRole("button", { name: "Lukk", exact: true }).click();
  await send(page, `/babysit pr ${pull.url}`);
  await card.getByText(title, { exact: true }).waitFor();
  assert.equal(await card.locator("img").count(), 0);
  assert.equal(await card.getByRole("link", { name: "Åpne på GitHub" }).getAttribute("href"), pull.url);
  assert.equal(new URLSearchParams(queries[0]).get("repo"), "acme/rakett");
  await close();
  pull.checks = "SUCCESS";
  pull.review = "APPROVED";
  await page.clock.fastForward(60_001);
  await page.getByText(/acme\/rakett #42 · Åpen · CI: bestått · Gjennomgang: godkjent/).waitFor();
  await send(page, "/babysit status");
  await card.getByText("Bestått", { exact: true }).waitFor();
  await close();
  pull.state = "MERGED";
  await page.clock.fastForward(60_001);
  await page.getByText(/acme\/rakett #42 · Flettet/).waitFor();
  await send(page, "/babysit status");
  await card.getByText("Avsluttet", { exact: true }).waitFor();
  await close();
  await page.clock.fastForward(120_000);
  assert.equal(queries.length, 3);
  assert.deepEqual((await h.api("GET", "/api/bootstrap")).threads, []);
});
