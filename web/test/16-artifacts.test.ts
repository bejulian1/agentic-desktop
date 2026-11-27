// SPEC 14: the Artifacts room, pinned projects, and that artifact HTML in the preview cannot reach
// the app. Since round 15 (SPEC 31.1) an html block in an answer is an artifact box that opens the
// artifact panel, where the preview runs; the old card under the block is gone.
import assert from "node:assert/strict";
import type { Frame, Page } from "playwright-core";
import { flow, send, waitFor, type Harness, toolShown } from "./harness.ts";

// Notes, from before the answer starts, whether an iframe ever appeared while a code block was
// still streaming, and whether the block was shown as the box being written.
const WATCH_FRAMES = () => {
  const w = window as any;
  w.__frames = { seenLive: false, seenWriting: false, addedWhileLive: 0, added: 0 };
  new MutationObserver(() => {
    const live = document.querySelector(".md-live .md-code, .md-live .artifact-box") !== null;
    if (document.querySelector(".md-live .artifact-box.writing")) w.__frames.seenWriting = true;
    if (live) w.__frames.seenLive = true;
    const count = document.querySelectorAll("iframe").length;
    if (count > (w.__frames.lastCount ?? 0)) {
      w.__frames.added += count - (w.__frames.lastCount ?? 0);
      if (live) w.__frames.addedWhileLive += 1;
    }
    w.__frames.lastCount = count;
  }).observe(document.body, { childList: true, subtree: true });
};

async function previewFrame(page: Page, origin: string, scope: string): Promise<Frame> {
  let found: Frame | undefined;
  await waitFor(async () => {
    const handle = await page.locator(`${scope} iframe`).last().elementHandle().catch(() => null);
    found = (await handle?.contentFrame()) ?? undefined;
    return Boolean(found && found.url().startsWith(origin));
  }, `forhåndsvisningen i ${scope}`);
  await found!.waitForLoadState();
  return found!;
}

const threads = async (h: Harness) => (await h.api("GET", "/api/bootstrap")).threads.length;

