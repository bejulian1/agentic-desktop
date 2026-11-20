import assert from 'node:assert/strict';
import {flow,openProject,send,waitFor} from './harness.ts';
flow('Slash: liste og søkbar hjelp følger modus og utelater fjernede demokommandoer',async h=>{
 const {page}=h;const field=page.getByLabel('Melding',{exact:true});
 await field.fill('/');
 const menu=page.getByTestId('composer-menu');await menu.getByText('/help',{exact:true}).waitFor();
 for(const name of ['approve','ide-context','local','worktree','init','playtest','vscode','goal','plan'])assert.equal(await menu.getByText(`/${name}`,{exact:true}).count(),0);
 assert.equal(await menu.getByText('/mcp',{exact:true}).count(),1,'/mcp er en vanlig kommando nå');
 for(const name of ['init','playtest','vscode','undo','review-changes','worktree']){
  await send(page,`/${name}`);
  await page.getByText(`/${name} krever Kode-modus og et prosjekt.`,{exact:true}).waitFor();
 }
 await send(page,'/mcp');await page.locator('.settings-page .settings-title',{hasText:'MCP-servere'}).waitFor();
 await page.keyboard.press('Escape');await page.locator('.settings-page').waitFor({state:'detached'});
 await send(page,'/hjelp export');
 const help=page.getByRole('dialog',{name:'Hjelp',exact:true});await help.waitFor();
 const search=help.getByRole('searchbox',{name:'Søk i kommandoer og skills'});
 assert.equal(await search.inputValue(),'export');
 await help.getByText('/save',{exact:true}).waitFor();
 await search.fill('tomorrow');await help.getByText('/snooze',{exact:true}).waitFor();
 await search.fill('playtest');await help.getByRole('status').filter({hasText:/Ingen kommandoer/}).waitFor();
 await search.press('Escape');await help.waitFor({state:'detached'});
 assert.equal(await field.evaluate(element=>element===document.activeElement),true);
 assert.equal((await h.api('GET','/api/bootstrap')).threads.length,0,'kommandoene utløser ikke modellkall eller tomme tråder');
 await page.locator('.sidebar .mode-button').filter({hasText:'Kode'}).click();
 await send(page,'/vscode');await page.getByText('/vscode krever Kode-modus og et prosjekt.',{exact:true}).last().waitFor();
});
flow('Slash: alias, argumenter og prosjekthandlinger går gjennom de virkelige endepunktene',async h=>{
 const {page}=h;const project=await openProject(h,'Slashkontroll');
 await send(page,'/init');await page.getByText('Laget AGENTS.md i prosjektet.',{exact:true}).waitFor();
 const fs=await import('node:fs');assert.match(fs.readFileSync(`${h.projectDir}/AGENTS.md`,'utf8'),/./);
 await send(page,'/tenkning xhigh');
 await waitFor(async()=> (await h.api('GET','/api/bootstrap')).threads.some((t:any)=>t.reasoning==='xhigh'),'innsats endret');
 const thread=(await h.api('GET','/api/bootstrap')).threads[0];
 await send(page,'/mål Bevar brukerens oppgave');
 await waitFor(async()=> ((await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id)).goal==='Bevar brukerens oppgave','mål lagret');
 await send(page,'/plan');await waitFor(async()=> ((await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id)).planMode===true,'planmodus på');
 await send(page,'/personlighet kort');await waitFor(async()=> ((await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id)).personality==='kort','personlighet lagret');
 await send(page,'/status');await page.getByTestId('info-card').waitFor();
 assert.match(await page.getByTestId('info-card').innerText(),/Ekstra høy/);
 await page.getByTestId('info-card').getByRole('button',{name:'Lukk',exact:true}).click();
 await send(page,'/vscode');await page.getByText('Åpnet i VS Code.',{exact:true}).waitFor();
 assert.equal(((await h.api('GET','/api/bootstrap')).threads.find((t:any)=>t.id===thread.id)).projectId,project.id);
 await send(page,'/minner');await page.getByRole('heading',{name:'Personalisering og minner',exact:true}).waitFor();
});
