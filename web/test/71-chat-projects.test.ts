import assert from 'node:assert/strict';
import {flow,send,waitFor,openProject} from './harness.ts';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=','base64');
const landing=(page:any)=>page.getByTestId('chat-project-page');
const open=async(h:any,name:string)=>{await h.page.locator(`.chat-project[data-chat-project="${name}"] .group-title`).click();await landing(h.page).waitFor();};
const make=async(h:any,name:string)=>h.api('POST','/api/chat-projects',{name});
const idle=async(h:any)=>waitFor(async()=>!(await h.api('GET','/api/bootstrap')).threads.some((t:any)=>t.running),'samtalen ferdig');
flow('Chat-prosjekt: 15 fargede ikoner, egne instrukser, toppfelt og håndtering av chatter',async h=>{
 const {page}=h;await page.getByRole('button',{name:'Nytt prosjekt i Chat',exact:true}).click();
 const dialog=page.getByTestId('chat-project-dialog');await dialog.waitFor();
 assert.equal(await dialog.locator('[data-project-icon]').count(),15);assert.equal(await dialog.locator('[data-project-icon] svg').count(),15);
 await dialog.getByTestId('chat-project-name').fill('Forskning');await dialog.locator('[data-project-icon=flask]').click();await dialog.getByRole('button',{name:'Lilla',exact:true}).click();
 await dialog.getByTestId('chat-project-instructions').fill('Svar med begrepene fra dette prosjektet.');assert.equal(await dialog.locator('input[type=radio][value=project]').isChecked(),true);
 await dialog.getByTestId('chat-project-save').click();const projectPage=landing(page);await projectPage.waitFor();
 const boot=await h.api('GET','/api/bootstrap'),project=boot.chatProjects.find((p:any)=>p.name==='Forskning');assert.equal(boot.threads.length,0);assert.equal(project.icon,'flask');assert.equal(project.color,'purple');assert.equal(project.memoryMode,'project');assert.match(project.instructions,/begrepene/);
 const field=projectPage.locator('.chat-project-composer'),list=projectPage.locator('.chat-project-chat-list');const f=(await field.boundingBox())!,l=(await list.boundingBox())!;assert.ok(f.y+f.height<=l.y,'meldingsfeltet står over chatlisten');
 await send(page,'Hei prosjektet',projectPage);await waitFor(async()=>await landing(page).count()===0,'første sending åpner tråden');await idle(h);
 const thread=(await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.chatProjectId===project.id);assert.ok(thread);
 await open(h,'Forskning');const row=landing(page).locator(`[data-project-thread="${thread.id}"]`);await row.waitFor();await row.getByRole('button',{name:/nytt navn/}).click();
 const rename=page.getByRole('dialog',{name:'Gi chatten nytt navn',exact:true});await rename.getByRole('textbox').fill('Prosjektets første chat');await rename.getByRole('button',{name:'Lagre',exact:true}).click();await row.getByText('Prosjektets første chat',{exact:true}).waitFor();
 await row.getByRole('button',{name:/Slett chatten/}).click();await page.getByRole('button',{name:'Slett chatten',exact:true}).click();await waitFor(async()=>await row.count()===0,'chatten slettet fra prosjektet');assert.equal(await landing(page).isVisible(),true);
});
flow('Prosjektminner: egne og delte Chat-minner, bevart minne ved bytte og trygg redigeringskonflikt',async h=>{
 const {page}=h;h.allow(/409|500/);const project=await make(h,'Planlegging');await h.api('POST','/api/chat-personal/memories',{text:'Globalt eksempelminne'});await open(h,'Planlegging');
 const edit=async()=>{await landing(page).getByRole('button',{name:'Rediger prosjektet Planlegging',exact:true}).click();await page.getByTestId('chat-project-dialog').waitFor();};
 await edit();let dialog=page.getByTestId('chat-project-dialog'),memories=dialog.getByTestId('chat-project-memories');await memories.getByRole('button',{name:'Legg til',exact:true}).click();await memories.getByLabel('Nytt minne',{exact:true}).fill('Bare i Planlegging');await memories.getByRole('button',{name:'Lagre minnet',exact:true}).click();await memories.getByText('Bare i Planlegging',{exact:true}).waitFor();
 assert.equal((await h.api('GET','/api/chat-personal')).memories.length,1);
 await dialog.locator('input[type=radio][value=shared]').check();await dialog.getByText('Lagre den nye minnetypen før du administrerer minnene.',{exact:false}).waitFor();await dialog.getByTestId('chat-project-save').click();await waitFor(async()=>await dialog.count()===0,'minnetype lagret');
 await edit();dialog=page.getByTestId('chat-project-dialog');memories=dialog.getByTestId('chat-project-memories');await memories.getByText('Globalt eksempelminne',{exact:true}).waitFor();assert.equal(await memories.getAttribute('data-memory-mode'),'shared');assert.equal(await memories.getByText('Bare i Planlegging',{exact:true}).count(),0);
 await dialog.locator('input[type=radio][value=project]').check();await dialog.getByTestId('chat-project-save').click();await waitFor(async()=>await dialog.count()===0,'egne minner valgt igjen');await edit();dialog=page.getByTestId('chat-project-dialog');await dialog.getByText('Bare i Planlegging',{exact:true}).waitFor();
 await dialog.getByTestId('chat-project-instructions').fill('Mitt ulagrede utkast');await h.api('PATCH',`/api/chat-projects/${project.id}`,{instructions:'Nyere instruks fra et annet vindu'});await dialog.getByTestId('chat-project-save').click();await dialog.locator('.chat-project-error[role=alert]').waitFor();assert.equal(await dialog.getByTestId('chat-project-instructions').inputValue(),'Mitt ulagrede utkast');assert.equal((await h.api('GET',`/api/chat-projects/${project.id}`)).instructions,'Nyere instruks fra et annet vindu');await dialog.getByRole('button',{name:'Avbryt',exact:true}).click();
 let fail=true;await page.route(`**/api/chat-projects/${project.id}/memories`,async route=>{if(fail&&route.request().method()==='GET'){fail=false;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Midlertidig minnefeil'})});}else await route.continue();});
 await edit();memories=page.getByTestId('chat-project-memories');await memories.getByRole('alert').waitFor();await memories.getByRole('button',{name:'Prøv igjen',exact:true}).click();await memories.getByText('Bare i Planlegging',{exact:true}).waitFor();
});
flow('Prosjektutkast: Chat, prosjekt A og B, vedlegg, tilbake/frem og reload holdes adskilt',async h=>{
 const {page}=h;const a=await make(h,'Prosjekt A'),b=await make(h,'Prosjekt B');void a;void b;
 await page.getByLabel('Melding',{exact:true}).fill('Vanlig Chat-utkast');await open(h,'Prosjekt A');await landing(page).getByLabel('Melding',{exact:true}).fill('Utkast A');await landing(page).getByTestId('image-input').setInputFiles({name:'prosjekt-a.png',mimeType:'image/png',buffer:png});await landing(page).getByTestId('image-chip').waitFor();
 await open(h,'Prosjekt B');assert.equal(await landing(page).getByLabel('Melding',{exact:true}).inputValue(),'');await landing(page).getByLabel('Melding',{exact:true}).fill('Utkast B');assert.equal(await landing(page).getByTestId('image-chip').count(),0);
 await open(h,'Prosjekt A');assert.equal(await landing(page).getByLabel('Melding',{exact:true}).inputValue(),'Utkast A');assert.equal(await landing(page).getByTestId('image-chip').count(),1);
 await page.getByRole('button',{name:'Forrige tråd',exact:true}).click();await landing(page).getByRole('heading',{name:'Prosjekt B',exact:true}).waitFor();assert.equal(await landing(page).getByLabel('Melding',{exact:true}).inputValue(),'Utkast B');
 await page.getByRole('button',{name:'Neste tråd',exact:true}).click();await landing(page).getByRole('heading',{name:'Prosjekt A',exact:true}).waitFor();
 await page.keyboard.press("Control+Alt+n");await waitFor(async()=>await landing(page).count()===0,'vanlig Chat-utkast');assert.equal(await page.getByLabel('Melding',{exact:true}).filter({visible:true}).inputValue(),'Vanlig Chat-utkast');await open(h,'Prosjekt A');
 await h.reload();await landing(page).getByRole('heading',{name:'Prosjekt A',exact:true}).waitFor();assert.equal((await h.api('GET','/api/bootstrap')).threads.length,0);
 await page.keyboard.press("Control+Alt+n");await waitFor(async()=>await landing(page).count()===0,'til vanlig Chat');
 // Ordinary draft persistence is in-memory; reload intentionally clears unsent text.
 assert.equal(await page.getByLabel('Melding',{exact:true}).filter({visible:true}).inputValue(),'');
}, {viewport:{width:1000,height:860}});
flow('Prosjektets første sending: ny tekst og vedlegg skrevet under forespørselen følger riktig chat',async h=>{
 const {page}=h;await make(h,'Sakte prosjekt');await open(h,'Sakte prosjekt');
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let intercepted=false;
 await page.route('**/api/threads/*/messages',async route=>{if(!intercepted){intercepted=true;await gate;}await route.continue();});
 await send(page,'Første melding',landing(page));await waitFor(()=>intercepted,'første forespørsel venter');
 try{await landing(page).getByLabel('Melding',{exact:true}).fill('Oppfølging mens vi venter');await landing(page).getByTestId('image-input').setInputFiles({name:'oppfolging.png',mimeType:'image/png',buffer:png});await landing(page).getByTestId('image-chip').waitFor();}finally{release();}
 await waitFor(async()=>await landing(page).count()===0,'akseptert chat åpnet');const field=page.getByLabel('Melding',{exact:true}).filter({visible:true});await waitFor(async()=>await field.inputValue()==='Oppfølging mens vi venter','nytt utkast bevart');assert.equal(await page.getByTestId('image-chip').filter({visible:true}).count(),1);await idle(h);
});
flow('Tittel og navnefelt står høyere og holder seg i vinduet i Chat og Kode',async h=>{
 const {page}=h;
 for(const code of [false,true]){
  if(code)await openProject(h,'Tittelprosjekt');await send(page,code?'Hei kode':'Hei chat');await idle(h);
  const title=page.getByTestId('topbar-title');await title.waitFor();const box=(await title.boundingBox())!;assert.ok(box.y<=5&&box.y>=0,`løftet tittel (${box.y})`);await title.click();const input=page.getByRole('textbox',{name:'Gi nytt navn',exact:true});await input.waitFor();const editor=(await input.boundingBox())!;assert.ok(Math.abs(editor.y-box.y)<1,'navnefeltet blir i samme topprad');assert.equal(await page.getByRole('dialog',{name:'Tråden',exact:true}).count(),0);
  await input.fill(code?'Kode med nytt navn':'Chat med nytt navn');await input.press('Enter');await title.getByText(code?'Kode med nytt navn':'Chat med nytt navn',{exact:true}).waitFor();
  await title.click();await input.fill(code?'Kode lagret ved fokusbytte':'Chat lagret ved fokusbytte');await page.getByRole('button',{name:'Samtaledetaljer',exact:true}).click();await title.getByText(code?'Kode lagret ved fokusbytte':'Chat lagret ved fokusbytte',{exact:true}).waitFor();await page.getByRole('dialog',{name:'Tråden',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.setViewportSize({width:680,height:860});await title.click();await input.fill('Avbrutt navneutkast');await input.press('Escape');await title.getByText(code?'Kode lagret ved fokusbytte':'Chat lagret ved fokusbytte',{exact:true}).waitFor();await page.getByRole('button',{name:'Samtaledetaljer',exact:true}).click();const bounds=(await page.getByRole('dialog',{name:'Tråden',exact:true}).boundingBox())!;assert.ok(bounds.x>=0&&bounds.x+bounds.width<=680);await page.keyboard.press('Escape');await page.setViewportSize({width:1360,height:860});
 }
});

flow('Tenkning bruker tankeboble i både Chat og Kode',async h=>{
 const {page}=h;
 for(const code of [false,true]){
  if(code)await openProject(h,'Tankeboble');await send(page,'tenk grundig');await idle(h);
  const thinking=page.locator(code?'.row-thinking.step':'.row-thinking:not(.row-premium):not(.step)').last();await thinking.locator('svg[data-icon=thought]').waitFor();assert.equal(await thinking.locator('svg[data-icon=thought]').count(),1);
 }
});
