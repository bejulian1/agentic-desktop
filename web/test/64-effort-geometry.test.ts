import assert from "node:assert/strict";
import { flow, openProject } from "./harness.ts";

flow("innsats: stolpe og knapp holder høyde og vertikal plass gjennom drag, nivåvalg og tilbakestilling", async (h) => {
  const { page } = h;
  await openProject(h);
  await page.getByTestId("effort-button").click();
  const slider = page.getByTestId("effort-slider");
  const settled = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const geometry = () => page.evaluate(() => Object.fromEntries([".effort-head", ".effort-slider", ".effort-thumb"].map((selector) => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return [selector, { y: rect.y, height: rect.height }];
  })));
  await settled();
  const baseline = await geometry();
  const stable = async () => {
    const actual = await geometry();
    for (const selector of Object.keys(baseline)) {
      assert.ok(Math.abs(actual[selector].y - baseline[selector].y) < 0.1, `${selector} holder vertikal plass`);
      assert.ok(Math.abs(actual[selector].height - baseline[selector].height) < 0.1, `${selector} holder samme høyde`);
    }
  };
  for (let round = 0; round < 3; round++) {
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await page.mouse.down();
    await page.locator(".effort-slider.dragging").waitFor();
    await stable();
    await page.mouse.up();
    await settled();
    await stable();
    await slider.press("End");
    await settled();
    await stable();
    await page.getByRole("button", { name: "Tilbake til modellens standard", exact: true }).click();
    await stable();
    await settled();
    await stable();
    await page.getByTestId("effort-name").getByText("Modellens standard", { exact: true }).waitFor();
  }
}, { theme: "dark" });

for(const deviceScaleFactor of [1,1.25]) flow(`innsats: rask åpning og lukking flytter ingen rammer ved skalering ${deviceScaleFactor}`,async h=>{
 const {page}=h;await openProject(h);
 await page.evaluate(()=>{
  const frames:any[]=[];(window as any).__effortGeometry=frames;
  let last:Element|null=null,visit=0;
  const sample=()=>{
   const popup=document.querySelector('[data-testid=effort-picker]');
   if(popup){if(popup!==last)visit++;last=popup;
    const row:any={visit};for(const selector of ['.effort-level','.effort-reset','.effort-thumb']){const box=popup.querySelector(selector)!.getBoundingClientRect();row[selector]={x:box.x,y:box.y,w:box.width,h:box.height};}frames.push(row);
   }else last=null;
   if(!(window as any).__stopEffortSampling)requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 for(let i=0;i<8;i++){
  await page.getByTestId('effort-button').click();
  await page.getByTestId('effort-picker').waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.press('Escape');
 }
 await page.evaluate(()=>(window as any).__stopEffortSampling=true);
 const frames=await page.evaluate(()=>(window as any).__effortGeometry as any[]);assert.ok(frames.length>=8);
 for(const visit of new Set(frames.map(row=>row.visit))){const samples=frames.filter(row=>row.visit===visit);for(const selector of ['.effort-level','.effort-reset','.effort-thumb']){
  const ys=samples.map(row=>row[selector].y),hs=samples.map(row=>row[selector].h);
  assert.ok(Math.max(...ys)-Math.min(...ys)<.05,`${selector}: vertikal forskyvning ved åpning er ${Math.max(...ys)-Math.min(...ys)}`);
  assert.ok(Math.max(...hs)-Math.min(...hs)<.05,`${selector}: høyden er fast`);
 }}
},{theme:'dark',deviceScaleFactor});
