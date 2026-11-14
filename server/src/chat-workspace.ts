import {createHash,randomUUID} from 'node:crypto';
import {constants,existsSync,mkdirSync,openSync,closeSync,writeFileSync,readdirSync,rmSync,fstatSync,readSync} from 'node:fs';
import path from 'node:path';
import type {ChatFile,Thread} from '../../shared/protocol.ts';
import type {Store} from './db.ts';
import {HttpError} from './errors.ts';
import {createDocument,DOCUMENT_TYPES,fileName} from './chat-documents.ts';
import {bwrapExecutable,pythonExecutable,sandboxPython,PYTHON_LIMITS,type PythonPayloadFile} from './chat-python.ts';
import {readTextUpload} from './uploads.ts';
const ID=/^[a-f0-9-]{36}$/;const MAX_STORED=50*1024*1024;
interface RecordFile extends ChatFile {scope:string;hash:string}
export class ChatWorkspace {
 private root:string;private busy=new Set<string>();private controllers=new Set<AbortController>();private closed=false;
 private probe=new AbortController();
 private capability={available:false,reason:'Kontrollerer isolert Python…'};
 readonly ready:Promise<void>;
 private store:Store;private dataDir:string;
 constructor(store:Store,dataDir:string){this.store=store;this.dataDir=dataDir;this.root=path.join(dataDir,'chat-workspaces');this.ready=this.checkPython();}
 private async checkPython(){if(!bwrapExecutable()||!pythonExecutable()){this.capability={available:false,reason:'Python 3 og bubblewrap må være installert for isolert kodekjøring.'};return;}try{await sandboxPython('print("ok")',[],this.probe.signal,()=>{},3000);this.capability={available:true,reason:'Isolert Python · uten nettverk · standardbiblioteket'};}catch{this.capability={available:false,reason:'Ubuntu tillater ikke isolert Python-kjøring nå. Ingen usikret reservekjøring brukes.'};}}
 status(){return {...this.capability,limits:PYTHON_LIMITS};}
 private thread(id:string):Thread {const t=ID.test(id)?this.store.thread(id):undefined;if(!t||t.mode!=='chat')throw new HttpError(404,'Fant ikke Chat-samtalen.');return t;}
 private scope(id:string){this.thread(id);return createHash('sha256').update(this.store.chatContextIdentity(id)??'').digest('hex').slice(0,24);}
 private dir(id:string){if(!ID.test(id))throw new HttpError(404,'Fant ikke Chat-samtalen.');return path.join(this.root,id);}
 private records(id:string):RecordFile[]{this.thread(id);const dir=this.dir(id);if(!existsSync(dir))return [];const out:RecordFile[]=[];for(const n of readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,201)){try{const r=JSON.parse(this.read(path.join(dir,n),16000).toString('utf8'));if(ID.test(r.id)&&r.threadId===id&&typeof r.name==='string'&&typeof r.scope==='string')out.push(r);}catch{}}return out;}
 private read(abs:string,limit:number):Buffer {const fd=openSync(abs,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const s=fstatSync(fd);if(!s.isFile()||s.size>limit)throw new HttpError(413,'Filen er for stor eller ugyldig.');const b=Buffer.alloc(s.size);let offset=0;while(offset<b.length){const n=readSync(fd,b,offset,b.length-offset,offset);if(!n)throw new HttpError(409,'Filen ble endret under lesing.');offset+=n;}return b;}finally{closeSync(fd);}}
 list(id:string):ChatFile[]{const scope=this.scope(id);return this.records(id).filter(r=>r.scope===scope).map(({scope:_s,hash:_h,...r})=>r);}
 download(threadId:string,id:string):{file:ChatFile;data:Buffer}{this.thread(threadId);if(!ID.test(id))throw new HttpError(404,'Fant ikke filen.');const r=this.records(threadId).find(r=>r.id===id);if(!r)throw new HttpError(404,'Fant ikke filen.');return {file:r,data:this.read(path.join(this.dir(threadId),id+'.bin'),10*1024*1024)};}
 private async withLock<T>(id:string,signal:AbortSignal,work:(scope:string)=>Promise<T>):Promise<T>{if(this.closed)throw new HttpError(503,'Chat-verktøyene er avsluttet.');signal.throwIfAborted();const scope=this.scope(id);if(this.busy.has(id))throw new HttpError(409,'Et annet filverktøy arbeider i denne chatten. Prøv igjen etterpå.');this.busy.add(id);try{const result=await work(scope);signal.throwIfAborted();if(this.scope(id)!==scope)throw new HttpError(409,'Chat-konteksten er endret. Start verktøyet på nytt.');return result;}finally{this.busy.delete(id);}}
 private publish(id:string,scope:string,files:Array<{name:string;mime:string;data:Buffer}>):ChatFile[]{if(this.scope(id)!==scope)throw new HttpError(409,'Chat-konteksten er endret.');files=[...new Map(files.map(f=>[f.name,f])).values()];const old=this.records(id);const fresh=files.filter(f=>!old.some(r=>r.scope===scope&&r.name===f.name&&r.hash===createHash('sha256').update(f.data).digest('hex')));if(old.length+fresh.length>200||old.reduce((n,f)=>n+f.bytes,0)+fresh.reduce((n,f)=>n+f.data.length,0)>MAX_STORED)throw new HttpError(413,'Chatten har nådd grensen på 200 filer eller 50 MB. Start en ny chat for flere filer.');const dir=this.dir(id);mkdirSync(dir,{recursive:true,mode:0o700});const created:RecordFile[]=[];try{for(const f of fresh){const fileId=randomUUID();const r:RecordFile={id:fileId,threadId:id,name:f.name,mime:f.mime,bytes:f.data.length,createdAt:Math.max(Date.now(),...old.map(f=>f.createdAt+1),...created.map(f=>f.createdAt+1)),url:`/api/chat-files/${id}/${fileId}/download`,scope,hash:createHash('sha256').update(f.data).digest('hex')};writeFileSync(path.join(dir,fileId+'.bin'),f.data,{flag:'wx',mode:0o600});created.push(r);writeFileSync(path.join(dir,fileId+'.json'),JSON.stringify(r),{flag:'wx',mode:0o600});}return files.map(f=>[...created,...old].find(r=>r.scope===scope&&r.name===f.name&&r.hash===createHash('sha256').update(f.data).digest('hex'))!).map(({scope:_s,hash:_h,...r})=>r);}catch(e){for(const r of created)for(const ext of ['bin','json'])rmSync(path.join(dir,r.id+'.'+ext),{force:true});throw e;}}
 async document(id:string,input:unknown,signal:AbortSignal):Promise<ChatFile[]>{return this.withLock(id,signal,async scope=>{const doc=await createDocument(input);signal.throwIfAborted();return this.publish(id,scope,[doc]);});}
 async python(id:string,code:unknown,signal:AbortSignal,output:(t:string)=>void,documents=true):Promise<{files:ChatFile[];text:string;isError:boolean}>{await this.ready;if(!this.capability.available)throw new HttpError(503,this.capability.reason);if(typeof code!=='string'||!code.trim()||code.length>PYTHON_LIMITS.codeChars)throw new HttpError(400,'Python-koden må være 1–60 000 tegn.');return this.withLock(id,signal,async scope=>{
  const files=new Map<string,PythonPayloadFile>();let total=0;
  const put=(name:string,data:Buffer)=>{if(data.length>PYTHON_LIMITS.fileBytes)return;if(files.has(name))total-=Buffer.from(files.get(name)!.data,'base64').length;total+=data.length;if(total>PYTHON_LIMITS.totalBytes)throw new HttpError(413,'Arbeidsfilene overstiger 20 MB.');files.set(name,{name,data:data.toString('base64')});};
  for(const f of this.records(id).filter(f=>f.scope===scope).sort((a,b)=>a.createdAt-b.createdAt))put(f.name,this.read(path.join(this.dir(id),f.id+'.bin'),PYTHON_LIMITS.fileBytes));
  // Only explicit text uploads in this conversation enter Python. No ambient Code files.
  for(const {event} of this.store.eventsTail(id,1000))if(event.type==='user.message')for(const a of event.attachments??[])if(a.kind==='upload'&&a.uploadId){try{const name=fileName(a.label),value=readTextUpload(this.dataDir,a.uploadId);if(value!==null)put(name,Buffer.from(value));}catch{}}
  const controller=new AbortController();this.controllers.add(controller);let reply;try{reply=await sandboxPython(code,[...files.values()],AbortSignal.any([signal,controller.signal]),output);}finally{this.controllers.delete(controller);}
  signal.throwIfAborted();if(reply.files.length>30)throw new HttpError(413,'For mange resultatfiler.');
  const out:Array<{name:string;mime:string;data:Buffer}>=[];let bytes=0;const warnings:string[]=[];
  for(const f of reply.files){let name;try{name=fileName(f.name);}catch{warnings.push('En fil med ustøttet navn/type ble utelatt.');continue;}if(typeof f.data!=='string'||f.data.length%4!==0||!/^[a-zA-Z0-9+/]*={0,2}$/.test(f.data))throw new HttpError(400,'Ugyldig fil fra Python.');const data=Buffer.from(f.data,'base64');bytes+=data.length;if(data.length>PYTHON_LIMITS.fileBytes||bytes>PYTHON_LIMITS.totalBytes)throw new HttpError(413,'Python-filene er for store.');out.push({name,mime:DOCUMENT_TYPES[path.extname(name).slice(1).toLowerCase()],data});}
  if(reply.documents.length&&!documents)throw new HttpError(403,'Dokumentgeneratoren er slått av i denne chatten.');
  for(const request of reply.documents){signal.throwIfAborted();out.push(await createDocument(request));}
  signal.throwIfAborted();
  const published=this.publish(id,scope,out);return {files:published,isError:!!reply.error,text:[reply.output,reply.error??'',...warnings,published.length?`${published.length} fil(er) klare for nedlasting.\n${JSON.stringify({files:published})}`:'Ingen nye filer.'].filter(Boolean).join('\n')};
 });}
 remove(id:string){if(ID.test(id))rmSync(this.dir(id),{recursive:true,force:true});}
 close(){this.closed=true;this.probe.abort();for(const c of this.controllers)c.abort();for(const t of this.store.threads())if(t.temporary)this.remove(t.id);if(existsSync(this.root))for(const id of readdirSync(this.root))if(ID.test(id)&&!this.store.thread(id))this.remove(id);}
}