flow("html i chatten gir en artifact-boks som åpner forhåndsvisningen, lagres, og redigeres i Artifacts-rommet", async (h) => {
  const { page } = h;
  await page.evaluate(WATCH_FRAMES);
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "lag et html-spill");

  // While it streams: the box being written, no iframe. Then the box, and the panel opens by itself.
  const box = page.locator(".artifact-box:not(.writing)");
  await box.waitFor();
  const panel = page.getByTestId("artifact-panel");
  await panel.locator("iframe").waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
  const watched = await page.evaluate(() => (window as any).__frames);
  assert.equal(watched.seenLive, true, "blokken ble sett mens den strømmet");
  assert.equal(watched.seenWriting, true, "som en boks som skrives");
  assert.equal(watched.addedWhileLive, 0, "ingen iframe mens blokken strømmet");
  assert.equal(await box.count(), 1);
  assert.equal(await box.locator(".artifact-box-title").textContent(), "Fang prikken");
  assert.equal(await box.locator(".artifact-box-meta").textContent(), "HTML · 46 linjer");
  assert.equal(await page.locator(".row-text .md-code").count(), 0, "koden står ikke i samtalen");
  assert.equal(await page.locator(".row-text iframe").count(), 0, "ingen iframe i samtalen");
  assert.equal(await box.evaluate((el) => el.classList.contains("active")), true, "boksen som vises er merket");

  const iframe = panel.locator("iframe");
  assert.equal(await iframe.getAttribute("sandbox"), "allow-scripts allow-modals", "uten allow-same-origin");
  const src = new URL((await iframe.getAttribute("src"))!);
  assert.equal(src.hostname, "localhost", "appen er 127.0.0.1, forhåndsvisningen localhost");
  assert.notEqual(src.port, String(h.server.port), "en annen port, altså en annen origin");
  const previewOrigin = src.origin;

  // The program runs.
  const frame = await previewFrame(page, previewOrigin, ".artifact-panel");
  await frame.locator("canvas#spill").waitFor();
  assert.equal(await frame.locator("#poeng").textContent(), "0");

  // From inside the preview: no cookie, no API, no WebSocket, no parent.
  const before = { threads: await threads(h), artifacts: (await h.api("GET", "/api/artifacts")).length };
  assert.deepEqual(h.errors, [], "ingen feil før forsøkene");
  // What the attempts below print in the preview's console. The app sends Cross-Origin-Resource-Policy:
  // same-origin, so even no-cors requests are blocked there.
  h.allow(/CORS policy|net::ERR_FAILED|ERR_BLOCKED_BY_RESPONSE\.NotSameOrigin|status of 40[13]|WebSocket connection to .* failed/);
  const attempts = await frame.evaluate(async (app) => {
    const out: Record<string, string> = {};
    const attempt = async (name: string, run: () => Promise<unknown>) => {
      try {
        const value = await run();
        out[name] = value instanceof Response ? `svar ${value.type} ${value.status}` : `ok ${String(value)}`;
      } catch (err) {
        out[name] = `feil ${(err as Error).name}`;
      }
    };
    out.origin = String(self.origin);
    await attempt("cookie", async () => document.cookie);
    await attempt("parent", async () => (window.parent as Window).document.title);
    await attempt("bootstrap", () => fetch(`${app}/api/bootstrap`, { credentials: "include" }));
    await attempt("bootstrap-no-cors", () => fetch(`${app}/api/bootstrap`, { credentials: "include", mode: "no-cors" }));
    await attempt("ny-tråd", () => fetch(`${app}/api/threads`, { method: "POST", credentials: "include", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ mode: "chat" }) }));
    await attempt("ny-artifact", () => fetch(`${app}/api/artifacts`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: "x" }) }));
    await attempt("ws-ticket", () => fetch(`${app}/api/ws-ticket`, { method: "POST", credentials: "include", mode: "no-cors" }));
    await attempt("websocket", () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`${app.replace("http", "ws")}/ws?ticket=gjett`);
      ws.onopen = () => resolve("åpen");
      ws.onerror = () => reject(Object.assign(new Error("stengt"), { name: "WebSocketError" }));
    }));
    return out;
  }, h.origin);
  assert.equal(attempts.origin, "null", "opak origin");
  assert.equal(attempts.cookie, "feil SecurityError");
  assert.equal(attempts.parent, "feil SecurityError");
  assert.equal(attempts.bootstrap, "feil TypeError", "CORS stopper svaret");
  assert.equal(attempts["ny-artifact"], "feil TypeError", "preflight uten CORS");
  assert.equal(attempts.websocket, "feil WebSocketError");
  // Chrome may send this one, but the answer is opaque or blocked; the server refuses Origin null.
  assert.match(attempts["ny-tråd"], /^(svar opaque 0|feil TypeError)$/);
  assert.deepEqual({ threads: await threads(h), artifacts: (await h.api("GET", "/api/artifacts")).length }, before, "ingenting ble endret");

  // Save it from the panel: the box says so, and the button now opens it in the room.
  await panel.getByRole("button", { name: "Lagre som artifact" }).click();
  await box.locator(".artifact-box-saved:not([hidden])").waitFor();
  await panel.getByRole("button", { name: "Åpne i Artifacts" }).waitFor();
  assert.match(await panel.locator(".artifact-panel-meta").textContent() ?? "", /Lagret/);
  const [saved] = await h.api("GET", "/api/artifacts");
  const thread = (await h.api("GET", "/api/bootstrap")).threads[0];
  assert.equal(saved.threadId, thread.id);
  assert.ok(saved.messageId && saved.sourceKey);
  await page.locator(".artifacts-row .nav-count", { hasText: "1" }).waitFor();

  // The room: gallery, then the artifact with code and preview.
  await page.locator(".artifacts-row").click();
  const tile = page.locator(`.artifact-tile[data-artifact="${saved.id}"]`);
  await tile.getByText("Fang prikken").waitFor();
  await tile.getByText(`Fra tråden «${thread.title}»`).waitFor();
  assert.equal(await page.locator(".pane-inner").isVisible(), false, "rutene er skjult bak rommet");
  await page.getByLabel("Søk i artifacts").fill("finnes ikke");
  await page.getByText("Ingen treff").waitFor();
  await page.getByLabel("Søk i artifacts").fill("prikk");
  await tile.click();

  const view = page.locator(`[data-artifact-open="${saved.id}"]`);
  await view.locator(".cm-content .tok-typeName, .cm-content .tok-keyword, .cm-content .tok-tagName").first().waitFor();
  const roomFrame = await previewFrame(page, previewOrigin, ".artifact-preview");
  await roomFrame.locator("canvas#spill").waitFor();
  assert.equal(await view.locator(".artifact-preview iframe").getAttribute("sandbox"), "allow-scripts allow-modals");

  // Edit, save with Ctrl+S, and the preview shows the new version.
  await view.locator(".cm-content").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText('<!doctype html>\n<title>Endret</title>\n<h1 id="x">Endret spill</h1>\n<script>document.getElementById("x").dataset.kjort = "ja"</script>\n');
  await view.getByText("Ikke lagret").waitFor();
  await page.keyboard.press("Control+S");
  await view.locator(".artifact-save-state[data-state='saved']").waitFor();
  const edited = await previewFrame(page, previewOrigin, ".artifact-preview");
  await edited.locator('h1#x[data-kjort="ja"]').waitFor();
  const stored = await h.api("GET", `/api/artifacts/${saved.id}`);
  assert.match(stored.html, /Endret spill/);
  assert.match(stored.previousHtml, /Fang prikken/, "forrige versjon er tatt vare på");

  // Undo in the editor, then Kjør på nytt makes a fresh iframe.
  await page.keyboard.press("Control+Z");
  await view.getByText("Ikke lagret").waitFor();
  await page.keyboard.press("Control+Shift+Z");
  await view.locator(".artifact-save-state[data-state='saved']").waitFor();
  const oldFrame = await view.locator(".artifact-preview iframe").elementHandle();
  await view.getByRole("button", { name: "Kjør på nytt" }).click();
  await waitFor(async () => (await oldFrame!.evaluate((el) => el.isConnected)) === false, "ny iframe");
  await (await previewFrame(page, previewOrigin, ".artifact-preview")).locator("h1#x").waitFor();

  // Code only, preview only, both.
  await view.getByRole("button", { name: "Kode", exact: true }).click();
  assert.equal(await view.locator(".artifact-preview").isVisible(), false);
  await view.getByRole("button", { name: "Forhåndsvisning", exact: true }).click();
  assert.equal(await view.locator(".artifact-code").isVisible(), false);
  await view.getByRole("button", { name: "Delt", exact: true }).click();
  assert.ok(await view.locator(".artifact-code").isVisible() && await view.locator(".artifact-preview").isVisible());

  // Back to the thread: the box says it is saved, and the panel is back where it was.
  await page.locator(".thread-item", { hasText: thread.title }).locator(".thread-text").click();
  await box.locator(".artifact-box-saved:not([hidden])").waitFor();
  await panel.getByRole("button", { name: "Åpne i Artifacts" }).waitFor();
  // Another thread closes it: it belongs to its thread.
  await page.keyboard.press("Control+Alt+n");
  await panel.waitFor({ state: "detached" });
});

