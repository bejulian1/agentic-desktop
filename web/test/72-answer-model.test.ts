import assert from 'node:assert/strict';
import http from 'node:http';
import {flow,openProject,send,waitFor} from './harness.ts';
const chunk=(text:string,finish:string|null=null)=>`data: ${JSON.stringify({id:'local',choices:[{index:0,delta:{content:text},finish_reason:finish}]})}\n\n`;
for(const mode of ['chat','code'])flow(`Svarmodell i ${mode}: aktiv modell, byttelinje, ikon, omstart og fjernet leverandør`,async h=>{
 const {page}=h;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let first=true;
 const fake=http.createServer((req,res)=>{req.resume();req.on('end',async()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(chunk('Svaret er skrevet av den aktive modellen.'));if(first){first=false;await gate;}res.end(chunk(' Ferdig.','stop')+'data: [DONE]\n\n');});});
 await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve));
 try{
  const baseUrl=`http://127.0.0.1:${(fake.address() as any).port}/v1`;
  const a=await h.api('POST','/api/providers',{kind:'openai-compatible',name:'Første API',baseUrl});
  const b=await h.api('POST','/api/providers',{kind:'openai-compatible',name:'Andre API',baseUrl});
  const modelA=await h.api('POST','/api/models',{providerId:a.id,name:'Opprinnelig modell',model:'local-a',contextWindow:100000});
  const modelB=await h.api('POST','/api/models',{providerId:b.id,name:'Neste modell',model:'local-b',contextWindow:100000});
  if(mode==='code')await openProject(h,'Modellinformasjon');
  const choose=async(name:string)=>{await page.getByTestId('model-button').click();await page.getByRole('option',{name,exact:true}).click();};
  await choose(modelA.name);await send(page,'Første spørsmål');await page.locator('.row-text').getByText(/Svaret er skrevet/).waitFor();
  const thread=(await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.mode===mode)!;
  try{await choose(modelB.name);await waitFor(async()=>(await h.events(thread.id)).some((e:any)=>e.event.type==='model.changed'),'modellbyttet er lagret');assert.equal(await page.locator('[data-row=model-change]').count(),0,'byttet deler ikke et aktivt svar');}finally{release();}
  await waitFor(async()=>!(await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id)?.running,'første svar ferdig');
  const change=page.locator('[data-row=model-change]');
  await change.getByText('Byttet modell: Opprinnelig modell → Neste modell',{exact:true}).waitFor();
  assert.equal(await change.getByText('Byttet modell: Opprinnelig modell til Neste modell',{exact:true}).count(),1);
  for(const width of [1360,680]) { await page.setViewportSize({width,height:860}); const centers=await page.locator('[data-row=model-change]').evaluate(el=>{const icon=el.querySelector('svg')!.getBoundingClientRect(),text=el.querySelector(':scope > span')!.getBoundingClientRect(),pane=el.closest('.conversation')!.getBoundingClientRect();return [(icon.left+text.right)/2,pane.left+pane.width/2];});assert.ok(Math.abs(centers[0]-centers[1])<1,'modellbyttet er midtstilt i samtaleområdet'); } await page.setViewportSize({width:1360,height:860});
  const answers=page.locator('.msg:has(.row-text)');await answers.first().hover();const button=answers.first().getByRole('button',{name:'Modell som laget svaret',exact:true});
  assert.match(await button.getAttribute('title')??'',/Opprinnelig modell.*Første API/);await button.click();const info=page.getByTestId('answer-model-info');await info.getByText('local-a',{exact:true}).waitFor();await page.keyboard.press('Escape');await info.waitFor({state:'detached'});
  await send(page,'Andre spørsmål');await waitFor(async()=>(await h.events(thread.id)).filter((e:any)=>e.event.type==='run.finished').length===2,'andre svar ferdig');await answers.last().hover();await answers.last().getByRole('button',{name:'Modell som laget svaret',exact:true}).click();await info.getByText('Neste modell',{exact:true}).waitFor();await info.getByText('Andre API',{exact:true}).waitFor();await page.keyboard.press('Escape');
  await h.api('PATCH',`/api/models/${modelA.id}`,{name:'Senere modellnavn'});await h.api('PATCH',`/api/providers/${a.id}`,{name:'Senere API-navn'});await h.api('DELETE',`/api/providers/${a.id}`);
  await h.reload();await answers.first().hover();await answers.first().getByRole('button',{name:'Modell som laget svaret',exact:true}).click();await info.getByText('Opprinnelig modell',{exact:true}).waitFor();await info.getByText('Første API',{exact:true}).waitFor();assert.equal(await page.locator('[data-row=model-change]').count(),1);
  await page.keyboard.press('Control+Comma');await info.waitFor({state:'detached'});
 }finally{release();fake.closeAllConnections();await new Promise<void>(resolve=>fake.close(()=>resolve()));}
});
