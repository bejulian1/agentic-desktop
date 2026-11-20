import assert from 'node:assert/strict';
import {test} from 'node:test';
import {apiCall,closeAll,launch,sandbox,type Running} from './helpers.ts';
test('Globalt bakgrunnsbilde i Electron beholdes ved ny tom oppstart og kan fjernes',async()=>{
 const box=sandbox();let running:Running|undefined;
 try{running=await launch(box);let page=running.page;await apiCall(page,'PATCH','/api/settings',{theme:'dark'});await page.keyboard.press('Control+Comma');await page.locator('.settings-nav').getByRole('button',{name:'Utseende',exact:true}).click();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');await page.getByLabel('Last opp bakgrunnsbilde',{exact:true}).setInputFiles({name:'Bakgrunn.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Fjern bilde',exact:true}).waitFor();const image=(await apiCall<any>(page,'GET','/api/ui-mods')).wallpaper;assert.ok(image.id);await page.locator('.settings-nav').getByRole('button',{name:'Tilbake til appen',exact:true}).click();
 await closeAll(running);running=undefined;running=await launch(box);page=running.page;await page.getByTestId('global-wallpaper').waitFor();assert.equal((await apiCall<any>(page,'GET','/api/ui-mods')).wallpaper.id,image.id);assert.equal(await page.locator('.row-text').count(),0,'oppstart er fortsatt blank');
 await page.locator('.sidebar').getByRole('button',{name:'Kode',exact:true}).click();await page.getByTestId('global-wallpaper').waitFor();await page.keyboard.press('Control+Comma');await page.locator('.settings-nav').getByRole('button',{name:'Utseende',exact:true}).click();await page.getByRole('button',{name:'Fjern bilde',exact:true}).click();await page.getByTestId('global-wallpaper').waitFor({state:'detached'});
 }finally{await closeAll(running);box.cleanup();}
});