flow("Artifacts-rommet: ny, gi nytt navn, dupliser, last ned, slett, Nettleser-panelet og festede prosjekter", async (h) => {
  const { page } = h;

  // Pin a project from its menu: its own section, and not shown twice.
  await h.createProject("Demo");
  await h.api("POST", "/api/projects", { name: "Annet", path: `${h.projectDir}/annet` });
  await page.locator(".sidebar .mode-button", { hasText: "Kode" }).click(); // Kode projects are listed in Kode (round 9)
  const group = page.locator('.group[data-project="Demo"]');
  await group.waitFor();
  assert.equal(await page.locator(".section-label", { hasText: "Festet" }).count(), 0, "skjult når ingenting er festet");
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  await page.getByRole("menuitem", { name: "Fest prosjektet" }).click();
  await page.locator(".section-label", { hasText: "Festet" }).waitFor();
  await page.locator('.pinned-projects .group[data-project="Demo"]').waitFor();
  assert.equal(await page.locator('.group[data-project="Demo"]').count(), 1, "ikke vist to ganger");
  const order = await page.locator(".sidebar .artifacts-row, .sidebar .section-label").evaluateAll((els) => els.map((el) => el.textContent?.trim()));
  // Festet right under the navigation, then Chatter in Kode (round 9, SPEC 21.2; round 11, SPEC 24.4).
  assert.deepEqual(order.slice(0, 3), ["Artifacts0", "Festet", "Chatter"]);
  assert.equal((await h.api("GET", "/api/bootstrap")).projects.find((p: any) => p.name === "Demo").pinned, true);

  // A new artifact by hand.
  await page.locator(".artifacts-row").click();
  await page.getByText("Ingen artifacts ennå").waitFor();
  await page.getByRole("button", { name: "Ny artifact" }).first().click();
  const view = page.locator("[data-artifact-open]");
  await view.locator("h1", { hasText: "Ny artifact" }).waitFor();
  const id = await view.getAttribute("data-artifact-open");

  await view.getByRole("button", { name: "Gi nytt navn" }).click();
  await page.getByRole("dialog", { name: "Gi nytt navn" }).getByRole("textbox").fill("Min side");
  // The dialog lies over the preview, which is a cross-origin frame. Headless Chrome now and then
  // routes a mouse click meant for the dialog into a frame that has just loaded (the click never
  // reaches the page), so the dialogs are answered with the keyboard here.
  await page.getByRole("dialog", { name: "Gi nytt navn" }).getByRole("button", { name: "Lagre" }).press("Enter");
  await view.locator("h1", { hasText: "Min side" }).waitFor();

  // Download goes through the API with the cookie, as an attachment.
  const href = await view.getByRole("link", { name: "Last ned .html" }).getAttribute("href");
  assert.equal(href, `/api/artifacts/${id}/download`);
  const download = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, disposition: res.headers.get("content-disposition"), text: await res.text() };
  }, href!);
  assert.equal(download.status, 200);
  assert.match(download.disposition!, /^attachment; filename="Min-side\.html"/);
  assert.match(download.text, /<!doctype html>/);

  await view.getByRole("button", { name: "Dupliser" }).click();
  await page.locator("[data-artifact-open] h1", { hasText: "Kopi av Min side" }).waitFor();
  const copyId = await page.locator("[data-artifact-open]").getAttribute("data-artifact-open");
  assert.notEqual(copyId, id);

  await page.locator("[data-artifact-open]").getByRole("button", { name: "Slett" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Slett" }).press("Enter");
  await page.locator(".artifacts-heading").waitFor();
  await page.locator(".artifact-tile", { hasText: "Min side" }).waitFor();
  assert.equal(await page.locator(".artifact-tile").count(), 1);
  assert.deepEqual((await h.api("GET", "/api/artifacts")).map((a: any) => a.id), [id]);

  // Open in the Browser panel: Kode mode, the Browser tab, and the preview URL in its address bar.
  await page.locator(".artifact-tile", { hasText: "Min side" }).click();
  await page.getByRole("button", { name: "Åpne i Nettleser-panelet" }).click();
  await toolShown(page, "Nettleser");
  const address = page.getByLabel("Adresse");
  await waitFor(async () => /^http:\/\/localhost:\d+\/a\//.test(await address.inputValue()), "adressen er forhåndsvisningen", 30_000);
  assert.equal(await page.locator(".artifacts-room").count(), 0, "rommet er lukket");

  // Unpin.
  await group.locator(".group-head").hover();
  await group.getByRole("button", { name: "Valg for prosjektet" }).click();
  await page.getByRole("menuitem", { name: "Løsne prosjektet" }).click();
  await waitFor(async () => (await page.locator(".section-label", { hasText: "Festet" }).count()) === 0, "seksjonen er borte");

  // With «Åpne nye artifacts med en gang» off, a new box waits for a click.
  await h.api("PATCH", "/api/settings", { artifactPreview: false });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await send(page, "artifact");
  const box = page.locator(".artifact-box:not(.writing)");
  await box.waitFor();
  await waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId("artifact-panel").count(), 0, "panelet venter på et klikk");
  await box.getByRole("button").click();
  const panel = page.getByTestId("artifact-panel");
  await panel.locator("iframe").waitFor();

  // Lagre som artifact, then Åpne i Artifacts opens it in the room.
  await panel.getByRole("button", { name: "Lagre som artifact" }).click();
  await panel.getByRole("button", { name: "Åpne i Artifacts" }).click();
  await page.locator("[data-artifact-open] h1", { hasText: "Fang prikken" }).waitFor();
  assert.equal((await h.api("GET", "/api/artifacts")).length, 2);
});
