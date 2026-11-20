import assert from 'node:assert/strict';
import {flow,waitFor} from './harness.ts';
flow('Glass følger innholdskolonnen med myk kant i Chat, Kode og smale vinduer',async h=>{
 const {page}=h;await h.api('PATCH','/api/settings',{theme:'dark'});
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1700;c.height=1000;const x=c.getContext('2d')!;for(let i=0;i<c.width;i+=12){x.fillStyle=i%24?'#e6b86a':'#093852';x.fillRect(i,0,12,1000);}return c.toDataURL().split(',')[1];});
 await h.api('POST','/api/appearance/wallpaper',{name:'Visuell kontroll.png',mime:'image/png',data});await h.api('PUT','/api/ui-mods/preferences',{wallpaper:{opacity:1}});await page.getByTestId('global-wallpaper').waitFor();
 const pixels=async(png:Buffer,points:Array<[number,number]>)=>page.evaluate(async({base64,points})=>{const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const x=c.getContext('2d')!;x.drawImage(bitmap,0,0);bitmap.close();return points.map(([a,b])=>Array.from(x.getImageData(Math.round(a),Math.round(b),1,1).data));},{base64:png.toString('base64'),points});
 for(const mode of ['Chat','Kode']){
  await page.locator('.sidebar').getByRole('button',{name:mode,exact:true}).click();
  const pane=page.locator('.pane-inner').first(),rect=(await pane.boundingBox())!,width=await pane.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--content-max'))),center=rect.x+rect.width/2;
  const points:Array<[number,number]>=[[center-width/2-110,120],[center+width/2+110,120],[center,120],[center-width/2-110,940],[center+width/2+110,940]];
  await h.api('PUT','/api/ui-mods/preferences',{glass:false});await waitFor(async()=>!(await pane.getAttribute('class'))?.includes('ui-mod-glass'),'glass av');const plain=await pixels(await page.screenshot(),points);
  await h.api('PUT','/api/ui-mods/preferences',{glass:true});await pane.locator('xpath=self::*[contains(@class,"ui-mod-glass")]').waitFor();const frosted=await pixels(await page.screenshot(),points);
  assert.deepEqual(frosted[0],plain[0],'venstre marg er skarp');assert.deepEqual(frosted[1],plain[1],'høyre marg er skarp');assert.notDeepEqual(frosted[2],plain[2],'kolonnen er uskarp');assert.deepEqual(frosted[3],frosted[0],'bunnlaget stopper også i venstre marg');assert.deepEqual(frosted[4],frosted[1],'bunnlaget stopper også i høyre marg');
 }
 // The same mask clamps to the pane edges instead of fading away under narrow text.
 await page.setViewportSize({width:860,height:900});await page.locator('.ui-mod-glass').waitFor();assert.equal(await page.locator('.pane-inner').evaluate(el=>getComputedStyle(el,'::before').maskImage.includes('linear-gradient')),true);await page.screenshot({path:'/tmp/ad-0242-glass-smal.png'});
},{viewport:{width:1700,height:1000}});
