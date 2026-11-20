import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {alive,assertOffScreen,descendants,PACKAGED,sandbox,waitFor} from './helpers.ts';
test('Pakken har alle Office-avhengigheter, ekte filnedlastinger og isolert Python',async()=>{
 assertOffScreen();const box=sandbox(),env={...box.env};delete env.AD_WEB_DIST;
 const child=spawn(PACKAGED,['--ozone-platform=headless','--ozone-override-screen-size=1600,1000','--remote-debugging-port=0'],{env,stdio:['ignore','pipe','pipe']});let out='';child.stdout!.on('data',c=>out+=c);child.stderr!.on('data',c=>out+=c);const pid=child.pid!;let tree:number[]=[];
 try{
  await waitFor(()=>out.includes('Agentic Desktop er klar.'),'pakken lastet',60000);tree=descendants(pid);
  const instance=JSON.parse(readFileSync(path.join(box.dataDir,'instance.json'),'utf8')),port=Number(readFileSync(path.join(box.dataDir,'electron/DevToolsActivePort'),'utf8').split('\n')[0]);
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(`http://127.0.0.1:${instance.port}/`))!;
  const api=async(method:string,url:string,body?:unknown)=>page.evaluate(async({method,url,body})=>{const res=await fetch(url,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!res.ok)throw Error(await res.text());return res.json();},{method,url,body});
  assert.equal((await api('GET','/api/chat-workspace/status')).available,true);
  for(const type of ['Word','Excel','PowerPoint']){const field=page.getByLabel('Melding',{exact:true});await field.fill(`Lag et ${type} dokument`);await field.press('Enter');await page.getByRole('link',{name:type==='Word'?/rapport.docx/:type==='Excel'?/budsjett.xlsx/:/presentasjon.pptx/}).waitFor();await waitFor(async()=>{const boot=await api('GET','/api/bootstrap');return boot.threads.length===1&&!boot.threads[0].running;},`${type} ferdig`);}
  const cards=page.getByTestId('chat-file-cards');assert.equal(await cards.count(),3);
  for(const link of await cards.getByRole('link').all()){const url=(await link.getAttribute('href'))!,magic=await page.evaluate(async url=>{const r=await fetch(url);return {status:r.status,magic:[...new Uint8Array(await r.arrayBuffer()).slice(0,2)]};},url);assert.equal(magic.status,200);assert.deepEqual(magic.magic,[80,75]);}
  const thread=(await api('GET','/api/bootstrap')).threads[0];await api('PATCH',`/api/threads/${thread.id}`,{chatTools:{python:true}});await page.getByLabel('Melding',{exact:true}).fill('Beregn med Python');await page.getByLabel('Melding',{exact:true}).press('Enter');await page.getByRole('link',{name:/analyse.csv/}).waitFor();await waitFor(async()=>!(await api('GET','/api/bootstrap')).threads[0].running,'pakket Python ferdig');
  await api('POST','/api/appearance/wallpaper',{name:'Pakket bakgrunn.png',mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='});await page.getByTestId('global-wallpaper').waitFor();assert.equal(await page.locator('.row-text').last().evaluate(el=>getComputedStyle(el.closest('.pane-inner')!,'::before').backdropFilter),'blur(36px) saturate(1.7)');
  await page.getByLabel('Melding',{exact:true}).fill('Bruk Nordlys tema');await page.getByLabel('Melding',{exact:true}).press('Enter');const approval=page.locator('.approval-dock');await approval.getByRole('button',{name:/^Slå på/}).waitFor();await approval.getByRole('button',{name:/^Slå på/}).click();await page.locator('html[data-ui-mod=nordlys]').waitFor();await page.getByTestId('mod-backdrop').waitFor();await waitFor(async()=>!(await api('GET','/api/bootstrap')).threads[0].running,'pakket modtur ferdig');
  await page.getByTestId('ui-mods-button').click();const dialog=page.getByRole('dialog',{name:'Tema og mods',exact:true});await dialog.getByRole('button',{name:'Tilbake til standard',exact:true}).click();await page.locator('html:not([data-ui-mod])').waitFor();await page.getByTestId('global-wallpaper').waitFor();await api('DELETE','/api/appearance/wallpaper');await page.getByTestId('global-wallpaper').waitFor({state:'detached'});

 }finally{if(alive(pid)){tree=[...new Set([...tree,...descendants(pid)])];const exited=new Promise(resolve=>child.once('exit',resolve));process.kill(pid,'SIGTERM');await exited;await waitFor(()=>[pid,...tree].every(p=>!alive(p)),'pakken stoppet',15000);}box.cleanup();}
});
