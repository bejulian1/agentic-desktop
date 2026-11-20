import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {apiCall,closeAll,launch,sandbox,waitFor,type Running} from './helpers.ts';
test('Chat i Electron: ekte dokumentnedlasting og isolert Python fra utility-prosessen',async()=>{
 const box=sandbox();let running:Running|undefined;
 try{
  running=await launch(box);const {page}=running;
  const status=await apiCall<any>(page,'GET','/api/chat-workspace/status');assert.equal(status.available,true,status.reason);
  await page.getByLabel('Melding',{exact:true}).fill('Lag et Word dokument');await page.getByLabel('Melding',{exact:true}).press('Enter');
  const file=page.getByTestId('chat-file-cards').getByRole('link');await file.waitFor();assert.match(await file.textContent()??'',/rapport.docx/);
  const filename=path.join(box.dir,'rapport.docx');
  const saved=running.app.evaluate(({BrowserWindow},filename)=>new Promise<string>(resolve=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http'))!.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(filename);item.once('done',(_e,state)=>resolve(state));});}),filename);
  await file.click();assert.equal(await saved,'completed');assert.equal(readFileSync(filename).subarray(0,2).toString(),'PK');
  const thread=(await apiCall<any>(page,'GET','/api/bootstrap')).threads[0];await waitFor(async()=>!(await apiCall<any>(page,'GET','/api/bootstrap')).threads[0]?.running,'dokument ferdig');
  await apiCall(page,'PATCH',`/api/threads/${thread.id}`,{chatTools:{python:true}});
  await page.getByLabel('Melding',{exact:true}).fill('Beregn med Python');await page.getByLabel('Melding',{exact:true}).press('Enter');
  await page.getByTestId('chat-file-cards').getByRole('link',{name:/analyse.csv/}).waitFor();await waitFor(async()=>!(await apiCall<any>(page,'GET','/api/bootstrap')).threads[0]?.running,'Python ferdig');
  assert.match(await page.locator('[data-tool=run_python]').textContent()??'',/Kjørte Python/);assert.equal(existsSync(path.join(box.dataDir,'chat-workspaces',thread.id)),true);
 }finally{await closeAll(running);box.cleanup();}
});
