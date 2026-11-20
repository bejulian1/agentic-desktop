import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {BUILTIN_MODS,validateUiMod} from '../../shared/ui-mods.ts';
import {Store} from '../src/db.ts';
import {UiMods} from '../src/ui-mods.ts';
import {startHarness,tempDir} from './helpers.ts';
import {startFakeLlm,sse,openaiText,openaiToolCall,hang} from './fake-llm.ts';
const copy=(id='mitt-tema')=>({...structuredClone(BUILTIN_MODS[0]),id});
const wait=async(check:()=>boolean|Promise<boolean>)=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('Tidsavbrudd i modkontroll');};
test('Mods: validerte farger, pixelart, kontrast og ingen kjørbar kode',()=>{
 for(const mod of BUILTIN_MODS)assert.equal(validateUiMod(mod).id,mod.id);
 for(const patch of [{id:'../escape'},{id:'preferences'},{javascript:'alert(1)'},{scene:{preset:'<script>'}},{palette:{text:'#101020'}},{palette:{accent:'url(https://example.com)'}},{layout:{contentWidth:10000}},{scene:{layers:[{kind:'sprite',pixels:['xx'],palette:{a:'#ffffff'}}]}}])assert.throws(()=>validateUiMod({...copy(),...patch}));
 const valid=validateUiMod({...copy(),scene:{preset:'custom',layers:[{kind:'sprite',x:40,y:100,width:30,height:25,pixels:['.a.','aaa','.a.'],palette:{a:'#99ccff'},motion:'float'}]}});assert.equal(valid.scene.layers[0].pixels?.length,3);
});
test('Mods: per-samtale, utsatt innlasting, avbrutt tur, eierskap og varig standard',async t=>{
 const dir=tempDir(t),store=new Store(dir),mods=new UiMods(store,dir,()=>{},()=>false);t.after(()=>{mods.close();store.close();});
 const a=store.createThread(null,'code',null),b=store.createThread(null,'chat',null);
 mods.consent(a.id);mods.save(copy(),a.id);mods.select(a.id,'mitt-tema',true);assert.equal(mods.snapshot().mods.some(m=>m.id==='mitt-tema'),false);mods.finish(a.id,true);
 assert.equal(mods.snapshot().threads[a.id],'mitt-tema');assert.equal(mods.snapshot().threads[b.id],undefined);assert.ok(existsSync(path.join(mods.directory,'mitt-tema.json')));
 assert.throws(()=>mods.save({...copy(),name:'Annen eier'},b.id),/annen samtale/);
 mods.save({...copy(),name:'Avbrutt endring'},a.id);mods.finish(a.id,false);assert.notEqual(mods.snapshot().mods.find(m=>m.id==='mitt-tema')!.name,'Avbrutt endring');
 mods.save({...copy(),name:'Ventende modellendring'},a.id);mods.save({...copy(),name:'Manuelt valg vinner'});mods.finish(a.id,true);assert.equal(mods.snapshot().mods.find(m=>m.id==='mitt-tema')!.name,'Manuelt valg vinner');
 mods.select(a.id,null,true);mods.finish(a.id,true);assert.equal(mods.snapshot().threads[a.id],null);assert.throws(()=>mods.remove('nordlys'),/Eksempeltema/);
 mods.select(a.id,'mitt-tema');mods.consent(a.id,false);assert.equal(mods.snapshot().threads[a.id],null);assert.equal(mods.consented(a.id),false);
 mods.preferences({defaults:{chat:'hav'}});mods.close();const again=new UiMods(store,dir,()=>{},()=>false);assert.equal(again.snapshot().defaults.chat,'hav');again.close();
});
test('Mods: filendring lastes inn, ugyldig JSON beholder sist fungerende, sletting ryddes',async t=>{
 const dir=tempDir(t),store=new Store(dir);let changes=0;const mods=new UiMods(store,dir,()=>{changes++;},()=>false);t.after(()=>{mods.close();store.close();});mods.save(copy());
 const file=path.join(mods.directory,'mitt-tema.json');writeFileSync(file,JSON.stringify({...copy(),name:'Ny filvariant'}));await wait(()=>mods.snapshot().mods.some(m=>m.name==='Ny filvariant'));
 writeFileSync(file,'{ broken');await wait(()=>mods.snapshot().warnings.length>0);assert.equal(mods.snapshot().mods.find(m=>m.id==='mitt-tema')!.name,'Ny filvariant');assert.ok(changes>1);
 mods.remove('mitt-tema');assert.equal(existsSync(file),false);assert.ok(!mods.snapshot().mods.some(m=>m.id==='mitt-tema'));
});
test('Modell: samtykke, full Kode-tilgang og lasting først etter tur',async t=>{
 const h=await startHarness(t),llm=await startFakeLlm(t);const p=await h.api('POST','/api/providers',{kind:'openai-compatible',name:'Lokal modmodell',baseUrl:llm.url+'/v1'}),m=await h.api('POST','/api/models',{providerId:p.id,name:'Modell',model:'test',contextWindow:32000});
 const thread=await h.thread(null,'chat',m.id);
 llm.reply(sse(openaiToolCall('ui_mod',{action:'save',mod:copy()})));llm.reply(hang(''));
 await h.api('POST',`/api/threads/${thread.id}/messages`,{text:'Lag et eget Nordlys-tema.'});await wait(async()=>(await h.events(thread.id)).some(e=>e.event.type==='approval.requested'));
 assert.equal((await h.api('GET','/api/ui-mods')).threads[thread.id],undefined);
 const approval=(await h.events(thread.id)).find(e=>e.event.type==='approval.requested')!.event;if(approval.type!=='approval.requested')throw Error();await h.api('POST',`/api/approvals/${approval.approvalId}`,{decision:'allow'});
 await wait(()=>llm.requests.length===2);assert.equal((await h.api('GET','/api/ui-mods')).threads[thread.id],undefined,'ingen bytting under strømming');h.app.runner.stop(thread.id);await h.finished(thread.id);assert.equal((await h.api('GET','/api/ui-mods')).mods.some((x:any)=>x.id==='mitt-tema'),false,'avbrutt tur lagrer ikke modden');
 llm.reply(sse(openaiToolCall('ui_mod',{action:'save',mod:copy()})));llm.reply(sse(openaiText('Validert og klart.')));await h.api('POST',`/api/threads/${thread.id}/messages`,{text:'Prøv igjen'});await h.finished(thread.id,2);assert.equal((await h.api('GET','/api/ui-mods')).threads[thread.id],'mitt-tema');
 const project=await h.project(undefined,{permissionMode:'full'}),code=await h.thread(project.id,'code',m.id);llm.reply(sse(openaiToolCall('ui_mod',{action:'apply',id:'hav'})));llm.reply(sse(openaiText('Hav klart.')));await h.api('POST',`/api/threads/${code.id}/messages`,{text:'Bruk havtema'});await h.finished(code.id);assert.equal((await h.events(code.id)).some(e=>e.event.type==='approval.requested'),false);
 await h.api('PUT','/api/ui-mods/preferences',{enabled:false});assert.ok(!h.app.runner.toolDefs(h.app.store.thread(thread.id)!,undefined,[]).some(x=>x.name==='ui_mod'));
 await h.api('DELETE',`/api/threads/${thread.id}`);assert.equal((await h.api('GET','/api/ui-mods')).threads[thread.id],undefined);
 assert.ok(readFileSync(path.join(h.app.config.dataDir,'ui-mods','mitt-tema.json'),'utf8').includes('mitt-tema'));
});
