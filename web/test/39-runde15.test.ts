// Round 15 (SPEC 31): the artifact box and panel for whole one-file apps in HTML and React, the
// React preview built into the app (no network, no CDN), its calm messages, that a React artifact
// cannot reach the app's origin, its API or its parent, and the «Tekst» mark on text blocks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Frame, Page } from "playwright-core";
import { REACT_APP, REACT_APP_V2 } from "../../server/src/providers/mock.ts";
import { flow, openProject, openTool, send, toolShown, waitFor, type Harness } from "./harness.ts";

const idle = (page: Page) => waitFor(async () => (await page.locator(".pane-dot.running").count()) === 0, "svaret er ferdig");

async function frameIn(page: Page, scope: string): Promise<Frame> {
  let found: Frame | undefined;
  await waitFor(async () => {
    const handle = await page.locator(`${scope} iframe`).last().elementHandle().catch(() => null);
    found = (await handle?.contentFrame()) ?? undefined;
    return Boolean(found && /^http:\/\/localhost:\d+\//.test(found.url()));
  }, `forhåndsvisningen i ${scope}`);
  await found!.waitForLoadState();
  return found!;
}

// What a preview page says in its message box, if anything: kind and text.
async function message(frame: Frame): Promise<{ kind: string | null; text: string }> {
  let out = { kind: null as string | null, text: "" };
  await waitFor(async () => {
    out = await frame.evaluate(() => ({
      kind: document.documentElement.dataset.adMelding ?? null,
      text: document.querySelector("ad-forhandsvisning")?.shadowRoot?.textContent ?? "",
    }));
    return out.kind !== null;
  }, "en melding i forhåndsvisningen");
  return out;
}

// A React artifact straight from the API, opened in the Artifacts room, for code the demo model
// never writes.
async function roomPreview(h: Harness, code: string, lang: "jsx" | "tsx" = "jsx"): Promise<Frame> {
  const artifact = await h.api("POST", "/api/artifacts", { html: code, lang });
  await h.page.locator(".artifacts-row").click();
  await h.page.locator(`.artifact-tile[data-artifact="${artifact.id}"]`).click();
  await h.page.locator(`[data-artifact-open="${artifact.id}"]`).waitFor();
  return frameIn(h.page, `[data-artifact-open="${artifact.id}"] .artifact-preview`);
}

flow("en React-app i Chat: boksen, panelet med forhåndsvisning og kode, versjoner, lagring og Åpne stort", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "lag en react-artifact");

  // While it is written: the box with the lines counting, and no click.
  const writing = page.locator(".md-live .artifact-box.writing");
  await writing.waitFor();
  assert.match(await writing.locator(".artifact-box-meta").textContent() ?? "", /^Skriver React · \d+ linje/);
  assert.equal(await writing.getByRole("button").isDisabled(), true);
  await idle(page);

  const first = page.locator(".artifact-box:not(.writing)").first();
  assert.equal(await first.locator(".artifact-box-title").textContent(), "Oppgaver");
  assert.equal(await first.locator(".artifact-box-meta").textContent(), `React · ${REACT_APP.trimEnd().split("\n").length} linjer`);
  assert.equal(await first.getAttribute("data-lang"), "jsx");
  assert.equal(await first.getAttribute("title"), "oppgaver.jsx");
  assert.equal(await page.locator(".row-text .md-code").count(), 0, "koden står i panelet, ikke i samtalen");

  // It opened by itself, on Forhåndsvisning, and React runs there, from the app's own copy.
  const panel = page.getByTestId("artifact-panel");
  await panel.waitFor();
  assert.equal(await panel.getByRole("tab", { name: "Forhåndsvisning" }).getAttribute("aria-selected"), "true");
  assert.equal(await panel.locator("iframe").getAttribute("sandbox"), "allow-scripts allow-modals allow-forms");
  const frame = await frameIn(page, ".artifact-panel");
  await frame.locator("#igjen").getByText("2 igjen av 3").waitFor();
  await frame.getByLabel("Ny oppgave").fill("Skrive rapport");
  await frame.getByRole("button", { name: "Legg til" }).click();
  await frame.locator("#igjen").getByText("3 igjen av 4").waitFor();
  await frame.getByText("Gå en tur").click();
  await frame.locator("#igjen").getByText("2 igjen av 4").waitFor();
  assert.equal(await first.evaluate((el) => el.classList.contains("active")), true);
  assert.equal(await first.getByRole("button").getAttribute("aria-expanded"), "true");

  // Kode: the whole file, numbered and highlighted. Kopier and Last ned give exactly that.
  await panel.getByRole("tab", { name: "Kode" }).click();
  const source = panel.getByTestId("artifact-source");
  await source.locator(".tok-keyword").first().waitFor();
  // The block's text, as Markdown gives it: without the last line break.
  assert.equal(await source.locator("code").textContent(), REACT_APP.trimEnd());
  assert.equal((await source.locator(".artifact-gutter").textContent())!.split("\n").length, REACT_APP.trimEnd().split("\n").length);
  await panel.getByRole("button", { name: "Kopier koden" }).click();
  await panel.getByRole("button", { name: "Kopiert" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), REACT_APP.trimEnd());
  // A file on disk ends with a line break.
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Last ned" }).click()]);
  assert.equal(download.suggestedFilename(), "oppgaver.jsx");
  assert.equal(readFileSync((await download.path())!, "utf8"), REACT_APP);
  // Arrow keys move between the tabs.
  await panel.getByRole("tab", { name: "Kode" }).press("ArrowLeft");
  assert.equal(await panel.getByRole("tab", { name: "Forhåndsvisning" }).getAttribute("aria-selected"), "true");
  await frameIn(page, ".artifact-panel");

  // Last inn på nytt starts the app again: what was added is gone.
  const before = await panel.locator("iframe").elementHandle();
  await panel.getByRole("button", { name: "Last inn på nytt" }).click();
  await waitFor(async () => (await before!.evaluate((el) => el.isConnected)) === false, "en ny iframe");
  await (await frameIn(page, ".artifact-panel")).locator("#igjen").getByText("2 igjen av 3").waitFor();

  // A new version in the thread: the panel follows it, and the boxes say which is which.
  await send(page, "lag en ny versjon av react-appen");
  await idle(page);
  const boxes = page.locator(".artifact-box:not(.writing)");
  await waitFor(async () => (await boxes.count()) === 2, "to bokser");
  await panel.getByText("Versjon 2 av 2").waitFor();
  await waitFor(async () => (await boxes.nth(0).locator(".artifact-box-version").textContent()) === "v1", "v1 på den første");
  assert.equal(await boxes.nth(1).locator(".artifact-box-version").textContent(), "v2");
  assert.equal(await boxes.nth(1).evaluate((el) => el.classList.contains("active")), true);
  await (await frameIn(page, ".artifact-panel")).getByRole("button", { name: "Ferdige" }).click();
  await panel.getByRole("button", { name: "Forrige versjon" }).click();
  await panel.getByText("Versjon 1 av 2").waitFor();
  assert.equal(await panel.getByRole("button", { name: "Forrige versjon" }).isDisabled(), true);
  await waitFor(async () => await boxes.nth(0).evaluate((el) => el.classList.contains("active")), "v1 er merket");
  await panel.getByRole("tab", { name: "Kode" }).click();
  assert.equal(await panel.getByTestId("artifact-source").locator("code").textContent(), REACT_APP.trimEnd());
  await panel.getByRole("button", { name: "Neste versjon" }).click();
  assert.equal(await panel.getByTestId("artifact-source").locator("code").textContent(), REACT_APP_V2.trimEnd());

  // Lagre som artifact: into the room as React, with its name and where it came from.
  await panel.getByRole("button", { name: "Lagre som artifact" }).click();
  await panel.getByRole("button", { name: "Åpne i Artifacts" }).waitFor();
  await boxes.nth(1).locator(".artifact-box-saved:not([hidden])").waitFor();
  assert.equal(await boxes.nth(0).locator(".artifact-box-saved").isHidden(), true, "bare versjonen som ble lagret");
  const [saved] = await h.api("GET", "/api/artifacts");
  assert.equal(saved.lang, "jsx");
  assert.equal(saved.title, "Oppgaver");
  assert.ok(saved.threadId && saved.messageId && saved.sourceKey);
  assert.equal((await h.api("GET", `/api/artifacts/${saved.id}`)).html, REACT_APP_V2.trimEnd());

  // Åpne stort: over the conversation, and back.
  await panel.getByRole("button", { name: "Åpne stort" }).click();
  await page.locator(".app.artifact-big").waitFor();
  assert.equal(await page.locator("main.main").isVisible(), false);
  await panel.getByRole("button", { name: "Vanlig størrelse" }).click();
  assert.equal(await page.locator("main.main").isVisible(), true);

  // Esc closes, and the focus goes back to the box that opened it.
  await boxes.nth(0).getByRole("button").click();
  await panel.getByText("Versjon 1 av 2").waitFor();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.closest(".artifact-box") !== null), true);
  assert.equal(await page.locator(".artifact-box.active").count(), 0);

  // In the room it is React too: JSX in the editor, and the app runs.
  await boxes.nth(1).getByRole("button").click();
  await panel.getByRole("button", { name: "Åpne i Artifacts" }).click();
  const view = page.locator(`[data-artifact-open="${saved.id}"]`);
  await view.locator(".cm-content .tok-keyword").first().waitFor();
  await (await frameIn(page, `[data-artifact-open="${saved.id}"] .artifact-preview`)).getByRole("button", { name: "Ferdige" }).waitFor();
  assert.equal(await view.getByRole("link", { name: "Last ned .jsx" }).count(), 1);
});

