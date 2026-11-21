import assert from "node:assert/strict";
import { flow, send, threadItem } from "./harness.ts";

flow("Et minneforslag overlever omlasting, kan redigeres med tastatur og kan avvises", async (h) => {
  const { page } = h;
  await h.api("PUT", "/api/chat-personal", { memories: true, autoMemory: true });
  await h.api("POST", "/api/chat-personal/memories", { text: "Bruk npm" });
  await send(page, "Nei, bruk pnpm.");
  const card = page.getByRole("region", { name: "Minneforslag", exact: true });
  await card.getByText("Bruk npm", { exact: true }).waitFor();
  const thread = (await page.locator(".pane-inner.focused").getAttribute("data-thread-id"))!;
  await h.reload();
  await threadItem(page, thread).click();
  await card.getByRole("button", { name: "Rediger" }).press("Enter");
  await card.getByRole("textbox", { name: "Forslag" }).fill("Bruk pnpm som pakkebehandler");
  await card.getByRole("button", { name: "Godkjenn" }).press("Enter");
  await card.waitFor({ state: "detached" });
  assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories.map((item: any) => item.text), ["Bruk pnpm som pakkebehandler"]);
  await send(page, "Nei, bruk yarn.");
  await card.getByRole("button", { name: "Avvis" }).click();
  await card.waitFor({ state: "detached" });
  assert.deepEqual((await h.api("GET", "/api/chat-personal")).memories.map((item: any) => item.text), ["Bruk pnpm som pakkebehandler"]);
});
