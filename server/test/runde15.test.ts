// Round 15 (SPEC 31): React artifacts. The preview server's React page and its stricter CSP, the
// runtime files it hands out and nothing else, artifacts in JSX and TSX in the room's API, the
// demo model's React and text replies, and Chat's short instruction about artifacts and text blocks.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Artifact } from "../../shared/protocol.ts";
import { downloadName, titleFromReact } from "../src/artifacts.ts";
import { PreviewServer } from "../src/preview.ts";
import { PreviewRuntime } from "../src/preview-runtime.ts";
import { REACT_APP, REACT_APP_TSX, REACT_APP_V2 } from "../src/providers/mock.ts";
import { rawRequest, startHarness, textOf } from "./helpers.ts";

function get(url: string, headers: Record<string, string> = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: target.port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

// A web build's runtime folder, with the files the real one has and some that must never be served.
function fakeRuntime(t: { after: (fn: () => void) => void }): string {
  const dist = realpathSync(mkdtempSync(path.join(tmpdir(), "ad-r15-dist-")));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  const dir = path.join(dist, "preview-runtime");
  mkdirSync(path.join(dir, "under"), { recursive: true });
  writeFileSync(path.join(dir, "boot.js"), "export const boot = 1;\n");
  writeFileSync(path.join(dir, "react.js"), "export default {};\n");
  writeFileSync(path.join(dir, "react-BbggMMhK.js"), "export const t = 1;\n");
  writeFileSync(path.join(dir, "notater.txt"), "ikke kode");
  writeFileSync(path.join(dir, "under", "inne.js"), "export const x = 1;\n");
  writeFileSync(path.join(dist, "hemmelig.js"), "export const secret = 1;\n");
  return dist;
}

const COMPONENT = 'import { useState } from "react";\nexport default function Teller() {\n  const [n, setN] = useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n';

test("a React artifact is saved with its kind, named after its component, and downloads as source text", async (t) => {
  const h = await startHarness(t);
  const artifact = await h.api<Artifact>("POST", "/api/artifacts", { html: COMPONENT, lang: "jsx" });
  assert.equal(artifact.lang, "jsx");
  assert.equal(artifact.title, "Teller");
  assert.equal((await h.api<Artifact>("POST", "/api/artifacts", { html: "export default function App() { return null }", lang: "tsx" })).title, "React-app");
  const listed = (await h.api<Artifact[]>("GET", "/api/artifacts")).find((a) => a.id === artifact.id)!;
  assert.equal(listed.lang, "jsx", "the list carries the kind");
  assert.equal((await h.api<Artifact>("POST", "/api/artifacts", {})).lang, "html", "a new one by hand is HTML, as before");
  await assert.rejects(h.api("POST", "/api/artifacts", { html: COMPONENT, lang: "vue" }), /400/);
  await assert.rejects(h.api("POST", "/api/artifacts", { lang: "jsx" }), /400/, "no blank React artifact");

  // A copy keeps the kind; an edit keeps it too.
  const copy = await h.api<Artifact>("POST", `/api/artifacts/${artifact.id}/duplicate`);
  assert.equal(copy.lang, "jsx");
  assert.equal((await h.api<Artifact>("PATCH", `/api/artifacts/${artifact.id}`, { html: `${COMPONENT}\n// endret\n` })).lang, "jsx");

  const download = await rawRequest(h.app.port, "GET", `/api/artifacts/${artifact.id}/download`, { headers: { cookie: h.cookie } });
  assert.equal(download.status, 200);
  assert.equal(download.headers["content-type"], "text/plain; charset=utf-8", "source to save, never a page");
  assert.match(String(download.headers["content-disposition"]), /^attachment; filename="Teller\.jsx"; filename\*=UTF-8''Teller\.jsx$/);
  assert.match(download.body, /export default function Teller/);
});

test("names: the component's name, and a file name with the right ending", () => {
  assert.equal(titleFromReact("export default function Spill() {}"), "Spill");
  assert.equal(titleFromReact("export default class Kalkulator extends Component {}"), "Kalkulator");
  assert.equal(titleFromReact("function Klokke() {}\nexport default Klokke;\n"), "Klokke");
  assert.equal(titleFromReact("export default function App() {}"), "React-app");
  assert.equal(titleFromReact("export default () => null"), "React-app");
  assert.equal(downloadName("Mitt spill"), "Mitt-spill.html");
  assert.equal(downloadName("Teller", "jsx"), "Teller.jsx");
  assert.equal(downloadName("app.tsx", "tsx"), "app.tsx", "not app.tsx.tsx");
  assert.equal(downloadName("../../etc", "tsx"), "etc.tsx");
});

test("the React page: the file as data, an import map, and a CSP that allows no network at all", async (t) => {
  const h = await startHarness(t, { webDist: fakeRuntime(t) });
  const { preview } = h.app;
  // Code that tries to close the script element it is carried in.
  const tricky = `${COMPONENT}// </script><script>alert(1)</script> <!--  \n`;
  const { url } = await h.api<{ url: string }>("POST", "/api/previews", { html: tricky, lang: "jsx" });
  assert.match(url, new RegExp(`^${preview.origin}/s/[\\w-]{43}$`));
  assert.notEqual((await h.api("POST", "/api/previews", { html: tricky, lang: "tsx" })).url, url, "the same code as TSX is another page");
  assert.notEqual((await h.api("POST", "/api/previews", { html: tricky })).url, url, "and as HTML another again");
  await assert.rejects(h.api("POST", "/api/previews", { html: tricky, lang: "svelte" }), /400/);

  const page = await get(url);
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(page.headers["access-control-allow-origin"], undefined);
  const csp = String(page.headers["content-security-policy"]);
  const nonce = /'nonce-([\w-]+)'/.exec(csp)?.[1];
  assert.ok(nonce, "a nonce for the import map");
  assert.match(csp, /^sandbox allow-scripts allow-modals allow-forms;/, "opaque origin; forms only so onSubmit fires");
  assert.ok(!csp.includes("allow-same-origin") && !csp.includes("allow-popups") && !csp.includes("allow-top-navigation"));
  for (const part of ["default-src 'none'", "connect-src 'none'", "img-src data: blob:", "font-src data:", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
    assert.ok(csp.includes(part), `CSP has ${part}`);
  }
  assert.ok(csp.includes(`script-src 'nonce-${nonce}' ${preview.origin}/_rt/ blob: 'unsafe-eval'`), "scripts only from the runtime and boot.js's own module");
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp));
  assert.match(csp, new RegExp(`frame-ancestors http://127\\.0\\.0\\.1:${h.app.port} http://localhost:${h.app.port}$`));

  assert.match(page.body, new RegExp(`<script type="importmap" nonce="${nonce}">`));
  const map = JSON.parse(/<script type="importmap"[^>]*>([^<]*)<\/script>/.exec(page.body)![1]);
  assert.deepEqual(map.imports, { react: "/_rt/react.js", "react-dom": "/_rt/react-dom.js", "react-dom/client": "/_rt/react-dom-client.js", "react/jsx-runtime": "/_rt/jsx-runtime.js" });
  assert.match(page.body, /<script type="module" src="\/_rt\/boot\.js"><\/script>/);
  // The code is in one JSON script element and cannot get out of it.
  const data = /<script type="application\/json" id="ad-kilde">([^<]*)<\/script>/.exec(page.body)?.[1];
  assert.ok(data, "the code is data, in one element");
  assert.equal(page.body.match(/<script/g)!.length, 3, "importmap, data and boot.js, nothing from the code");
  assert.deepEqual(JSON.parse(data!), { lang: "jsx", code: tricky });

  // A saved React artifact gets the same page from its signed URL.
  const saved = await h.api<Artifact>("POST", "/api/artifacts", { html: COMPONENT, lang: "tsx" });
  const savedPage = await get(saved.previewUrl);
  assert.match(String(savedPage.headers["content-security-policy"]), /connect-src 'none'/);
  assert.deepEqual(JSON.parse(/id="ad-kilde">([^<]*)</.exec(savedPage.body)![1]), { lang: "tsx", code: COMPONENT });
  // HTML artifacts are as before.
  const html = await get((await h.api<{ url: string }>("POST", "/api/previews", { html: "<!doctype html><p>hei</p>" })).url);
  assert.equal(html.body, "<!doctype html><p>hei</p>");
  assert.match(String(html.headers["content-security-policy"]), /^sandbox allow-scripts allow-modals; frame-ancestors /);
});