flow("React i TSX og feilene: ukjent pakke, fil utenfor, syntaks, ingen komponent og kjøretidsfeil vises rolig", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();

  // TSX through the demo model: types are dropped, the app runs.
  await send(page, "lag en react-app i tsx");
  await idle(page);
  const box = page.locator(".artifact-box:not(.writing)");
  assert.equal(await box.getAttribute("data-lang"), "tsx");
  assert.equal(await box.locator(".artifact-box-meta").textContent().then((t) => t?.startsWith("React · ")), true);
  await (await frameIn(page, ".artifact-panel")).locator("#igjen").getByText("2 igjen av 3").waitFor();
  await page.getByTestId("artifact-panel").getByRole("button", { name: "Lukk artifacten" }).click();

  // The calm messages, each in its own frame, with no white page.
  h.allow(/Feil i appen|Uncaught|TypeError: Cannot read properties of null|^sidefeil: au$/);
  const cases: Array<[string, string, RegExp]> = [
    ['import { LineChart } from "recharts";\nexport default function Graf() { return <LineChart />; }\n', "import", /Pakken «recharts» finnes ikke her.*bare react og react-dom/],
    ['import Knapp from "./Knapp";\nexport default function Side() { return <Knapp />; }\n', "import", /Appen må være én fil.*«\.\/Knapp»/],
    ['import { renderToString } from "react-dom/server";\nexport default function S() { return null; }\n', "import", /Pakken «react-dom» finnes ikke her.*ikke «react-dom\/server»/],
    ["export default function Feil() {\n  return <div>\n    {1 +}\n  </div>;\n}\n", "syntax", /Koden kan ikke leses.*Linje 3/],
    ["function Ingen() { return <p>hei</p>; }\nconst x = 1;\n", "export", /Fant ingen komponent å vise.*default export/],
    ["export default function Krasj() {\n  const data = null;\n  return <p>{data.navn}</p>;\n}\n", "runtime", /Appen stoppet med en feil.*Linje 3.*Cannot read properties of null/],
  ];
  for (const [code, kind, text] of cases) {
    const frame = await roomPreview(h, code);
    const shown = await message(frame);
    assert.equal(shown.kind, kind, code);
    assert.match(shown.text.replace(/\s+/g, " "), text);
    assert.equal(await frame.locator("#root").innerHTML(), "", "ingenting halvveis");
  }

  // An error in a click handler does not take the app down: a bar that can be closed.
  const frame = await roomPreview(h, 'export default function K() {\n  return <button onClick={() => { throw new Error("au"); }}>Trykk</button>;\n}\n');
  await frame.getByRole("button", { name: "Trykk" }).click();
  const bar = await message(frame);
  assert.equal(bar.kind, "bar");
  assert.match(bar.text, /Feil i appen.*au/);
  assert.equal(await frame.getByRole("button", { name: "Trykk" }).isVisible(), true, "appen står");
  await frame.locator("ad-forhandsvisning").getByRole("button", { name: "Lukk meldingen" }).click();
  await waitFor(async () => (await frame.evaluate(() => document.documentElement.dataset.adMelding ?? null)) === null, "meldingen er borte");

  // A file that renders itself with createRoot is left to do that.
  const self = await roomPreview(h, 'import { createRoot } from "react-dom/client";\nfunction Selv() { return <p id="selv">Selv</p>; }\ncreateRoot(document.getElementById("root")).render(<Selv />);\n');
  await self.locator("#selv").waitFor();
  assert.equal(await self.evaluate(() => document.documentElement.dataset.adMelding ?? null), null);
});

