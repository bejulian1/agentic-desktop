import assert from "node:assert/strict";
import { test } from "node:test";
import type { ServerMessage } from "../../shared/protocol.ts";
import { startHarness, type TestSocket } from "./helpers.ts";

type Opened = Extract<ServerMessage, { type: "terminal.opened" }>;

const output = (socket: TestSocket, terminalId: string) =>
  socket.received.flatMap((m) => (m.type === "terminal.output" && m.terminalId === terminalId ? [m.data] : [])).join("");

const saw = (socket: TestSocket, terminalId: string, text: string) =>
  socket.waitFor((m) => m.type === "terminal.output" && m.terminalId === terminalId && output(socket, terminalId).includes(text));

test("a real PTY in the project folder, with replay after the page reloads", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const first = await h.socket();
  first.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const opened = await first.waitFor<Opened>((m) => m.type === "terminal.opened");
  assert.equal(opened.projectId, project.id);
  assert.equal(opened.replay, "");

  first.send({ type: "terminal.input", terminalId: opened.terminalId, data: "pwd; tty; echo KJORT-$((40+2))\n" });
  await saw(first, opened.terminalId, "KJORT-42");
  const text = output(first, opened.terminalId);
  assert.ok(text.includes(project.path));
  assert.match(text, /\/dev\/pts\//);

  // The page goes away. The terminal does not.
  first.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/terminals`), [{ terminalId: opened.terminalId, title: "Terminal", exited: false }]);

  const second = await h.socket();
  second.send({ type: "terminal.open", projectId: project.id, terminalId: opened.terminalId, cols: 100, rows: 30 });
  const again = await second.waitFor<Opened>((m) => m.type === "terminal.opened");
  assert.equal(again.terminalId, opened.terminalId);
  assert.ok(again.replay.includes("KJORT-42"));

  second.send({ type: "terminal.input", terminalId: opened.terminalId, data: "stty size; echo VIDERE-$((1+1))\n" });
  await saw(second, opened.terminalId, "VIDERE-2");
  assert.ok(output(second, opened.terminalId).includes("30 100"), "resize on attach reached the PTY");
});

test("several tabs, and two windows on one terminal", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const [one, two] = await Promise.all([h.socket(), h.socket()]);
  one.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const tab = await one.waitFor<Opened>((m) => m.type === "terminal.opened");
  one.received.length = 0;
  one.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const other = await one.waitFor<Opened>((m) => m.type === "terminal.opened");
  assert.notEqual(other.terminalId, tab.terminalId);

  two.send({ type: "terminal.open", projectId: project.id, terminalId: tab.terminalId, cols: 80, rows: 24 });
  await two.waitFor((m) => m.type === "terminal.opened");
  one.send({ type: "terminal.input", terminalId: tab.terminalId, data: "echo BEGGE-$((3*3))\n" });
  await Promise.all([saw(one, tab.terminalId, "BEGGE-9"), saw(two, tab.terminalId, "BEGGE-9")]);
  assert.ok(!output(one, other.terminalId).includes("BEGGE-9"), "tabs do not bleed");
});

test("exit is reported, close kills the shell, and resize works", async (t) => {
  const h = await startHarness(t);
  const project = await h.project();
  const socket = await h.socket();
  socket.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const { terminalId } = await socket.waitFor<Opened>((m) => m.type === "terminal.opened");
  socket.send({ type: "terminal.resize", terminalId, cols: 123, rows: 45 });
  socket.send({ type: "terminal.input", terminalId, data: "stty size; exit 3\n" });
  const exit = await socket.waitFor((m) => m.type === "terminal.exit") as { code: number };
  assert.equal(exit.code, 3);
  assert.ok(output(socket, terminalId).includes("45 123"));
  socket.send({ type: "terminal.close", terminalId });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(await h.api("GET", `/api/projects/${project.id}/terminals`), []);

  socket.received.length = 0;
  socket.send({ type: "terminal.open", projectId: project.id, cols: 80, rows: 24 });
  const running = await socket.waitFor<Opened>((m) => m.type === "terminal.opened");
  socket.send({ type: "terminal.input", terminalId: running.terminalId, data: "echo $$ > /dev/null; echo KLAR-$((2+2))\n" });
  await saw(socket, running.terminalId, "KLAR-4");
  socket.send({ type: "terminal.close", terminalId: running.terminalId });
  await socket.waitFor((m) => m.type === "terminal.exit");
});

test("bad messages get an error and do not take the socket down", async (t) => {
  const h = await startHarness(t);
  const socket = await h.socket();
  socket.ws.send("ikke json");
  await socket.waitFor((m) => m.type === "error");
  socket.received.length = 0;
  socket.send({ type: "terminal.open", projectId: "finnes-ikke", cols: 80, rows: 24 });
  await socket.waitFor((m) => m.type === "error");
  socket.received.length = 0;
  socket.send({ type: "ukjent" });
  await socket.waitFor((m) => m.type === "error");
  socket.received.length = 0;
  socket.send({ type: "thread.subscribe", threadId: "finnes-ikke", afterSeq: 0 });
  await socket.waitFor((m) => m.type === "error");
  assert.equal(socket.ws.readyState, socket.ws.OPEN);
});

test("a late subscriber gets the backlog, then live events, without gaps", async (t) => {
  const h = await startHarness(t);
  const thread = await h.thread(null, "chat");
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Første" });
  await h.finished(thread.id);
  const total = (await h.events(thread.id)).length;

  const socket = await h.socket();
  socket.send({ type: "thread.subscribe", threadId: thread.id, afterSeq: 2 });
  await socket.waitFor((m) => m.type === "thread.event" && m.envelope.seq === total);
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Andre" });
  await h.finished(thread.id, 2);
  const end = (await h.events(thread.id)).length;
  await socket.waitFor((m) => m.type === "thread.event" && m.envelope.seq === end);
  const seqs = socket.received.flatMap((m) => (m.type === "thread.event" ? [m.envelope.seq] : []));
  assert.deepEqual(seqs, Array.from({ length: end - 2 }, (_, i) => i + 3));

  socket.send({ type: "thread.unsubscribe", threadId: thread.id });
  socket.received.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 20));
  await h.api("POST", `/api/threads/${thread.id}/messages`, { text: "Tredje" });
  await h.finished(thread.id, 3);
  assert.equal(socket.received.filter((m) => m.type === "thread.event").length, 0);
});
