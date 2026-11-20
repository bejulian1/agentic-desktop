import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiCall,closeAll,launch,sandbox,waitFor,type Running} from './helpers.ts';
test('Mods i Electron: samtykke, pixelart, egen økt og vanlig ny oppstart',async()=>{
 const box=sandbox();let running:Running|undefined;
 try{running=await launch(box);let page=running.page;await apiCall(page,'PATCH','/api/settings',{theme:'light'});await page.locator('.sidebar').getByRole('button',{name:'Kode',exact:true}).click();
 const field=page.getByLabel('Melding',{exact:true});await field.fill('Bruk Nordlys tema');await field.press('Enter');const approval=page.locator('.approval-dock');await approval.getByText('Slå på mods for denne samtalen?',{exact:true}).waitFor();await approval.getByRole('button',{name:/^Slå på/}).click();await page.locator('html[data-ui-mod=nordlys][data-theme=dark]').waitFor();await page.getByTestId('mod-backdrop').waitFor();
 await waitFor(async()=>!(await apiCall<any>(page,'GET','/api/bootstrap')).threads[0].running,'modtur ferdig');const thread=(await apiCall<any>(page,'GET','/api/bootstrap')).threads[0];assert.equal((await apiCall<any>(page,'GET','/api/bootstrap')).settings.theme,'light');
 await closeAll(running);running=undefined;running=await launch(box);page=running.page;assert.equal(await page.locator('html').getAttribute('data-ui-mod'),null);assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.locator(`[data-thread-item="${thread.id}"]`).click();await page.locator('html[data-ui-mod=nordlys]').waitFor();
 await page.getByTestId('ui-mods-button').click();const dialog=page.getByRole('dialog',{name:'Tema og mods',exact:true});await dialog.getByRole('button',{name:'Tilbake til standard',exact:true}).click();await page.locator('html[data-theme=light]:not([data-ui-mod])').waitFor();
 }finally{await closeAll(running);box.cleanup();}
});