flow("sikkerhet: en React-artifact når ikke appens origin, API-et, parent eller nettet", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "lag en react-artifact");
  await idle(page);
  const frame = await frameIn(page, ".artifact-panel");
  await frame.locator("#igjen").waitFor();
  const panelSrc = new URL((await page.getByTestId("artifact-panel").locator("iframe").getAttribute("src"))!);
  assert.equal(panelSrc.hostname, "localhost");
  assert.notEqual(panelSrc.port, String(h.server.port));

  const before = { threads: (await h.api("GET", "/api/bootstrap")).threads.length, artifacts: (await h.api("GET", "/api/artifacts")).length };
  assert.deepEqual(h.errors, [], "ingen feil før forsøkene");
  // What the attempts print in the preview's console: CSP refusals and blocked requests.
  h.allow(/Content Security Policy|violates the following|CORS policy|net::ERR_|ERR_BLOCKED_BY|status of 40[13]|WebSocket connection to .* failed|Refused to|'allow-popups' permission is not set/);
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
    out.react = typeof (window as any).React;
    await attempt("cookie", async () => document.cookie);
    await attempt("storage", async () => localStorage.length);
    await attempt("parent", async () => (window.parent as Window).document.title);
    await attempt("top", async () => window.top!.location.href);
    await attempt("parent-api", async () => (window.parent as any).fetch);
    await attempt("bootstrap", () => fetch(`${app}/api/bootstrap`, { credentials: "include" }));
    await attempt("ny-tråd", () => fetch(`${app}/api/threads`, { method: "POST", credentials: "include", mode: "no-cors", headers: { "content-type": "text/plain" }, body: JSON.stringify({ mode: "chat" }) }));
    await attempt("nettet", () => fetch("https://example.com/"));
    await attempt("xhr", () => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => reject(Object.assign(new Error("xhr"), { name: "NetworkError" }));
      try {
        xhr.open("GET", `${app}/api/bootstrap`);
        xhr.send();
      } catch (err) {
        reject(err);
      }
    }));
    await attempt("websocket", () => new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(`${app.replace("http", "ws")}/ws?ticket=gjett`);
        ws.onopen = () => resolve("åpen");
        ws.onerror = () => reject(Object.assign(new Error("stengt"), { name: "WebSocketError" }));
      } catch (err) {
        reject(err);
      }
    }));
    await attempt("bilde", () => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve("lastet");
      img.onerror = () => reject(Object.assign(new Error("bilde"), { name: "Blokkert" }));
      img.src = `${app}/favicon.svg`;
    }));
    await attempt("skript", () => import(/* @vite-ignore */ `${app}/assets/x.js`));
    await attempt("vindu", async () => window.open(app) === null ? "null" : "åpnet");
    return out;
  }, h.origin);
  assert.equal(attempts.origin, "null", "opak origin");
  assert.equal(attempts.react, "undefined", "React er ikke global");
  assert.equal(attempts.cookie, "feil SecurityError");
  assert.equal(attempts.storage, "feil SecurityError");
  assert.equal(attempts.parent, "feil SecurityError");
  assert.equal(attempts.top, "feil SecurityError");
  assert.equal(attempts["parent-api"], "feil SecurityError");
  assert.equal(attempts.bootstrap, "feil TypeError", "CSP: connect-src 'none'");
  assert.equal(attempts["ny-tråd"], "feil TypeError");
  assert.equal(attempts.nettet, "feil TypeError", "ikke noe nett");
  assert.match(attempts.xhr, /^feil (NetworkError|SecurityError)$/);
  assert.match(attempts.websocket, /^feil (WebSocketError|SecurityError)$/);
  assert.equal(attempts.bilde, "feil Blokkert");
  assert.equal(attempts.skript, "feil TypeError");
  assert.equal(attempts.vindu, "ok null", "ingen popup");
  await frame.locator("#igjen").waitFor();

  // Last, a form sent to the API. The frame's CSP stops it (form-action 'none'), and the app's own
  // CSP would not let the app's origin into the frame either (frame-src). Nothing reaches the server.
  await frame.evaluate((app) => {
    const form = document.createElement("form");
    form.action = `${app}/api/threads`;
    form.method = "post";
    document.body.appendChild(form);
    form.submit();
  }, h.origin);
  await page.waitForTimeout(400);
  const violations = await page.evaluate(() => (window as any).__csp.splice(0) as string[]);
  for (const violation of violations) assert.equal(violation, `frame-src ${h.origin}/api/threads`, "bare appens egen frame-src slo inn");
  assert.notEqual(new URL(frame.url()).origin, h.origin, "appen kom aldri inn i rammen");
  assert.deepEqual({ threads: (await h.api("GET", "/api/bootstrap")).threads.length, artifacts: (await h.api("GET", "/api/artifacts")).length }, before, "ingenting ble endret");
  assert.equal(new URL(page.url()).port, String(h.server.port), "appen står der den sto");
  await page.locator(".artifact-box:not(.writing)").waitFor();
});

