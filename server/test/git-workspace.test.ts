import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {startHarness,tempDir,until} from './helpers.ts';
import {GitWorkspace} from '../src/git-workspace.ts';
// Explicitly requested Git integration; every Git process is confined to this disposable root.
function fixture(t:any){
 const root=tempDir(t,'ad-git-test-'),repo=path.join(root,'repo with spaces');mkdirSync(repo);
 const git=(folder:string,...args:string[])=>{
  assert.ok(folder.startsWith(root+path.sep),'never run Git in the task checkout');
  const env={...process.env,HOME:root,XDG_CONFIG_HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
  for(const name of Object.keys(env))if(/^GIT_/i.test(name)&&!['GIT_CONFIG_NOSYSTEM','GIT_TERMINAL_PROMPT'].includes(name))delete env[name as keyof typeof env];
  return execFileSync('git',['-c','core.hooksPath=/dev/null','-C',folder,...args],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 };
 git(repo,'init','-b','main');mkdirSync(path.join(repo,'subfolder'));writeFileSync(path.join(repo,'subfolder','demo.txt'),'original\n');git(repo,'add','.');git(repo,'-c','user.name=Test','-c','user.email=test@localhost','commit','-m','initial');
 return {root,repo,git};
}
test('Git API: main, new branch, existing branch and worktree with spaces preserve original changes',async t=>{
 const f=fixture(t),h=await startHarness(t);const p=await h.project(path.join(f.repo,'subfolder'));
 const endpoint=`/api/projects/${p.id}/git`;
 let state=await h.api('GET',`${endpoint}/workspace`);assert.equal(state.branch,'main');assert.equal(state.root,f.repo);assert.equal(state.worktrees[0].branch,'main');
 state=await h.api('POST',`${endpoint}/branch`,{branch:'feature/æøå',create:true});assert.equal(state.branch,'feature/æøå');
 state=await h.api('POST',`${endpoint}/branch`,{branch:'main'});assert.equal(state.branch,'main');
 writeFileSync(path.join(p.path,'demo.txt'),'local change\n');
 await assert.rejects(()=>h.api('POST',`${endpoint}/branch`,{branch:'feature/æøå'}),/409/);
 const result=await h.api('POST',`${endpoint}/worktrees`,{branch:'feature/worktree'});
 assert.equal(result.project.permissionMode,'ask');assert.equal(readFileSync(path.join(result.project.path,'demo.txt'),'utf8'),'original\n');assert.equal(readFileSync(path.join(p.path,'demo.txt'),'utf8'),'local change\n');
 assert.equal(f.git(f.repo,'branch','--show-current'),'main');assert.equal(f.git(result.worktreePath,'branch','--show-current'),'feature/worktree');assert.ok(result.project.path.endsWith('/subfolder'));
 await assert.rejects(()=>h.api('POST',`${endpoint}/branch`,{branch:'feature/worktree'}),/409/);
 const existing=await h.api('POST',`${endpoint}/worktrees`,{branch:'feature/æøå',existing:true,path:path.join(f.root,'existing branch')});
 assert.equal(f.git(existing.worktreePath,'branch','--show-current'),'feature/æøå');
 const open=await h.api('POST',`${endpoint}/worktrees/open`,{path:result.worktreePath});assert.ok(open.path===result.worktreePath);
 await assert.rejects(()=>h.api('POST',`${endpoint}/worktrees/open`,{path:f.root}),/400/);
});
test('Git validates refs, existing directories and initial commit; no implicit stash or overwrite',async t=>{
 const f=fixture(t),h=await startHarness(t),p=await h.project(f.repo),url=`/api/projects/${p.id}/git`;
 for(const branch of ['--force','@{-1}','bad..ref','a.lock','x\nmain'])await assert.rejects(()=>h.api('POST',`${url}/branch`,{branch,create:true}),/400/);
 await assert.rejects(()=>h.api('POST',`${url}/branch`,{branch:'okay',create:true,base:'missing'}),/400/);
 await assert.rejects(()=>h.api('POST',`${url}/worktrees`,{branch:'new',path:f.repo}),/409/);
 const empty=await h.project();assert.equal((await h.api('GET',`/api/projects/${empty.id}/git/workspace`)).repository,false);
 await assert.rejects(()=>h.api('POST',`/api/projects/${empty.id}/git/branch`,{branch:'feature',create:true}),/409/);
 assert.equal(f.git(f.repo,'status','--porcelain'),'');assert.equal(f.git(f.repo,'branch','--show-current'),'main');
});
test('Git worktrees share the model-work guard and concurrent mutations are rejected',async t=>{
 const f=fixture(t),h=await startHarness(t),p=await h.project(f.repo),active:any[]=[];
 const git=new GitWorkspace({dataDir:h.app.config.dataDir,env:()=>Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>typeof e[1]==='string')),activeProjects:()=>active});t.after(()=>git.close());
 const tree=await git.createWorktree(p,{branch:'parallel',path:path.join(f.root,'parallel')});const other=await h.project(tree.path);active.push(other);
 await assert.rejects(()=>git.switchBranch(p,{branch:'blocked',create:true}),/modell jobber/);active.length=0;
 const first=git.switchBranch(p,{branch:'allowed',create:true});await assert.rejects(()=>git.switchBranch(p,{branch:'racing',create:true}),/Git-handling pågår/);await first;
 assert.equal(f.git(f.repo,'branch','--show-current'),'allowed');
 const thread=await h.thread(other.id);await h.api('POST',`/api/threads/${thread.id}/messages`,{text:'',shell:'sleep 30'});await until(()=>h.app.store.thread(thread.id)!.running,'real run waiting for approval');
 await assert.rejects(()=>h.api('POST',`/api/projects/${p.id}/git/branch`,{branch:'blocked-by-related-run',create:true}),/409/);
 await h.api('POST',`/api/threads/${thread.id}/stop`);
});
test('Version history contains all bundled entries without latest-three truncation',async t=>{
 const h=await startHarness(t),all=await h.api('GET','/api/releases'),latest=await h.api('GET','/api/whatsnew');
 assert.ok(all.entries.length>latest.entries.length);assert.ok(all.entries.length>15);assert.ok(all.entries.every((e:any)=>e.body.trim().length>0));assert.equal(all.entries[0].title,latest.entries[0].title);
 assert.ok(all.entries.some((e:any)=>e.title.startsWith('0.5')));
 // Structured for the window: version, name, date and build, and the body as plain blocks.
 const first=all.entries[0],last=all.entries.at(-1);
 assert.match(first.version,/^\d+\.\d+\.\d+$/);assert.ok(first.name&&!first.name.includes('('));assert.match(first.date,/\d{4}$/);
 assert.ok(first.blocks.length>0&&first.blocks.every((b:any)=>['heading','item','text'].includes(b.kind)&&typeof b.text==='string'));
 assert.equal(last.version,null);assert.match(last.name,/^Runde 1/);
});
