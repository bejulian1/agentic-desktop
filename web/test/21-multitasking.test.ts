import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { flow, pane, threadItem, waitFor } from "./harness.ts";

type Box = { x: number; y: number; width: number; height: number };

// Panes glide to their new place with a transform, and a bounding box includes it.
const settle = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every((a) => !((a.effect as KeyframeEffect | null)?.target as Element | null)?.matches?.(".pane, .pane-leaving, .drop-zone, .drop-label")),
  );

const surface = async (page: Page) => (await page.getByTestId("grid").boundingBox())!;

// The pane boxes, left to right and top to bottom.
async function panes(page: Page): Promise<Box[]> {
  await settle(page);
  const boxes = await page.locator(".grid-surface > .pane").evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

const near = (actual: number, expected: number, what: string, slack = 2) =>
  assert.ok(Math.abs(actual - expected) <= slack, `${what}: ${actual.toFixed(1)}, ventet ${expected.toFixed(1)}`);

// Starts a drag and holds it at `to`, so the preview can be looked at before the drop.
async function hold(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 12, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(60);
}

async function dragThread(page: Page, threadId: string, to: { x: number; y: number }): Promise<void> {
  const item = (await threadItem(page, threadId).boundingBox())!;
  await hold(page, { x: item.x + 40, y: item.y + item.height / 2 }, to);
  await page.mouse.up();
}

async function titled(h: Parameters<Parameters<typeof flow>[1]>[0], title: string) {
  const thread = await h.createThread(null);
  await h.api("PATCH", `/api/threads/${thread.id}`, { title });
  return thread;
}

flow("en tråd dras til høyre kant med forhåndsvisning, og ruter stables langs bunnen", async (h) => {
  const { page } = h;
  const a = await titled(h, "Tråd A");
  const b = await titled(h, "Tråd B");
  const c = await titled(h, "Tråd C");
  await threadItem(page, a.id).click();
  await pane(page, a.id).waitFor();
  const s = await surface(page);

  // The right quarter of the pane: the preview is the right half, where the new pane will be.
  const item = (await threadItem(page, b.id).boundingBox())!;
  await hold(page, { x: item.x + 40, y: item.y + item.height / 2 }, { x: s.x + s.width - 80, y: s.y + s.height / 2 });
  const zone = page.locator(".drop-zone");
  await zone.waitFor();
  assert.equal(await zone.getAttribute("data-zone"), "right");
  assert.equal((await page.locator(".drop-label").textContent())?.trim(), "Til høyre");
  await settle(page);
  const preview = (await zone.boundingBox())!;
  near(preview.x, s.x + s.width / 2, "forhåndsvisningen starter midt på");
  near(preview.width, s.width / 2, "forhåndsvisningen er halve bredden");
  const radius = await zone.evaluate((el) => getComputedStyle(el, "::before").borderTopLeftRadius);
  assert.ok(parseFloat(radius) >= 8, `forhåndsvisningen er avrundet (${radius})`);

  // The middle opens the thread there instead, and back to the edge again.
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2, { steps: 4 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Åpne her", "midten åpner tråden her");
  await page.mouse.move(s.x + s.width - 80, s.y + s.height / 2, { steps: 4 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Til høyre", "tilbake til høyre");
  await page.mouse.up();
  await pane(page, b.id).waitFor();
  assert.equal(await zone.count(), 0, "forhåndsvisningen er borte etter slipp");
  const [left, right] = await panes(page);
  near(left.width, right.width, "to like brede ruter");
  assert.ok((await pane(page, b.id).boundingBox())!.x > (await pane(page, a.id).boundingBox())!.x, "B ligger til høyre");

  // The bottom edge of the grid stacks a pane under both.
  const citem = (await threadItem(page, c.id).boundingBox())!;
  await hold(page, { x: citem.x + 40, y: citem.y + citem.height / 2 }, { x: s.x + s.width / 2, y: s.y + s.height - 8 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Nederste kant", "nederste kant");
  assert.equal(await zone.getAttribute("data-edge"), "");
  await settle(page);
  const edge = (await zone.boundingBox())!;
  near(edge.width, s.width, "langs hele bunnen");
  near(edge.y, s.y + (s.height * 2) / 3, "den nederste tredjedelen");
  await page.mouse.up();
  await pane(page, c.id).waitFor();
  const stacked = await panes(page);
  assert.equal(stacked.length, 3);
  near(stacked[2].width, s.width, "den nye ruten er like bred som rutenettet");
  assert.ok(stacked[2].y > stacked[0].y + 100, "den ligger nederst");

  // A pane's title bar over the middle of another swaps them, and says so.
  const headA = (await pane(page, a.id).locator(".pane-head").boundingBox())!;
  const boxB = (await pane(page, b.id).boundingBox())!;
  await hold(page, { x: headA.x + 120, y: headA.y + 18 }, { x: boxB.x + boxB.width / 2, y: boxB.y + boxB.height / 2 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Bytt plass", "bytt plass");
  assert.equal(await page.locator(".pane.lifted").count(), 1, "ruten som dras, er dempet");
  await page.mouse.up();
  await waitFor(async () => (await pane(page, a.id).boundingBox())!.x > (await pane(page, b.id).boundingBox())!.x, "rutene byttet plass");
});

flow("seks ruter side om side, og forhåndsvisningen sier fra om taket", async (h) => {
  const { page } = h;
  const threads = [];
  for (let i = 1; i <= 7; i++) threads.push(await titled(h, `Rute ${i}`));
  await threadItem(page, threads[0].id).click();
  await pane(page, threads[0].id).waitFor();
  const s = await surface(page);
  for (const thread of threads.slice(1, 6)) {
    await dragThread(page, thread.id, { x: s.x + s.width - 8, y: s.y + s.height / 2 });
    await pane(page, thread.id).waitFor();
  }
  const six = await panes(page);
  assert.equal(six.length, 6);
  for (const box of six) {
    near(box.width, s.width / 6, "like brede");
    near(box.y, s.y, "på samme rad");
  }

  // A seventh: the preview says there is no room, and dropping it does nothing.
  const item = (await threadItem(page, threads[6].id).boundingBox())!;
  const third = six[2];
  await hold(page, { x: item.x + 40, y: item.y + item.height / 2 }, { x: third.x + third.width - 15, y: third.y + third.height / 2 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Maks 6 ruter", "maks 6 ruter");
  assert.equal(await page.locator(".drop-zone.full").count(), 1);
  await page.mouse.move(s.x + s.width - 8, s.y + s.height / 2, { steps: 4 });
  await waitFor(async () => (await page.locator(".drop-label").textContent())?.trim() === "Maks 6 ruter", "også langs kanten");
  await page.mouse.up();
  await page.locator(".toast", { hasText: "6 ruter" }).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 6);

  // The middle of a pane still works when it is full.
  const first = six[0];
  await dragThread(page, threads[6].id, { x: first.x + first.width / 2, y: first.y + first.height / 2 });
  await pane(page, threads[6].id).waitFor();
  assert.equal(await page.locator(".pane-inner").count(), 6);
}, { viewport: { width: 1600, height: 1000 } });

const paneAnimations = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.matches?.(".pane, .pane-leaving")).length);

flow("skillet har et håndtak, endrer størrelse live og festes til 1/2 og 1/3", async (h) => {
  const { page } = h;
  // With reduced motion the new pane is just there.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Del til høyre" }).first().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  assert.equal(await paneAnimations(page), 0, "ingen overgang med redusert bevegelse");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await settle(page);
  const s = await surface(page);
  const splitter = page.locator(".splitter").first();
  const sb = (await splitter.boundingBox())!;
  const y = sb.y + sb.height / 2;
  assert.ok(sb.width >= 12, `romslig treffsone (${sb.width})`);
  assert.equal(await splitter.evaluate((el) => getComputedStyle(el).cursor), "col-resize");
  const pill = () => splitter.evaluate((el) => getComputedStyle(el, "::after").opacity);
  assert.equal(await pill(), "0", "håndtaket er skjult");
  await page.mouse.move(sb.x + sb.width / 2, y);
  await waitFor(async () => (await pill()) === "1", "håndtaket vises ved hover");

  const half = s.x + s.width / 2;
  const between = half + s.width / 12; // Midway between 1/2 and 2/3: no snap.
  await page.mouse.down();
  await page.mouse.move(between, y, { steps: 8 });
  await page.waitForTimeout(60);
  near((await panes(page))[0].width, between - s.x, "størrelsen endres mens du drar");
  await page.mouse.up();
  near((await panes(page))[0].width, between - s.x, "slipp langt fra et festepunkt");

  // Let go close to the middle, and it lands on 1/2.
  await page.mouse.move(between, y);
  await page.mouse.down();
  await page.mouse.move(half + 11, y, { steps: 6 });
  await page.waitForTimeout(60);
  assert.equal(await page.locator(".splitter.snap").count(), 1, "håndtaket viser at det vil feste");
  await page.mouse.up();
  const halves = await panes(page);
  near(halves[0].width, s.width / 2, "festet til 1/2", 1);
  near(halves[1].width, s.width / 2, "begge halve", 1);

  // And close to a third.
  await page.mouse.move(half, y);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 3 - 12, y, { steps: 6 });
  await page.mouse.up();
  near((await panes(page))[0].width, s.width / 3, "festet til 1/3", 1);

  // Never smaller than a pane can be.
  await page.mouse.move(s.x + s.width / 3, y);
  await page.mouse.down();
  await page.mouse.move(s.x + 30, y, { steps: 6 });
  await page.mouse.up();
  near((await panes(page))[0].width, 240, "minste bredde", 1);
});

flow("dobbeltklikk gjør rutene like store, og skillet virker med tastaturet", async (h) => {
  const { page } = h;
  await page.getByRole("button", { name: "Del til høyre" }).first().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 2, "to ruter");
  assert.ok((await paneAnimations(page)) > 0, "rutene glir på plass");
  await settle(page);
  const s = await surface(page);
  const splitter = page.locator(".splitter:not(.col)").first();
  const sb = (await splitter.boundingBox())!;
  const y = sb.y + sb.height / 2;
  await page.mouse.move(sb.x + sb.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width * 0.72, y, { steps: 6 });
  await page.mouse.up();
  assert.ok((await panes(page))[0].width > s.width * 0.6, "ulik størrelse først");

  const now = (await splitter.boundingBox())!;
  await page.mouse.dblclick(now.x + now.width / 2, y);
  const equal = await panes(page);
  near(equal[0].width, equal[1].width, "like store etter dobbeltklikk", 1);

  // Keyboard: arrows move the line, Shift moves it further, Enter makes them equal again.
  await splitter.focus();
  assert.equal(await splitter.getAttribute("role"), "separator");
  assert.equal(await splitter.getAttribute("aria-valuenow"), "50");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  near((await panes(page))[0].width, s.width / 2 + 48, "tre steg til høyre");
  assert.ok(Number(await splitter.getAttribute("aria-valuenow")) > 50);
  await page.keyboard.press("Shift+ArrowLeft");
  near((await panes(page))[0].width, s.width / 2 + 48 - 80, "et langt steg tilbake");
  await page.keyboard.press("Enter");
  near((await panes(page))[0].width, s.width / 2, "Enter gjør dem like", 1);
  const focus = await page.evaluate(() => document.activeElement?.classList.contains("splitter"));
  assert.ok(focus, "skillet har fortsatt fokus");

  // Stacked panes have a line across, moved with up and down. Del nedover in the top bar works on the
  // pane with focus (round 11), so the left one gets it first.
  await page.locator(".pane-inner").first().locator(".pane-head").click();
  await page.getByRole("button", { name: "Del nedover" }).first().click();
  await waitFor(async () => (await page.locator(".pane-inner").count()) === 3, "tre ruter");
  const across = page.locator(".splitter.col").first();
  await across.waitFor();
  assert.equal(await across.getAttribute("aria-orientation"), "horizontal");
  const top = (await panes(page))[0].height;
  await across.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  near((await panes(page))[0].height, top + 32, "to steg ned");
});

flow("oppsettet med størrelser kommer tilbake etter sidelast", async (h) => {
  const { page } = h;
  const a = await titled(h, "Tråd A");
  const b = await titled(h, "Tråd B");
  await threadItem(page, a.id).click();
  await pane(page, a.id).waitFor();
  const s = await surface(page);
  await dragThread(page, b.id, { x: s.x + s.width / 2, y: s.y + s.height - 8 });
  await pane(page, b.id).waitFor();
  await settle(page);
  const splitter = page.locator(".splitter.col").first();
  const sb = (await splitter.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, s.y + s.height * 0.58, { steps: 6 });
  await page.mouse.up();
  const before = await panes(page);
  assert.equal(before.length, 2);
  near(before[0].height, s.height * 0.58, "ny høyde");

  await page.waitForTimeout(400); // The layout is stored shortly after the release.
  await h.reload();
  await pane(page, a.id).waitFor();
  await pane(page, b.id).waitFor();
  const after = await panes(page);
  assert.equal(after.length, 2);
  for (let i = 0; i < 2; i++) {
    near(after[i].y, before[i].y, "samme plass", 1);
    near(after[i].height, before[i].height, "samme høyde", 1);
  }
});
