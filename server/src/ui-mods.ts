import {constants,closeSync,fstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,watch,writeFileSync,type FSWatcher} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BUILTIN_MODS,MOD_ID,validateUiMod,type UiMod,type UiModsState,type Wallpaper} from '../../shared/ui-mods.ts';
import {saveImage,findImage} from './images.ts';
import type {Store} from './db.ts';
import {HttpError} from './errors.ts';
type Pending={mods:Map<string,UiMod|null>;selection?:string|null};
interface Preferences {glass:boolean;glassStyle:'backdrop'|'panels';wallpaper:Wallpaper|null;enabled:boolean;animated:boolean;defaults:{chat:string|null;code:string|null};threads:Record<string,string|null>;owners:Record<string,string>;allowed:Record<string,boolean>}
const THREAD=/^[a-f0-9-]{36}$/;
export class UiMods {
 readonly directory:string;
 private appearanceDir:string;
 private prefs:Preferences={glass:true,glassStyle:'backdrop',wallpaper:null,enabled:true,animated:true,defaults:{chat:null,code:null},threads:{},owners:{},allowed:{}};
 private library=new Map<string,UiMod>();
 private pending=new Map<string,Pending>();
 private deferred=new Set<string>();
 private warnings:string[]=[];
 private watcher:FSWatcher;
 private timer:NodeJS.Timeout|undefined;
 constructor(privateStore:Store,dataDir:string,changed:()=>void,isBusy:(id:string)=>boolean){
  this.store=privateStore;this.changed=changed;this.isBusy=isBusy;
  this.appearanceDir=path.join(dataDir,'appearance');
  this.directory=path.join(dataDir,'ui-mods');mkdirSync(this.directory,{recursive:true,mode:0o700});
  try{const v=this.read(path.join(this.directory,'preferences.json'),500000) as Preferences;
   if(typeof v.glass==='boolean')this.prefs.glass=v.glass;if(v.glassStyle==='backdrop'||v.glassStyle==='panels')this.prefs.glassStyle=v.glassStyle;
   const w=v.wallpaper;if(w&&THREAD.test(w.id)&&['image/png','image/jpeg','image/webp'].includes(w.mime)&&typeof w.name==='string'&&Number.isFinite(w.opacity)&&w.opacity>=0&&w.opacity<=1&&Number.isFinite(w.blur)&&w.blur>=0&&w.blur<=16&&findImage(this.appearanceDir,w.id))this.prefs.wallpaper={id:w.id,name:w.name.slice(0,160),mime:w.mime,opacity:w.opacity,blur:w.blur};
   if(typeof v.enabled==='boolean')this.prefs.enabled=v.enabled;if(typeof v.animated==='boolean')this.prefs.animated=v.animated;
   for(const mode of ['chat','code'] as const)if(v.defaults?.[mode]===null||MOD_ID.test(v.defaults?.[mode]??''))this.prefs.defaults[mode]=v.defaults[mode];
   for(const [id,mod] of Object.entries(v.threads??{}))if(THREAD.test(id)&&(mod===null||(typeof mod==='string'&&MOD_ID.test(mod))))this.prefs.threads[id]=mod;
   for(const [id,allowed]of Object.entries(v.allowed??{}))if(THREAD.test(id)&&typeof allowed==="boolean")this.prefs.allowed[id]=allowed;
   for(const [id,owner] of Object.entries(v.owners??{}))if(MOD_ID.test(id)&&THREAD.test(owner))this.prefs.owners[id]=owner;
  }catch{ /* New installation or malformed preferences: plain default appearance. */ }
  this.reload(false);
  this.watcher=watch(this.directory,(_event,name)=>{if(name&&(String(name)==='preferences.json'||String(name).startsWith('.')))return;const owner=name?this.prefs.owners[String(name).replace(/\.json$/,'')]:undefined;if(owner&&this.isBusy(owner))this.deferred.add(owner);clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;this.reload();},120);this.timer.unref();});this.watcher.unref();
 }
 private store:Store;private changed:()=>void;private isBusy:(id:string)=>boolean;
 private read(file:string,max:number):unknown {const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=fstatSync(fd);if(!s.isFile()||s.size>max)throw Error('Ugyldig eller for stor modfil.');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}}
 private write(file:string,value:unknown){const temp=path.join(this.directory,`.${randomUUID()}.tmp`);try{writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,file);}finally{rmSync(temp,{force:true});}}
 private savePreferences(){this.write(path.join(this.directory,'preferences.json'),this.prefs);}
 private builtin(id:string){return BUILTIN_MODS.some(m=>m.id===id);}
 private checkThread(id:string){const t=THREAD.test(id)?this.store.thread(id):undefined;if(!t)throw new HttpError(404,'Fant ikke samtalen.');return t;}
 private pendingFor(id:string){this.checkThread(id);let p=this.pending.get(id);if(!p){p={mods:new Map()};this.pending.set(id,p);}return p;}
 private find(id:string,threadId?:string){if(threadId&&this.pending.get(threadId)?.mods.has(id))return this.pending.get(threadId)!.mods.get(id)??undefined;return this.library.get(id)??BUILTIN_MODS.find(m=>m.id===id);}
 private owned(id:string,threadId?:string){if(this.builtin(id))throw new HttpError(403,'Eksempeltemaer beholdes. Lag en kopi med en ny ID for å endre dem.');if(threadId&&this.find(id,threadId)&&this.prefs.owners[id]!==threadId&&!this.pending.get(threadId)?.mods.has(id))throw new HttpError(403,'Dette temaet tilhører en annen samtale. Lag en kopi med en ny ID.');}
 private validate(value:unknown){try{return validateUiMod(value);}catch(e){throw new HttpError(400,(e as Error).message);}}
 snapshot():UiModsState{return {glass:this.prefs.glass,glassStyle:this.prefs.glassStyle,wallpaper:this.prefs.wallpaper?{...this.prefs.wallpaper}:null,enabled:this.prefs.enabled,animated:this.prefs.animated,defaults:{...this.prefs.defaults},threads:{...this.prefs.threads},allowedThreads:Object.keys(this.prefs.allowed).filter(id=>this.prefs.allowed[id]),mods:[...BUILTIN_MODS,...this.library.values()],pendingThreads:[...this.pending.keys()],warnings:[...this.warnings],directory:this.directory};}
 enabled(){return this.prefs.enabled;}
 consented(id:string){return this.prefs.allowed[id]===true;}
 consent(id:string,on=true){this.checkThread(id);this.prefs.allowed[id]=on;if(!on){this.pending.delete(id);this.prefs.threads[id]=null;}this.savePreferences();this.changed();}
 reload(notify=true){
  const warnings:string[]=[],next=new Map<string,UiMod>();
  const names=readdirSync(this.directory).filter(n=>n.endsWith('.json')&&n!=='preferences.json').sort();
  if(names.length>24)warnings.push('Maks 24 egne mods lastes inn. Fjern ubrukte modfiler for å legge til flere.');
  for(const name of names.slice(0,24)){const id=name.slice(0,-5);if(!MOD_ID.test(id)||this.builtin(id))continue;
   if(this.prefs.owners[id]&&this.isBusy(this.prefs.owners[id])){const old=this.library.get(id);if(old)next.set(id,old);continue;}
   try{const mod=validateUiMod(this.read(path.join(this.directory,name),64000));if(mod.id!==id)throw Error('Filnavnet må stemme med moddens ID.');next.set(id,mod);}catch(e){warnings.push(`${name}: ${(e as Error).message}`);const old=this.library.get(id);if(old)next.set(id,old);}
  }
  for(const [id,mod] of this.library)if(this.prefs.owners[id]&&this.isBusy(this.prefs.owners[id])&&!next.has(id))next.set(id,mod);
  const changed=JSON.stringify([...next])!==JSON.stringify([...this.library])||JSON.stringify(warnings)!==JSON.stringify(this.warnings);
  if(JSON.stringify(warnings)!==JSON.stringify(this.warnings))for(const warning of warnings)console.warn('UI-mod:',warning);
  this.library=next;this.warnings=warnings;
  if(changed&&notify)this.changed();
 }
 preferences(input:any){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'Ugyldige modinnstillinger.');
  for(const key of Object.keys(input))if(!['enabled','animated','defaults','glass','glassStyle','wallpaper'].includes(key))throw new HttpError(400,'Ukjent modinnstilling.');
  const next=structuredClone(this.prefs);
  for(const key of ['enabled','animated','glass'] as const)if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new HttpError(400,'Bruk true/false.');next[key]=input[key];}
  if(input.glassStyle!==undefined){if(input.glassStyle!=='backdrop'&&input.glassStyle!=='panels')throw new HttpError(400,'Velg hele bakgrunnen eller flater bak svar.');next.glassStyle=input.glassStyle;}
  if(input.defaults!==undefined){if(!input.defaults||typeof input.defaults!=='object'||Array.isArray(input.defaults)||Object.keys(input.defaults).some(k=>!['chat','code'].includes(k)))throw new HttpError(400,'Ugyldig standardtema.');for(const mode of ['chat','code'] as const)if(input.defaults[mode]!==undefined){const id=input.defaults[mode];if(id!==null&&(typeof id!=='string'||!this.find(id)))throw new HttpError(404,'Fant ikke temaet.');next.defaults[mode]=id;}}
  if(input.wallpaper!==undefined){const w=input.wallpaper;if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).some(k=>!['opacity','blur'].includes(k))||!next.wallpaper)throw new HttpError(400,'Velg et bakgrunnsbilde først.');for(const key of ['opacity','blur'] as const)if(w[key]!==undefined){if(typeof w[key]!=='number'||!Number.isFinite(w[key])||w[key]<0||w[key]>(key==='blur'?16:1))throw new HttpError(400,'Ugyldig bildestyrke eller uskarphet.');next.wallpaper[key]=w[key];}}
  this.prefs=next;this.savePreferences();if(!next.enabled)this.pending.clear();this.changed();return this.snapshot();
 }
 setWallpaper(input:any){
  if(!input||!['image/png','image/jpeg','image/webp'].includes(input.mime))throw new HttpError(415,'Bruk et PNG-, JPEG- eller WebP-bilde.');
  if(typeof input.data!=='string'||!input.data||input.data.length>4*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)||Buffer.from(input.data,'base64').length>3*1024*1024)throw new HttpError(413,'Bakgrunnsbildet kan være maks 3 MB.');
  const id=saveImage(this.appearanceDir,input.mime,input.data),previous=this.prefs.wallpaper;
  this.prefs.wallpaper={id,mime:input.mime,name:typeof input.name==='string'?input.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,160):'Bakgrunnsbilde',opacity:previous?.opacity??0.35,blur:previous?.blur??0};
  try{this.savePreferences();}catch(e){this.prefs.wallpaper=previous;this.removeWallpaperFile(id);throw e;}
  if(previous)this.removeWallpaperFile(previous.id);this.changed();return this.snapshot();
 }
 clearWallpaper(){const previous=this.prefs.wallpaper;this.prefs.wallpaper=null;try{this.savePreferences();}catch(e){this.prefs.wallpaper=previous;throw e;}if(previous)this.removeWallpaperFile(previous.id);this.changed();return this.snapshot();}
 private removeWallpaperFile(id:string){const image=findImage(this.appearanceDir,id);if(image)rmSync(image.file,{force:true});}
 wallpaperImage(id:string){if(id!==this.prefs.wallpaper?.id)throw new HttpError(404,'Fant ikke bakgrunnsbildet.');const found=findImage(this.appearanceDir,id);if(!found)throw new HttpError(404,'Fant ikke bakgrunnsbildet.');const fd=openSync(found.file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>3*1024*1024)throw new HttpError(404,'Fant ikke bakgrunnsbildet.');return {mime:found.mime,bytes:readFileSync(fd)};}finally{closeSync(fd);}}
 save(value:unknown,threadId?:string){const mod=this.validate(value);this.owned(mod.id,threadId);if(!this.find(mod.id,threadId)&&this.library.size+(this.pending.get(threadId??'')?.mods.size??0)>=24)throw new HttpError(413,'Maks 24 egne mods. Fjern en før du lager flere.');
  if(threadId){if(!this.prefs.enabled)throw new HttpError(403,'Mods er slått av i Innstillinger → Utseende.');this.pendingFor(threadId).mods.set(mod.id,mod);this.changed();return {mod,pending:true};}
  this.write(path.join(this.directory,mod.id+'.json'),mod);for(const [thread,p]of this.pending){p.mods.delete(mod.id);if(!p.mods.size&&p.selection===undefined)this.pending.delete(thread);}this.library.set(mod.id,mod);this.reload();this.changed();return {mod,pending:false};
 }
 select(threadId:string,id:string|null,defer=false){this.checkThread(threadId);if(id!==null&&!this.find(id,defer?threadId:undefined))throw new HttpError(404,'Fant ikke temaet.');if(id!==null&&!this.prefs.enabled)throw new HttpError(403,'Mods er slått av i Innstillinger → Utseende.');if(defer){this.pendingFor(threadId).selection=id;}else{this.pending.delete(threadId);if(id!==null)this.prefs.allowed[threadId]=true;this.prefs.threads[threadId]=id;this.savePreferences();}this.changed();return {id,pending:defer};}
 remove(id:string,threadId?:string){if(typeof id!=='string'||!MOD_ID.test(id))throw new HttpError(400,'Ugyldig mod-ID.');this.owned(id,threadId);if(!this.find(id,threadId))throw new HttpError(404,'Fant ikke temaet.');if(threadId){if(Object.entries(this.prefs.threads).some(([t,m])=>t!==threadId&&m===id)||Object.values(this.prefs.defaults).includes(id))throw new HttpError(409,'Temaet brukes andre steder. Nullstill denne samtalen; slett fra Utseende hvis du vil fjerne det overalt.');this.pendingFor(threadId).mods.set(id,null);this.changed();return {pending:true};}this.deleteNow(id);this.savePreferences();this.reload();this.changed();return {pending:false};}
 private deleteNow(id:string){for(const [thread,p]of this.pending){p.mods.delete(id);if(p.selection===id)p.selection=null;if(!p.mods.size&&p.selection===undefined)this.pending.delete(thread);}
  rmSync(path.join(this.directory,id+'.json'),{force:true});this.library.delete(id);delete this.prefs.owners[id];for(const [thread,mod] of Object.entries(this.prefs.threads))if(mod===id)this.prefs.threads[thread]=null;for(const mode of ['chat','code'] as const)if(this.prefs.defaults[mode]===id)this.prefs.defaults[mode]=null;}
 finish(threadId:string,success:boolean){const pending=this.pending.get(threadId);if(!pending&&!this.deferred.has(threadId))return;this.deferred.delete(threadId);this.pending.delete(threadId);if(pending&&success&&this.prefs.enabled&&this.store.thread(threadId)){
   for(const [id,mod] of pending.mods){if(mod){this.write(path.join(this.directory,id+'.json'),mod);this.prefs.owners[id]=threadId;}else this.deleteNow(id);}
   if(pending.selection!==undefined)this.prefs.threads[threadId]=pending.selection&&this.find(pending.selection,threadId)?pending.selection:null;
   // Newly written mods enter the library before their queued selection is resolved.
   this.reload(false);if(pending.selection!==undefined)this.prefs.threads[threadId]=pending.selection&&this.find(pending.selection)?pending.selection:null;
   this.savePreferences();
  }this.reload(false);this.changed();}
 inspect(threadId:string,id?:string){const t=this.checkThread(threadId);if(id)return {mod:this.find(id,threadId)??null,pending:!!this.pending.get(threadId)?.mods.has(id)};const selected=this.pending.get(threadId)?.selection!==undefined?this.pending.get(threadId)!.selection:(Object.hasOwn(this.prefs.threads,threadId)?this.prefs.threads[threadId]:this.prefs.defaults[t.mode]);return {enabled:this.prefs.enabled,active:this.find(selected??'',threadId)??null,library:[...BUILTIN_MODS,...this.library.values()].map(m=>({id:m.id,name:m.name,description:m.description,builtin:this.builtin(m.id)})),pending:!!this.pending.get(threadId)};}
 forgetThread(id:string){this.pending.delete(id);delete this.prefs.threads[id];delete this.prefs.allowed[id];this.savePreferences();this.changed();}
 close(){this.watcher.close();clearTimeout(this.timer);this.pending.clear();}
}
