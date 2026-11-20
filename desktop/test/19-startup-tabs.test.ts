import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiCall,closeAll,launch,sandbox,waitFor,type Running} from './helpers.ts';

test('Ny oppstart og gjenåpning fra statusfeltet: tom samtale, bevart historikk og valgfri gjenopptaking',async()=>{
 const box=sandbox({tray:'on'});let running:Running|undefined;
 try {
  running=await launch(box);
  let {page,probe}=running;
  const thread=await apiCall<any>(page,'POST','/api/threads',{projectId:null,mode:'chat'});
  await apiCall(page,'PATCH',`/api/threads/${thread.id}`,{title:'Behold denne samtalen'});
  const open=async()=>{await page.locator(`[data-thread-item="${thread.id}"]`).click();await page.locator(`[data-thread-id="${thread.id}"]`).waitFor();};
  await open();
  await page.getByTestId('topbar-title').click();
  const rename=page.getByRole('textbox',{name:'Gi nytt navn',exact:true});
  await rename.fill('Navn fra topplinjen');
  assert.equal(await rename.evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region')),'no-drag');
  await rename.press('Enter');
  await page.getByTestId('topbar-title').getByText('Navn fra topplinjen',{exact:true}).waitFor();
  await page.locator(`[data-thread-id="${thread.id}"] textarea`).fill('Mitt usendte utkast');
  await page.locator('[data-control="close"]').click();
  await waitFor(async()=>!(await running!.windowState()).visible,'lukket vindu');
  await probe("probe.statusAreaAction('Vis Agentic Desktop')");
  await waitFor(async()=> (await running!.windowState()).visible,'åpent vindu');
  await waitFor(async()=>await page.locator(`[data-thread-id="${thread.id}"]`).count()===0,'ny tom samtale');
  assert.equal(await page.locator('.composer textarea').first().inputValue(),'');
  await open();
  assert.equal(await page.locator(`[data-thread-id="${thread.id}"] textarea`).inputValue(),'Mitt usendte utkast','statusfeltet beholder utkastet i den opprinnelige samtalen');
  await apiCall(page,'PATCH','/api/settings',{startConversation:'resume'});
  await page.locator('[data-control="close"]').click();
  await waitFor(async()=>!(await running!.windowState()).visible,'lukket med fortsett');
  await probe("probe.statusAreaAction('Vis Agentic Desktop')");
  await page.locator(`[data-thread-id="${thread.id}"]`).waitFor();
  await waitFor(async()=>!!(await apiCall<any>(page,'GET','/api/projects/chat/layout')).layout?.root?.threadId,'samtalen lagret');
  await closeAll(running);running=undefined;
  running=await launch(box);page=running.page;probe=running.probe;
  await page.locator(`[data-thread-id="${thread.id}"]`).waitFor();
  await apiCall(page,'PATCH','/api/settings',{startConversation:'new'});
  await closeAll(running);running=undefined;
  running=await launch(box);page=running.page;
  await page.locator('.composer textarea').first().waitFor();
  assert.equal(await page.locator(`[data-thread-id="${thread.id}"]`).count(),0);
  assert.equal(await page.locator(`[data-thread-item="${thread.id}"]`).isVisible(),true);
  assert.equal((await apiCall<any>(page,'GET','/api/bootstrap')).threads.length,1);
 }finally{await closeAll(running);box.cleanup();}
});