test("the runtime: only the built files in its one folder, readable from the opaque origin", async (t) => {
  const h = await startHarness(t, { webDist: fakeRuntime(t) });
  const { origin } = h.app.preview;
  const boot = await get(`${origin}/_rt/boot.js`);
  assert.equal(boot.status, 200);
  assert.equal(boot.body, "export const boot = 1;\n");
  assert.equal(boot.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(boot.headers["access-control-allow-origin"], "*", "module scripts from an opaque origin are fetched with CORS");
  assert.equal(boot.headers["x-content-type-options"], "nosniff");
  assert.equal(boot.headers["set-cookie"], undefined);
  assert.equal((await get(`${origin}/_rt/react-BbggMMhK.js`)).status, 200, "a chunk");
  const etag = String(boot.headers.etag);
  assert.equal((await get(`${origin}/_rt/boot.js`, { "if-none-match": etag })).status, 304);
  assert.equal((await get(`${origin}/_rt/boot.js`, {}, "HEAD")).status, 200);
  assert.equal((await get(`${origin}/_rt/boot.js`, {}, "POST")).status, 405);
  assert.equal((await get(`${origin}/_rt/boot.js`, { host: "evil.example" })).status, 403);

  for (const target of [
    "/_rt/", "/_rt/notater.txt", "/_rt/under/inne.js", "/_rt/under%2finne.js", "/_rt/../hemmelig.js", "/_rt/%2e%2e/hemmelig.js",
    "/_rt/..%2fhemmelig.js", "/_rt/finnes-ikke.js", "/_rt/.js", "/_rt//etc/passwd", "/_rt/boot.js/", "/hemmelig.js", "/preview-runtime/boot.js",
  ]) {
    const res = await get(`${origin}${target}`);
    assert.equal(res.status, 404, `${target} gave ${res.status}`);
    assert.equal(res.body, "Ikke funnet");
  }
});

test("without a built runtime the React page says so, with no script at all", async (t) => {
  const runtime = new PreviewRuntime(path.join(tmpdir(), "ad-finnes-ikke-15", "preview-runtime"));
  assert.equal(runtime.available, false);
  assert.equal(runtime.file("boot.js"), undefined);
  const preview = new PreviewServer({ appOrigins: () => ["http://127.0.0.1:1"], artifactSource: () => undefined, runtime });
  await preview.listen();
  t.after(() => preview.close());
  const page = await get(preview.snapshot(COMPONENT, "jsx"));
  assert.equal(page.status, 200);
  assert.match(page.body, /React-forhåndsvisningen er ikke bygget/);
  assert.doesNotMatch(page.body, /<script/);
  assert.equal((await get(`${preview.origin}/_rt/boot.js`)).status, 404);
});

test("the demo model writes a React app, a second version with the same file name, TSX and a text block", async (t) => {
  const h = await startHarness(t);
  const ask = async (text: string) => {
    const thread = await h.thread(null, "chat");
    await h.api("POST", `/api/threads/${thread.id}/messages`, { text });
    return textOf(await h.finished(thread.id));
  };
  const block = (reply: string, lang: string) => new RegExp("```" + lang + " ([\\w.-]+)\\n([\\s\\S]*?)```").exec(reply);

  const first = block(await ask("lag en react-artifact"), "jsx");
  assert.ok(first, "a jsx block with a file name");
  assert.equal(first![1], "oppgaver.jsx");
  assert.equal(first![2], REACT_APP);
  const second = block(await ask("lag en ny versjon av react-appen"), "jsx");
  assert.equal(second![1], "oppgaver.jsx", "the same name, so it is a new version");
  assert.equal(second![2], REACT_APP_V2);
  assert.notEqual(REACT_APP, REACT_APP_V2);
  const typed = block(await ask("react tsx"), "tsx");
  assert.equal(typed![1], "oppgaver.tsx");
  assert.equal(typed![2], REACT_APP_TSX);
  for (const code of [REACT_APP, REACT_APP_V2, REACT_APP_TSX]) {
    assert.match(code, /^export default function Oppgaver\(\)/m);
    const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(imports)], ["react"], "only react");
    assert.doesNotMatch(code, /fetch\(|https?:\/\//, "no network");
  }
  assert.match(REACT_APP_TSX, /type Oppgave = /);

  assert.match(await ask("tekstblokk"), /```text\nHei Kari,[\s\S]*?\n```/);

  // With artifacts off in a chat, no React app either.
  const off = await h.thread(null, "chat");
  await h.api("PATCH", `/api/threads/${off.id}`, { chatTools: { web: false, fetch: false, artifacts: false, memory: true } });
  await h.api("POST", `/api/threads/${off.id}/messages`, { text: "lag en react-artifact" });
  const refused = textOf(await h.finished(off.id));
  assert.match(refused, /Artifacts er slått av/);
  assert.doesNotMatch(refused, /```jsx/);
});

test("Chat's system prompt says, briefly, how to write artifacts and text blocks", async (t) => {
  const h = await startHarness(t);
  const preview = await h.api<{ layers: Array<{ id: string; text: string }> }>("GET", "/api/harness/preview?mode=chat");
  const base = preview.layers.find((l) => l.id === "chat-base")!.text;
  const artifacts = base.split("\n").find((line) => line.startsWith("Artifacts:"))!;
  assert.match(artifacts, /```html/);
  assert.match(artifacts, /```jsx \/ ```tsx/);
  assert.match(artifacts, /only react and react-dom/);
  assert.match(artifacts, /file name after the language/);
  assert.ok(artifacts.length < 520, `short: ${artifacts.length} characters`);
  assert.match(base, /^Put text the user will copy as it is, such as a message, a letter or a prompt, in a ```text block\.$/m);
  // Kode's prompt is not touched by this.
  const project = await h.project();
  const code = await h.api<{ layers: Array<{ text: string }> }>("GET", `/api/harness/preview?mode=code&projectId=${project.id}`);
  assert.doesNotMatch(code.layers.map((l) => l.text).join("\n"), /```text block/);
});