flow("et smalt vindu: panelet er en egen rute over samtalen, og ✕ går tilbake", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "lag en react-artifact");
  await idle(page);
  const panel = page.getByTestId("artifact-panel");
  await panel.waitFor();
  await page.setViewportSize({ width: 720, height: 800 });
  await waitFor(async () => !(await page.locator("main.main").isVisible()), "samtalen er skjult bak panelet");
  const box = await panel.boundingBox();
  assert.ok(box && box.width >= 700, `panelet tar hele bredden (${box?.width})`);
  assert.equal(await panel.getByRole("button", { name: "Åpne stort" }).isVisible(), false, "Åpne stort trengs ikke her");
  // The actions keep their icons; their names are in the tooltip and for screen readers.
  assert.equal(await panel.getByRole("button", { name: "Lagre som artifact" }).isVisible(), true);
  await (await frameIn(page, ".artifact-panel")).locator("#igjen").waitFor();
  await panel.getByRole("button", { name: "Lukk artifacten" }).click();
  await panel.waitFor({ state: "detached" });
  await page.locator("main.main").waitFor();
  // Narrow, it never opens by itself: a new one waits for a click.
  await send(page, "lag en ny versjon av react-appen");
  await idle(page);
  // The answer may still be drawn a frame or two after the run ends.
  await waitFor(async () => (await page.locator(".artifact-box:not(.writing)").count()) === 2, "to bokser");
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 0);
  await page.locator(".artifact-box:not(.writing)").last().getByRole("button").click();
  await panel.getByText("Versjon 2 av 2").waitFor();
}, { viewport: { width: 1360, height: 860 } });

