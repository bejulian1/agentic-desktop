import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {UiMods} from '../src/ui-mods.ts';
import {startHarness} from './helpers.ts';
import {rawRequest} from './helpers.ts';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
test('Globalt bakgrunnsbilde: privat, varig, separat fra vedlegg og ryddet ved bytte/fjerning',async t=>{
 const h=await startHarness(t),url='/api/appearance/wallpaper';
 const first=await h.api('POST',url,{name:'Fjell.png',mime:'image/png',data:png});assert.equal(first.wallpaper.name,'Fjell.png');
 const id=first.wallpaper.id,file=path.join(h.app.config.dataDir,'appearance','images',id+'.png');assert.ok(existsSync(file));assert.ok(!existsSync(path.join(h.app.config.dataDir,'images',id+'.png')));
 const image=await h.raw('GET',url+'/'+id);assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/png');assert.match(String(image.headers['cache-control']),/private/);
 const outside=await rawRequest(h.app.port,'GET',url+'/'+id);assert.equal(outside.status,401);
 await h.api('PUT','/api/ui-mods/preferences',{glass:false,glassStyle:'panels',wallpaper:{opacity:0.65,blur:8}});
 await assert.rejects(()=>h.api('PUT','/api/ui-mods/preferences',{glassStyle:'annet'}));
 const again=new UiMods(h.app.store,h.app.config.dataDir,()=>{},()=>false);t.after(()=>again.close());assert.equal(again.snapshot().wallpaper?.blur,8);assert.equal(again.snapshot().glass,false);assert.equal(again.snapshot().glassStyle,'panels');
 const chat=await h.thread(null,'chat');assert.equal('wallpaper' in again.inspect(chat.id),false);assert.equal((await h.raw('GET','/api/images/'+id)).status,404);
 const next=await h.api('POST',url,{name:'Ny.png',mime:'image/png',data:png});assert.notEqual(next.wallpaper.id,id);assert.equal(next.wallpaper.opacity,0.65);assert.equal(existsSync(file),false);assert.equal((await h.raw('GET',url+'/'+id)).status,404);
 await h.api('DELETE',url);assert.equal((await h.api('GET','/api/ui-mods')).wallpaper,null);assert.equal(existsSync(path.join(h.app.config.dataDir,'appearance','images',next.wallpaper.id+'.png')),false);
 const preferences=JSON.parse(readFileSync(path.join(h.app.config.dataDir,'ui-mods','preferences.json'),'utf8'));assert.equal(preferences.wallpaper,null);
});
test('Bakgrunnsbilde: avviser aktive formater, feil filtype, overskridelser og ugyldige innstillinger',async t=>{
 const h=await startHarness(t),url='/api/appearance/wallpaper';
 for(const data of [{mime:'image/svg+xml',data:Buffer.from('<svg/>').toString('base64')},{mime:'image/png',data:Buffer.from('<script>').toString('base64')},{mime:'image/png',data:'a'.repeat(4*1024*1024+4)}])assert.ok((await h.raw('POST',url,{headers:{"content-type":"application/json"},body:JSON.stringify(data)})).status>=400);
 await h.api('POST',url,{name:'Test',mime:'image/png',data:png});
 for(const wallpaper of [{id:'../escape'},{opacity:2},{blur:-1},{blur:'9'}])assert.equal((await h.raw('PUT','/api/ui-mods/preferences',{headers:{"content-type":"application/json"},body:JSON.stringify({wallpaper})})).status,400);
 assert.equal((await h.api('GET','/api/ui-mods')).wallpaper.name,'Test');
});
