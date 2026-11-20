import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {flow,openProject,send,waitFor} from './harness.ts';
flow('Grener og arbeidstrær fra prosjektmiljø: ekte grenbytte og nytt isolert prosjekt',async h=>{
 const {page}=h;assert.ok(h.projectDir.startsWith(tmpdir()+path.sep));
 const git=(...args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',h.projectDir,...args],{env:{...process.env,HOME:h.home,XDG_CONFIG_HOME:h.home,GIT_CONFIG_NOSYSTEM:'1'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git('init','-b','main');writeFileSync(path.join(h.projectDir,'demo.txt'),'original\n');git('add','.');git('-c','user.name=Test','-c','user.email=test@localhost','commit','-m','initial');
 const parent=mkdtempSync(path.join(tmpdir(),'ad-ui-worktrees-'));
 try{
  const source=await openProject(h,'Grenprøve');await page.getByTestId('project-environment-button').click();
  await page.getByTestId('project-environment-menu').getByRole('button',{name:/^Gren/}).click();
  const dialog=page.getByRole('dialog',{name:'Grener og arbeidstrær',exact:true});await dialog.getByRole('button',{name:'Ny gren',exact:true}).click();
  await dialog.getByLabel('Nytt grennavn',{exact:true}).fill('feature/test');await dialog.getByRole('button',{name:'Opprett og bytt gren',exact:true}).click();
  await waitFor(async()=>git('branch','--show-current').trim()==='feature/test','gren opprettet');
  await dialog.getByRole('button',{name:'Bytt til main',exact:true}).click();
  await waitFor(async()=>git('branch','--show-current').trim()==='main','tilbake til main');
  await dialog.getByRole('button',{name:'Lukk grener og arbeidstrær',exact:true}).click();
  await send(page,'/worktree');await dialog.getByRole('form',{name:'Opprett arbeidstre',exact:true}).waitFor();
  await dialog.getByLabel('Nytt grennavn',{exact:true}).fill('feature/arbeidstre');await dialog.getByLabel('Mappe for arbeidstre',{exact:true}).fill(path.join(parent,'med mellomrom'));
  await dialog.getByRole('button',{name:'Opprett og åpne arbeidstre',exact:true}).click();
  await waitFor(async()=>!(await dialog.isVisible()),'arbeidstre åpnet');
  await waitFor(async()=>Object.values((await h.api('GET','/api/bootstrap')).projects).length===2,'nytt prosjekt');
  const projects=(await h.api('GET','/api/bootstrap')).projects;assert.equal(projects.find((p:any)=>p.id===source.id).path,h.projectDir);
  assert.equal(readFileSync(path.join(parent,'med mellomrom','demo.txt'),'utf8'),'original\n');assert.equal(git('branch','--show-current').trim(),'main');
  await waitFor(async()=>/feature\/arbeidstre/.test(await page.locator('.project-label').first().innerText()),'arbeidstre valgt i meldingsfeltet');
 }finally{rmSync(parent,{recursive:true,force:true});}
});
flow('Profilmeny: søkbar full versjonslogg, lesbare detaljer og retur til bevart utkast',async h=>{
 const {page}=h;await page.getByLabel('Melding',{exact:true}).fill('Behold utkastet mitt');
 await page.locator('.sidebar .profile-button').click();await page.getByRole('menuitem',{name:'Versjonslogg',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Versjonslogg',exact:true});await dialog.locator('.release-entry').first().waitFor();
 assert.ok(await dialog.locator('.release-entry').count()>15);
 // The whole history is open in one list: newest first, the first round last.
 assert.equal(await dialog.locator('details').count(),0);
 assert.match(await dialog.locator('.release-entry').first().locator('.release-head').innerText(),/Denne versjonen/);
 assert.match(await dialog.locator('.release-entry').last().innerText(),/Runde 1/);
 assert.match(await dialog.locator('.release-end').innerText(),/Her begynte det/);
 await dialog.getByLabel('Søk i versjonsloggen',{exact:true}).fill('0.18.0:');
 await waitFor(async()=>await dialog.locator('.release-entry').count()===1,'søket filtrerer versjoner');assert.match(await dialog.locator('.release-body').innerText(),/Nettleser uten prosjekt/);
 await page.keyboard.press('Escape');await waitFor(async()=>await dialog.count()===0,'versjonsloggen lukker');assert.equal(await page.getByLabel('Melding',{exact:true}).inputValue(),'Behold utkastet mitt');
});
flow('Versjonslogg fra Innstillinger og Om åpner det samme vinduet',async h=>{
 const {page}=h;await page.keyboard.press('Control+,');await page.locator('.settings-page').waitFor();
 await page.getByTestId('settings-releases').click();
 const dialog=page.getByRole('dialog',{name:'Versjonslogg',exact:true});await dialog.locator('.release-entry').first().waitFor();
 const body=dialog.locator('.info-body');
 assert.ok(await body.evaluate(el=>el.scrollHeight>el.clientHeight),'lista kan rulles');
 assert.ok(await body.evaluate(el=>el.scrollWidth<=el.clientWidth),'ingen vannrett rulling');
 await dialog.getByRole('button',{name:'Lukk'}).click();await waitFor(async()=>await dialog.count()===0,'lukker');
 await page.locator('.settings-nav').getByRole('button',{name:'Om',exact:true}).click();
 await page.getByTestId('about-releases').click();await dialog.locator('.release-entry').first().waitFor();
 assert.match(await dialog.locator('.release-version').first().innerText(),/^\d+\.\d+\.\d+$/);
 await page.keyboard.press('Escape');await waitFor(async()=>await dialog.count()===0,'Esc lukker');
});
flow('Til bunnen er midtstilt over meldingsfeltet i Chat og Kode med sidepanel',async h=>{
 const {page}=h;
 for(const mode of ['chat','code'] as const){
  const project=mode==='code'?await h.createProject('Rulleprøve'):null;
  const thread=await h.createThread(project?.id??null);
  for(let i=0;i<8;i++){
   await h.api('POST',`/api/threads/${thread.id}/messages`,{text:`hjelp nummer ${i}`});
   await waitFor(async()=>!(await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id).running,'svaret ferdig');
  }
  await page.locator('.sidebar .mode-button',{hasText:mode==='code'?'Kode':'Chat'}).click();
  await page.locator(`[data-thread-item="${thread.id}"]`).click();
  if(mode==='code'){await page.keyboard.press('Control+Shift+b');await page.locator('.right-panel').waitFor();}
  const pane=page.locator(`[data-thread-id="${thread.id}"]`),scroller=pane.getByTestId('scroller');await scroller.evaluate(el=>el.scrollTop=-el.scrollHeight);
  const button=pane.getByRole('button',{name:'Til bunnen',exact:true});await button.waitFor();
  await waitFor(async()=>{const box=(await button.boundingBox())!,area=(await scroller.boundingBox())!;return Math.abs((box.x+box.width/2)-(area.x+area.width/2))<1;},'knappen midtstilt i samtaleområdet');
  await button.click();await waitFor(async()=>Math.abs(await scroller.evaluate(el=>el.scrollTop))<1,'kommet til bunnen');
 }
});