flow("i Kode åpner boksen panelet i stedet for verktøyene, og et verktøy tar plassen tilbake", async (h) => {
  const { page } = h;
  await openProject(h);
  await send(page, "html-spill");
  await idle(page);
  const panel = page.getByTestId("artifact-panel");
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 0, "åpner seg ikke av seg selv i Kode");
  await page.locator(".artifact-box:not(.writing)").getByRole("button").click();
  await panel.locator("iframe").waitFor();
  assert.equal(await page.locator(".right-panel").count(), 0, "verktøypanelet viker");
  // Vis eller skjul panelet brings the tools back, in place of the artifact.
  await page.keyboard.press("Control+Shift+B");
  await panel.waitFor({ state: "detached" });
  await page.locator(".right-panel").waitFor();
  // Open again, then ask for a tool: the tool wins.
  await page.locator(".artifact-box:not(.writing)").getByRole("button").click();
  await panel.waitFor();
  await page.locator(".right-panel").waitFor({ state: "detached" });
  await openTool(page, "Filer");
  await toolShown(page, "Filer");
  assert.equal(await panel.count(), 0);
  // Closing the artifact leaves the tool panel as it was.
  await page.locator(".artifact-box:not(.writing)").getByRole("button").click();
  await panel.getByRole("button", { name: "Lukk artifacten" }).click();
  await toolShown(page, "Filer");
});

flow("tekstblokker får merket Tekst og beholder Kopier; kodeblokker og kommandoer gjør det ikke", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Chat", exact: true, pressed: true }).waitFor();
  await send(page, "tekstblokk");
  await idle(page);
  const block = page.locator(".md-code[data-text]");
  await block.waitFor();
  assert.equal(await block.getAttribute("data-text"), "declared");
  assert.equal(await block.locator(".md-lang.md-lang-text").textContent(), "Tekst");
  assert.equal(await block.evaluate((el) => getComputedStyle(el.querySelector("pre")!).whiteSpace), "pre-wrap");
  await block.getByRole("button", { name: "Kopier" }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Hei Kari,\n\nTakk for møtet i går\./);
  assert.equal(await page.locator(".artifact-box").count(), 0);

  await send(page, "vis et eksempel");
  await idle(page);
  const code = page.locator(".md-code:not([data-text])").first();
  await code.waitFor();
  assert.equal(await code.locator(".md-lang-text").count(), 0);
  assert.equal(await code.locator(".md-lang").first().textContent(), "ts");

  await send(page, "kommandoblokk");
  await idle(page);
  assert.equal(await page.locator('.md-code[data-shell] .md-lang-text').count(), 0, "en kommando er ikke tekst");
});
