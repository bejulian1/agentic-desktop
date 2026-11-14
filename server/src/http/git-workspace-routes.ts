import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Project } from '../../../shared/protocol.ts';
import {cleanName} from '../names.ts';
import {HttpError} from '../errors.ts';
import {guardProjectRoot,isInside} from '../paths.ts';
import type {GitWorkspace} from '../git-workspace.ts';
import type {ApiDeps} from './api.ts';
type Route=(method:string,spec:string,handler:(ctx:{params:Record<string,string>;body:any})=>unknown)=>void;
export function gitWorkspaceRoutes(route:Route,deps:ApiDeps,git:GitWorkspace,project:(id:string)=>Project,invalidate:(id:string)=>void):void{
 const changed=(root:string)=>{
  for(const p of deps.store.projects())if(isInside(root,p.path)){
   invalidate(p.id);deps.publish({type:'git.changed',projectId:p.id});deps.publish({type:'project.files-changed',projectId:p.id,paths:['.']});
  }
 };
 route('GET','/api/projects/:id/git/workspace',({params})=>git.status(project(params.id)));
 route('POST','/api/projects/:id/git/branch',async({params,body})=>{
  const state=await git.switchBranch(project(params.id),{branch:body.branch,create:body.create===true,base:body.base});changed(state.root);return state;
 });
 route('POST','/api/projects/:id/git/worktrees',async({params,body})=>{
  const source=project(params.id);
  const result=await git.createWorktree(source,{branch:body.branch,path:body.path,base:body.base,existing:body.existing===true});
  const relative=path.relative(result.state.root,source.path), candidate=path.join(result.path,relative);
  const target=guardProjectRoot(existsSync(candidate)&&statSync(candidate).isDirectory()?candidate:result.path,deps.dataDir);
  try{
   const created=deps.store.projectByPath(target)??deps.store.createProject(cleanName(`${source.name} · ${body.branch}`),target,'ask');
   deps.publish({type:'project.changed',project:created});changed(result.state.root);
   return {project:created,state:result.state,worktreePath:result.path};
  }catch{throw new HttpError(500,`Arbeidstreet er opprettet i ${result.path}, men kunne ikke legges til som prosjekt. Åpne mappen manuelt.`);}
 });
 route('POST','/api/projects/:id/git/worktrees/open',async({params,body})=>{
  const source=project(params.id),state=await git.status(source);
  if(typeof body.path!=='string'||!state.worktrees.some(tree=>tree.path===body.path&&!tree.prunable))throw new HttpError(400,'Velg et arbeidstre fra listen');
  const target=guardProjectRoot(body.path,deps.dataDir);
  if(!existsSync(target)||!statSync(target).isDirectory())throw new HttpError(404,'Arbeidstreet finnes ikke lenger');
  const created=deps.store.projectByPath(target)??deps.store.createProject(cleanName(`${source.name} · ${path.basename(target)}`),target,'ask');
  deps.publish({type:'project.changed',project:created});return created;
 });
}
