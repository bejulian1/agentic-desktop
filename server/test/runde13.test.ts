// Round 13 (SPEC 27.1 and 27.2): every kind of step from the demo model, the tools of a chat per
// thread, and web search three ways: the provider's own (Anthropic and OpenAI-compatible, against
// local fake servers only), the app's headless browser on a local fake search page, and the demo
// sources. No real search engine, provider or site is ever reached.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { ThreadEvent } from "../../shared/protocol.ts";
import { demoSources, searchUrlFor } from "../src/agent/web.ts";
import { anthropicEvents, OPENAI_DONE, openaiChunk, openaiText, openaiUsage, sse, startFakeLlm } from "./fake-llm.ts";
import { ofType, startHarness, textOf, type Harness } from "./helpers.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// A local search page and two result pages, with an icon. Results link to this same server.
async function fakeSite(t: TestContext): Promise<{ url: string; searches: string[] }> {
  const searches: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (url.pathname === "/favicon.ico") return void res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    if (url.pathname === "/sok") {
      const q = url.searchParams.get("q") ?? "";
      searches.push(q);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(`<!doctype html><title>Søk: ${q}</title><body>
        <header><a href="/">Falsk søk</a></header>
        <div class="treff"><h3><a href="${base}/side/en">Første treff om ${q}</a></h3><p>En lokal side som bare finnes i testen, med noe tekst om ${q}.</p></div>
        <div class="treff"><h3><a href="/l/?uddg=${encodeURIComponent(`${base}/side/to`)}">Andre treff</a></h3><p>Lenket gjennom en omdirigering, slik mange søkesider gjør.</p></div>
      </body>`);
    }
    if (url.pathname.startsWith("/side/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(`<!doctype html><title>Lokal side ${url.pathname.slice(6)}</title><main><h1>Overskrift</h1><p>Innhold på den lokale siden.</p></main>`);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, searches };
}

async function chat(h: Harness, tools: Record<string, boolean>, modelId?: string) {
  const thread = await h.api("POST", "/api/threads", { projectId: null, mode: "chat", modelId, chatTools: {documents:false,...tools} });
  return thread as { id: string; chatTools: Record<string, boolean> };
}

async function say(h: Harness, threadId: string, text: string, runs = 1): Promise<ThreadEvent[]> {
  await h.api("POST", `/api/threads/${threadId}/messages`, { text });
  return h.finished(threadId, runs);
}

test("chat tools: defaults in Settings, a choice per thread, checked on the way in", async (t) => {
  const h = await startHarness(t);
  const plain = await h.thread(null, "chat");
  assert.equal(plain.chatTools, undefined, "a new chat follows the defaults");

  // Defaults: one switch at a time is enough.
  let settings = await h.api("PATCH", "/api/settings", { chatTools: { web: true } });
  assert.deepEqual(settings.chatTools, { web: true, fetch: false, artifacts: true, memory: true, documents: true, python: false });
  await assert.rejects(h.api("PATCH", "/api/settings", { chatTools: { kaffe: true } }), /400/);
  await assert.rejects(h.api("PATCH", "/api/settings", { chatTools: { web: "ja" } }), /400/);

  // The search page: http(s) and {q}, or empty to clear.
  await assert.rejects(h.api("PATCH", "/api/settings", { webSearchUrl: "https://sok.example/?q=" }), /\{q\}/);
  await assert.rejects(h.api("PATCH", "/api/settings", { webSearchUrl: "ftp://sok.example/{q}" }), /400/);
  settings = await h.api("PATCH", "/api/settings", { webSearchUrl: "https://sok.example/sok?q={q}" });
  assert.equal(settings.webSearchUrl, "https://sok.example/sok?q={q}");
  settings = await h.api("PATCH", "/api/settings", { webSearchUrl: "" });
  assert.equal(settings.webSearchUrl, undefined);
  assert.equal(searchUrlFor("https://s.example/?q={q}", "æ ø & å"), "https://s.example/?q=%C3%A6%20%C3%B8%20%26%20%C3%A5");

  // Per thread: given when the chat is made, changed one switch at a time, kept by a copy.
  const chosen = await chat(h, { web: false, memory: false });
  assert.deepEqual(chosen.chatTools, { web: false, fetch: false, artifacts: true, memory: false, documents: false, python: false });
  const changed = await h.api("PATCH", `/api/threads/${chosen.id}`, { chatTools: { fetch: true } });
  assert.deepEqual(changed.chatTools, { web: false, fetch: true, artifacts: true, memory: false, documents: false, python: false });
  const copy = await h.api("POST", `/api/threads/${chosen.id}/fork`, {});
  assert.deepEqual(copy.chatTools, changed.chatTools);
  assert.equal((await h.api("PATCH", `/api/threads/${chosen.id}`, { chatTools: null })).chatTools, undefined, "null follows the defaults again");

  // Kode has no chat tools.
  const project = await h.project();
  const code = await h.thread(project.id, "code");
  await assert.rejects(h.api("PATCH", `/api/threads/${code.id}`, { chatTools: { web: true } }), /Bare chatter/);

  // A model can say whether its provider searches.
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Med søk", model: "fake", contextWindow: 100_000, webSearch: true });
  assert.equal(model.webSearch, true);
  assert.equal((await h.api("PATCH", `/api/models/${model.id}`, { webSearch: false })).webSearch, false);
});

test("the demo model in Chat: demo sources with Nettsøk on, plain words when a tool is off", async (t) => {
  const h = await startHarness(t);
  const off = await chat(h, {});
  assert.deepEqual((await h.api("GET", `/api/threads/${off.id}/context`)).tools, 2, "ui_mod og spørrekort uten nettverktøy");
  let events = await say(h, off.id, "søk på nettet etter solsystemet");
  assert.equal(ofType(events, "tool.started").length, 0);
  assert.match(textOf(events), /Nettsøk er slått av i denne chatten/);

  const on = await chat(h, { web: true });
  assert.equal((await h.api("GET", `/api/threads/${on.id}/context`)).tools, 3);
  events = await say(h, on.id, "søk på nettet etter solsystemet");
  const [started] = ofType(events, "tool.started");
  assert.deepEqual([started.tool, started.summary], ["web_search", "solsystemet"]);
  const [finished] = ofType(events, "tool.finished");
  assert.equal(finished.status, "done");
  assert.equal(finished.sources?.length, 3);
  for (const source of finished.sources!) {
    assert.equal(source.demo, true);
    assert.match(source.title, /^Demo: /);
    assert.match(new URL(source.url).hostname, /\.invalid$/, "demo sources can never be real sites");
  }
  assert.deepEqual(finished.sources, demoSources("solsystemet"));
  assert.match(textOf(events), /Jeg fant 3 kilder/);
  assert.doesNotMatch(textOf(events), /\]\(https:\/\/demo-kilde/, "demo sources are not linked");

  // Artifacts off: the model is told, and the demo says so instead of writing a whole program.
  const noArtifacts = await chat(h, { artifacts: false });
  events = await say(h, noArtifacts.id, "lag et html-spill");
  assert.match(textOf(events), /Artifacts er slått av/);
  assert.doesNotMatch(textOf(events), /```html/);
});

test("Kode: «vis alle steg» goes through every kind of step, with a new file, a delete, an error and an approval", async (t) => {
  const h = await startHarness(t);
  const project = await h.project(undefined, { permissionMode: "full" });
  const thread = await h.thread(project.id, "code");
  const stop = h.approveAll(thread.id);
  t.after(stop);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "vis alle steg" });
  const events = await h.finished(thread.id);
  stop();
  const started = ofType(events, "tool.started");
  const finished = ofType(events, "tool.finished");
  const tools = new Set(started.map((e) => e.tool));
  for (const name of ["list_dir", "write_file", "read_file", "search", "web_search", "edit_file", "run_command", "delete_file", "thread_create", "thread_wait"]) {
    assert.ok(tools.has(name), `${name} er med`);
  }
  // New files say so in the summary and the result, so the step reads «Opprettet».
  const writes = started.filter((e) => e.tool === "write_file");
  assert.ok(writes.every((e) => / \(ny\)$/.test(e.summary)), writes.map((e) => e.summary).join(", "));
  const resultOf = (callId: string) => finished.find((f) => f.callId === callId)!;
  assert.match(resultOf(writes[0].callId).result!, /\(ny fil\)$/);
  // The delete keeps the old content in the turn, so Angre brings it back.
  const del = started.find((e) => e.tool === "delete_file")!;
  assert.match(resultOf(del.callId).result!, /demo\/LESMEG\.md \+0 -\d+ \(slettet\)/);
  assert.equal(existsSync(path.join(project.path, "demo/LESMEG.md")), false);
  // One step fails on purpose, and .env.demo asked first even with full access.
  assert.ok(finished.some((f) => f.status === "error"));
  assert.equal(ofType(events, "approval.requested").length, 1);
  assert.equal(ofType(events, "run.finished").at(-1)!.status, "done");
  const web = started.find((e) => e.tool === "web_search")!;
  assert.equal(resultOf(web.callId).sources?.every((s) => s.demo), true);
  const changes = ofType(events, "turn.changes").at(-1)!;
  assert.deepEqual(changes.files.map((f) => f.path).sort(), [".env.demo", "demo/app.js", "demo/stil.css"]);
  assert.match(textOf(events), /Ferdig med alle stegtypene/);
});

test("Anthropic's own web search: the server tool is offered, the sources come back, and the blocks are kept for the next turn", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "anthropic", name: "Fake Anthropic", baseUrl: llm.url, apiKey: "sk-ant-test" });
  const model = await h.api("POST", "/api/models", { providerId: provider.id, name: "Fake Claude", model: "fake-claude", contextWindow: 200_000, thinking: false });
  const thread = await chat(h, { web: true }, model.id);
  assert.equal((await h.api("GET", `/api/threads/${thread.id}/context`)).tools, 2, "ui_mod og spørrekort er uavhengige av leverandørens søk");

  const results = [
    { type: "web_search_result", url: "https://kilde.example/a", title: "Kilde A", encrypted_content: "kryptert-a", page_age: null },
    { type: "web_search_result", url: "https://kilde.example/b", title: "Kilde B", encrypted_content: "kryptert-b", page_age: null },
  ];
  llm.reply(sse(anthropicEvents([
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"query\": \"nordlys i dag\"}" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: results } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Ifølge kildene er det nordlys i kveld." } },
    { type: "content_block_stop", index: 2 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } },
    { type: "message_stop" },
  ]), 37));
  const events = await say(h, thread.id, "Er det nordlys i dag?");
  const tools = llm.requests[0].body.tools as Array<Record<string, unknown>>;
  assert.deepEqual(tools.filter((tool) => tool.type === "web_search_20250305").map((tool) => tool.name), ["web_search"]);
  assert.match(llm.requests[0].body.system[0].text, /Web search is on/);
  const [started] = ofType(events, "tool.started");
  assert.deepEqual([started.tool, started.summary, started.callId], ["web_search", "nordlys i dag", "srvtoolu_1"]);
  const [finished] = ofType(events, "tool.finished");
  assert.deepEqual(finished.sources, [{ title: "Kilde A", url: "https://kilde.example/a" }, { title: "Kilde B", url: "https://kilde.example/b" }]);
  assert.match(textOf(events), /nordlys i kveld/);

  // The next turn sends the search call and its results back as they came.
  llm.reply(sse(anthropicEvents([
    { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "Ja." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ])));
  await say(h, thread.id, "Takk!", 2);
  const assistant = (llm.requests[1].body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).find((m) => m.role === "assistant")!;
  assert.deepEqual(assistant.content.map((b) => b.type), ["server_tool_use", "web_search_tool_result", "text"]);
  assert.deepEqual(assistant.content[0].input, { query: "nordlys i dag" });
  assert.equal((assistant.content[1].content as Array<Record<string, unknown>>)[0].encrypted_content, "kryptert-a");
});

test("OpenAI-compatible web search: web_search_options when the model has it, sources from url_citation; nothing when it has not", async (t) => {
  const h = await startHarness(t);
  const llm = await startFakeLlm(t);
  const provider = await h.api("POST", "/api/providers", { kind: "openai-compatible", name: "Fake", baseUrl: `${llm.url}/v1`, apiKey: "sk-test" });
  const searching = await h.api("POST", "/api/models", { providerId: provider.id, name: "Med søk", model: "fake-search", contextWindow: 100_000, webSearch: true });
  const plain = await h.api("POST", "/api/models", { providerId: provider.id, name: "Uten søk", model: "fake", contextWindow: 100_000 });

  const cite = (url: string, title: string) => ({ type: "url_citation", url_citation: { url, title, start_index: 0, end_index: 4 } });
  llm.reply(sse(
    openaiChunk({ role: "assistant", content: "Svar med kilder." }) +
    openaiChunk({ annotations: [cite("https://kilde.example/1", "Første kilde"), cite("https://kilde.example/1", "Første kilde")] }) +
    openaiChunk({ annotations: [cite("https://kilde.example/2", "Andre kilde")] }) +
    openaiChunk({}, "stop") + openaiUsage(10, 5) + OPENAI_DONE,
  ));
  const withSearch = await chat(h, { web: true }, searching.id);
  const events = await say(h, withSearch.id, "Hva skjer i dag?");
  assert.deepEqual(llm.requests[0].body.web_search_options, {});
  assert.deepEqual(llm.requests[0].body.tools.map((t:any)=>t.function.name), ["ui_mod", "request_user_input"]);
  const [finished] = ofType(events, "tool.finished");
  assert.deepEqual(finished.sources?.map((s) => s.title), ["Første kilde", "Andre kilde"]);

  // A model without its own search, and no search page: no search at all, and the model is not told it has one.
  llm.reply(sse(openaiText("Uten nettsøk.")));
  const without = await chat(h, { web: true }, plain.id);
  await say(h, without.id, "Hva skjer i dag?");
  assert.equal(llm.requests[1].body.web_search_options, undefined);
  assert.deepEqual(llm.requests[1].body.tools.map((t:any)=>t.function.name), ["ui_mod", "request_user_input"]);
  assert.doesNotMatch(llm.requests[1].body.messages[0].content, /Web search is on/);
  assert.match(llm.requests[1].body.messages[0].content, /Chat cannot inspect or edit/);
});

test("the app's browser searches the search page from Settings and reads a page, against a local fake site", async (t) => {
  // The fake site is on 127.0.0.1, which web reading refuses: the test-only option lets loopback
  // through here. web-sikkerhet.test.ts shows the refusal with it off.
  const h = await startHarness(t, { webTesting: { allowLoopback: true } });
  const site = await fakeSite(t);
  await h.api("PATCH", "/api/settings", { webSearchUrl: `${site.url}/sok?q={q}` });

  // The demo model uses the search page once one is set.
  const thread = await chat(h, { web: true, fetch: true });
  let events = await say(h, thread.id, "søk på nettet etter nordlys");
  assert.deepEqual(site.searches, ["nordlys"]);
  const [search] = ofType(events, "tool.finished");
  assert.equal(search.status, "done", search.result ?? "");
  assert.deepEqual(search.sources?.map((s) => [s.title, new URL(s.url).pathname]), [["Første treff om nordlys", "/side/en"], ["Andre treff", "/side/to"]]);
  assert.match(search.sources![0].snippet ?? "", /lokal side/);
  assert.match(search.sources![0].favicon ?? "", /^data:image\/png;base64,/, "the icon is read by the app, not by the page");
  assert.equal(search.sources!.some((s) => s.demo), false);

  // Les nettsider: a pasted address is read as text.
  events = await say(h, thread.id, `Hva står det på ${site.url}/side/en ?`, 2);
  const read = ofType(events, "tool.finished").at(-1)!;
  const started = ofType(events, "tool.started").at(-1)!;
  assert.equal(started.tool, "web_fetch");
  assert.equal(read.status, "done", read.result ?? "");
  assert.match(read.result!, /Tittel: Lokal side en/);
  assert.match(read.result!, /Innhold på den lokale siden/);
  assert.equal(read.sources?.[0].title, "Lokal side en");
  assert.match(textOf(events), /Siden heter \*\*Lokal side en\*\*/);

  // The app's own address is never opened.
  const own = await chat(h, { fetch: true });
  events = await say(h, own.id, `les ${h.origin}/api/bootstrap`);
  assert.equal(ofType(events, "tool.finished").at(-1)!.status, "error");
});
