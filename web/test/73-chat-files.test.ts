import assert from 'node:assert/strict';
import http from 'node:http';
import {flow,send,waitFor} from './harness.ts';
import {readFileSync} from 'node:fs';
import {openaiText,openaiToolCall} from '../../server/test/fake-llm.ts';
flow('Chat-filer: Word-nedlasting, Python-bryter og umiddelbar kalender ved peker',async h=>{
 const {page}=h;let calls=0;
 const fake=http.createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(calls++===0?openaiToolCall('create_document',{name:'rapport.docx',title:'Rapport',text:'Testet dokument fra Chat.'}):openaiText('Rapporten er klar for nedlasting.'));});});
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));
 try{
  const provider=await h.api('POST','/api/providers',{kind:'openai-compatible',name:'Lokal filtest',baseUrl:`http://127.0.0.1:${(fake.address() as any).port}/v1`});
  const model=await h.api('POST','/api/models',{providerId:provider.id,name:'Dokumentmodell',model:'test',contextWindow:32000});
  await page.getByTestId('model-button').click();await page.getByRole('option',{name:model.name,exact:true}).click();
  await page.getByTestId('chat-tools-button').click();const tools=page.getByRole('menu',{name:'Verktøy',exact:true});await tools.locator('[data-tool=documents][aria-checked=true]').waitFor();await tools.locator('[data-tool=python][aria-disabled]').waitFor({state:'detached'});assert.equal(await tools.locator('[data-tool=python]').getAttribute('aria-checked'),'false');await page.keyboard.press('Escape');
  await send(page,'Lag en rapport i Word');const card=page.getByTestId('chat-file-cards');await card.getByText('rapport.docx').waitFor();
  const downloaded=page.waitForEvent('download');await card.getByRole('link').click();const file=await downloaded;assert.equal(file.suggestedFilename(),'rapport.docx');const filename=await file.path();assert.equal(readFileSync(filename!).subarray(0,2).toString(),'PK');
  await waitFor(async()=>!(await h.api('GET','/api/bootstrap')).threads.some((t:any)=>t.running),'dokument ferdig');
  await page.getByRole('button',{name:'Profil',exact:true}).click();await page.locator('.profile-menu').getByRole('menuitem',{name:/^Profil/}).click();
  const cell=page.getByTestId('profile-daily').locator('rect').last();const box=(await cell.boundingBox())!;
  // Dispatch and inspect in the same browser task: no timer/native title delay.
  const immediate=await cell.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,clientX:300,clientY:400}));el.dispatchEvent(new PointerEvent('pointerenter',{bubbles:false,clientX:300,clientY:400}));return !!document.querySelector('[data-testid=token-tooltip]');});assert.equal(immediate,true);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const tip=page.getByTestId('token-tooltip');await tip.waitFor();assert.match(await tip.locator('strong').textContent()??'',/mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag/);assert.match(await tip.locator('span').textContent()??'',/^[\d\s ]+ tokens$/);assert.equal(await cell.locator('title').count(),0);
  const tbox=(await tip.boundingBox())!;assert.ok(Math.abs(tbox.x-box.x)<310&&Math.abs(tbox.y-box.y)<100);await page.mouse.move(600,40);await tip.waitFor({state:'detached'});
  await page.getByTestId('profile-daily').locator('rect').first().focus();await tip.waitFor();await page.keyboard.press('Escape');await tip.waitFor({state:'detached'});
 }finally{fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));}
});
