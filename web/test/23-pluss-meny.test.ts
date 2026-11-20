// SPEC 17.2: the + menu in the message field. Four rows with icons, the arrow keys, a folder as @
// context, text files from the disk, and the shared limit of 20 attachments.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flow, openProject, send, waitFor } from "./harness.ts";

flow("+-menyen: skråstrekkommandoer, mappe, filer og bilder, med piltaster", async (h) => {
  const { page } = h;
  mkdirSync(path.join(h.projectDir, "dokumenter/utkast"), { recursive: true });
  writeFileSync(path.join(h.projectDir, "dokumenter/plan.md"), "# Plan\n");
  writeFileSync(path.join(h.projectDir, "dokumenter/utkast/a.md"), "a\n");
  const project = await openProject(h);
  const plus = page.locator(".composer-foot").getByRole("button", { name: "Legg ved" });

  // Four rows, each with an icon, and the keyboard moves between them.
  await plus.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Legg ved" });
  await menu.waitFor();
  const rows = menu.getByRole("menuitem");
  assert.deepEqual((await rows.allTextContents()).map((t) => t.replace(/[/@]$/, "").trim()), ["Skråstrekkommandoer", "Legg til mappe", "Legg til filer", "Bilder"]);
  for (let i = 0; i < 4; i++) assert.equal(await rows.nth(i).locator("svg").count(), 1, "ikon på hver rad");
  await waitFor(async () => (await rows.first().evaluate((el) => el === document.activeElement)), "første rad har fokus");
  await page.keyboard.press("ArrowDown");
  assert.equal(await rows.nth(1).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("End");
  assert.equal(await rows.nth(3).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await rows.nth(0).evaluate((el) => el === document.activeElement), true, "rundt til toppen");

  // Skråstrekkommandoer opens the / menu.
  await page.keyboard.press("Enter");
  await page.getByTestId("composer-menu").getByText("/new", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByLabel("Melding").fill("");

  // Legg til mappe: search, arrow keys and Enter give a chip like @dokumenter/.
  await plus.click();
  await menu.getByRole("menuitem", { name: /Legg til mappe/ }).click();
  const picker = page.getByRole("dialog", { name: "Legg til mappe" });
  await picker.getByRole("option", { name: "./" }).waitFor();
  await page.keyboard.type("dokumenter");
  await picker.getByRole("option", { name: "dokumenter/utkast/" }).waitFor();
  assert.equal(await picker.getByRole("option", { name: "plan.md" }).count(), 0, "bare mapper");
  await waitFor(async () => (await picker.getByRole("option").first().textContent()) === "dokumenter/", "dokumenter/ først");
  await page.keyboard.press("Enter");
  await page.locator(".composer .chip", { hasText: "dokumenter/" }).waitFor();

  // Legg til filer: text files are attached, a binary file is turned away with a message.
  await plus.click();
  await menu.getByText("2 av 20 vedlegg").or(menu.getByText("1 av 20 vedlegg")).waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("text-file-input").setInputFiles([
    { name: "notater.txt", mimeType: "text/plain", buffer: Buffer.from("Hemmelig oppskrift: vafler\n") },
    { name: "program.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3]) },
  ]);
  await page.locator(".composer .chip", { hasText: "notater.txt" }).waitFor();
  await page.locator(".toast", { hasText: "program.bin er ikke en tekstfil" }).waitFor();
  assert.equal(await page.locator(".composer .chip", { hasText: "program.bin" }).count(), 0);

  await send(page, "Se på disse");
  await page.locator(".row-user .chip", { hasText: "notater.txt" }).waitFor();
  await page.locator(".row-user .chip", { hasText: "dokumenter" }).waitFor();
  const threadId = await page.locator(".pane-inner.focused").getAttribute("data-thread-id");
  const events = await h.events(threadId!);
  const message = events.find((e: any) => e.event.type === "user.message")!.event as any;
  assert.deepEqual(message.attachments.map((a: any) => a.kind).sort(), ["dir", "upload"]);
  assert.ok(project.id);
});

flow("+-menyen: grensen på 20 gjelder bilder, filer og mapper samlet", async (h) => {
  const { page } = h;
  await openProject(h);
  const files = Array.from({ length: 19 }, (_, i) => ({ name: `f${i}.txt`, mimeType: "text/plain", buffer: Buffer.from(`fil ${i}\n`) }));
  await page.getByTestId("text-file-input").setInputFiles(files);
  await waitFor(async () => (await page.locator(".composer .chip", { hasText: ".txt" }).count()) === 19, "19 filer");
  await page.getByTestId("image-input").setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") },
  ]);
  await page.getByTestId("attach-limit").waitFor();
  await page.getByTestId("text-file-input").setInputFiles([{ name: "en-til.txt", mimeType: "text/plain", buffer: Buffer.from("x\n") }]);
  await page.locator(".toast", { hasText: "maks 20" }).first().waitFor();
  await page.locator(".composer-foot").getByRole("button", { name: "Legg ved" }).click();
  const menu = page.getByRole("menu", { name: "Legg ved" });
  for (const name of [/^Legg til mappe/, /^Legg til filer/, /^Bilder/]) {
    assert.equal(await menu.getByRole("menuitem", { name }).isDisabled(), true, `${name} er av ved grensen`);
  }
  assert.equal(await menu.getByRole("menuitem", { name: /Skråstrekkommandoer/ }).isDisabled(), false);
});
