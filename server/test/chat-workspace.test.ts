import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {Store} from '../src/db.ts';
import {ChatWorkspace} from '../src/chat-workspace.ts';
import {createDocument} from '../src/chat-documents.ts';
import {sandboxPython} from '../src/chat-python.ts';
import {tempDir,startHarness} from './helpers.ts';
import {startFakeLlm,sse,openaiText,openaiToolCall} from './fake-llm.ts';
const signal=()=>new AbortController().signal;
test('Chat: ekte Office-filer, beregninger, vedvarende arbeidsfiler og isolert kontekst',async t=>{
 const dir=tempDir(t),store=new Store(dir),workspace=new ChatWorkspace(store,dir);t.after(()=>{workspace.close();store.close();});
 await workspace.ready;assert.equal(workspace.status().available,true,workspace.status().reason);
 const thread=store.createThread(null,'chat',null),other=store.createThread(null,'chat',null);
 for(const input of [
  {name:'rapport.docx',title:'Månedsrapport',sections:[{heading:'Resultater',text:'Ærlig og målbart.',bullets:['Én','To'],table:{headers:['Navn','Verdi'],rows:[['Oslo',42]]}}]},
  {name:'budsjett.xlsx',sheets:[{name:'Budsjett',headers:['Post','Beløp'],rows:[['Én',12],['To',30],['Sum',{formula:'SUM(B2:B3)',result:42}]]}]},
  {name:'presentasjon.pptx',slides:[{title:'Resultater',body:'42 er svaret',bullets:['Første','Andre']}]}]){
  const [file]=await workspace.document(thread.id,input,signal());const {data}=workspace.download(thread.id,file.id);assert.equal(data.subarray(0,2).toString(),'PK');assert.ok(data.length>1000);writeFileSync(path.join(dir,input.name),data);
  assert.throws(()=>workspace.download(other.id,file.id),/Fant ikke/);
 }
 const result=await workspace.python(thread.id,'import csv, statistics\nprint(statistics.mean([2,4,6]))\nwith open("analyse.csv","w") as f: f.write("verdi\\n42\\n")',signal(),()=>{});
 assert.equal(result.isError,false);assert.match(result.text,/4/);assert.match(result.text,/\/api\/chat-files\//);assert.equal(result.files.find(f=>f.name==='analyse.csv')?.mime,'text/csv');
 const next=await workspace.python(thread.id,'print(open("analyse.csv").read()); print("statistics" in globals())',signal(),()=>{});assert.match(next.text,/42/);assert.match(next.text,/False/);
 const office=await workspace.python(thread.id,'from agentic_files import create_document\ncreate_document("beregnet.xlsx", sheets=[{"name":"Svar","headers":["Sum"],"rows":[[sum([12,30])]]}])',signal(),()=>{});assert.equal(office.isError,false);assert.ok(office.files.some(f=>f.name==='beregnet.xlsx'));
 await assert.rejects(workspace.python(other.id,'from agentic_files import create_document\ncreate_document("av.txt",text="skal ikke lagres")',signal(),()=>{},false),/slått av/);assert.equal(workspace.list(other.id).length,0);
 const repeated=await workspace.document(thread.id,{name:'samme.txt',text:'samme'},signal());const again=await workspace.document(thread.id,{name:'samme.txt',text:'samme'},signal());assert.equal(again[0].id,repeated[0].id);
 const project=store.createChatProject('Privat prosjekt');store.setThreadChatProject(thread.id,project.id);assert.equal(workspace.list(thread.id).length,0);
 assert.match((await workspace.python(thread.id,'import os; print(os.path.exists("analyse.csv"))',signal(),()=>{})).text,/False/);
 assert.equal(workspace.list(other.id).length,0);
 // Completed binaries are kept for genuine LibreOffice opening checks outside this test.
});
test('Python: ingen vertsfiler, nøkler, nettverk, prosesser eller skrivbar rot',async t=>{
 const dir=tempDir(t),secret=path.join(dir,'secret.txt');writeFileSync(secret,'TEST-HEMMELIGHET');
 const result=await sandboxPython(`import os, socket, subprocess\nprint(os.environ)\nfor target in [${JSON.stringify(secret)}, '/home', '/etc/passwd']:\n print(target,os.path.exists(target))\nfor action in [lambda: open('/escape.txt','w'), lambda: socket.create_connection(('1.1.1.1',443),0.1), lambda: subprocess.run(['/bin/true'])]:\n try: action(); print('UNSAFE')\n except Exception as e: print(type(e).__name__)`,[],signal());
 assert.doesNotMatch(result.output,/UNSAFE|TEST-HEMMELIGHET|OPENAI_API_KEY/);assert.match(result.output,/PermissionError|OSError|BlockingIOError/);
 const abort=new AbortController();const running=sandboxPython('while True: pass',[],abort.signal);setTimeout(()=>abort.abort(),100);await assert.rejects(running,/Avbrutt/);
 await assert.rejects(sandboxPython('while True: pass',[],signal(),()=>{},150),/Tidsavbrudd/);
 const links=await sandboxPython("import os; os.symlink('/usr/bin/python3','bad.txt'); open('good.txt','w').write('ok')",[],signal());assert.deepEqual(links.files.map(f=>f.name),['good.txt']);
});
test('Chat: filgrenser, ugyldige navn, ekte JSON og midlertidig opprydding',async t=>{
 for(const name of ['../secret.txt','/tmp/file.txt','.hidden.txt','bad.html','a/b.docx'])await assert.rejects(createDocument({name,text:'x'}));
 await assert.rejects(createDocument({name:'bad.json',text:'no'}));
 await assert.rejects(createDocument({name:'bad.xlsx',sheets:[{name:'X',rows:[[{formula:'WEBSERVICE("https://example.com")'}]]}]}));
 const dir=tempDir(t),store=new Store(dir),workspace=new ChatWorkspace(store,dir);await workspace.ready;
 const thread=store.createThread(null,'chat',null);store.markTemporary(thread.id);await workspace.document(thread.id,{name:'notat.md',text:'# Hei'},signal());
 assert.ok(existsSync(path.join(dir,'chat-workspaces',thread.id)));workspace.close();assert.equal(existsSync(path.join(dir,'chat-workspaces',thread.id)),false);store.close();
});
test('Chat: modellverktøy til filkort, autentisert nedlasting og av/på',async t=>{
 const llm=await startFakeLlm(t),h=await startHarness(t);const provider=await h.api('POST','/api/providers',{name:'Lokal test',kind:'openai-compatible',baseUrl:llm.url,apiKey:'test-key'});
 const model=await h.api('POST','/api/models',{providerId:provider.id,name:'Filmodell',model:'test',contextWindow:32000});const thread=await h.thread(null,'chat',model.id);
 llm.reply(sse(openaiToolCall('create_document',{name:'notat.md',text:'# Fra modellen\n42'})));llm.reply(sse(openaiText('Filen er klar.')));
 await h.api('POST',`/api/threads/${thread.id}/messages`,{text:'Lag et notat'});const events=await h.finished(thread.id);const done=events.find(e=>e.type==='tool.finished');assert.ok(done?.type==='tool.finished'&&done.files?.length===1);
 if(done?.type!=='tool.finished')return;const file=done.files![0],response=await h.raw('GET',file.url);assert.equal(response.status,200);assert.equal(response.body,'# Fra modellen\n42');assert.match(response.headers['content-disposition']!,/attachment/);
 assert.equal((await fetch(h.origin+file.url)).status,401,'ingen nedlasting uten autentisering');
 assert.ok(llm.requests[0].body.tools.some((x:any)=>x.function.name==='create_document'));assert.ok(!llm.requests[0].body.tools.some((x:any)=>x.function.name==='run_python'));
 await h.api('PATCH',`/api/threads/${thread.id}`,{chatTools:{documents:false,python:false}});llm.reply(sse(openaiText('Ingen filverktøy nå.')));await h.api('POST',`/api/threads/${thread.id}/messages`,{text:'Hva kan du?'});await h.finished(thread.id,2);
 assert.ok(!llm.requests.at(-1)!.body.tools?.some((x:any)=>x.function.name==='create_document'));
 await h.api('DELETE',`/api/threads/${thread.id}`);assert.equal((await h.raw('GET',file.url)).status,404);
});
