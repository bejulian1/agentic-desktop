// Fills a data dir with one thread of 5 000 messages with Markdown and code, for `npm run perf`.
// Needs AD_DATA_DIR, so it can never touch the user's own data.
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { Store } from "../server/src/db.ts";

const dataDir = process.env.AD_DATA_DIR;
if (!dataDir) {
  console.error("Sett AD_DATA_DIR til en midlertidig mappe.");
  process.exit(1);
}
mkdirSync(dataDir, { recursive: true });
const count = Number(process.argv[2] ?? 5000);
const store = new Store(realpathSync(dataDir));

function reply(n: number): string {
  return [
    `## Svar ${n}`,
    `Dette er melding **${n}** med \`kode\`, en [lenke](https://example.com) og en liste:`,
    "- første punkt\n- andre punkt",
    "```ts",
    `export function steg${n}(verdi: number): number {`,
    `  return verdi * ${n};`,
    "}",
    "```",
  ].join("\n\n");
}

const thread = store.createThread(null, "chat", null, { title: `Ytelsestest med ${count} meldinger` });
store.transaction(() => {
  for (let n = 0; n < count; n += 2) {
    const runId = randomUUID();
    const messageId = randomUUID();
    store.appendEvent(thread.id, { type: "user.message", messageId: randomUUID(), text: `Spørsmål ${n}` });
    store.appendMessage(thread.id, { role: "user", content: [{ type: "text", text: `Spørsmål ${n}` }] });
    store.appendEvent(thread.id, { type: "run.started", runId, modelId: "mock-demo" });
    const text = reply(n + 1);
    store.appendEvent(thread.id, { type: "text.delta", runId, messageId, text });
    store.appendMessage(thread.id, { role: "assistant", content: [{ type: "text", text }] });
    store.appendEvent(thread.id, { type: "run.finished", runId, status: "done" });
  }
});
store.close();
console.log(thread.id);
