import { createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import type { GitWorkspaceState, Project } from '../../../shared/protocol';
import { get, post } from '../lib/api';
import { app, currentProject, setApp, setSettingsOpen, toast } from '../state/app';
import { newThreadIn } from '../state/navigate';
import { gitWorkspaceDialog, openGitWorkspace, setGitWorkspaceDialog } from './dialog-state';
import { IconBranch, IconClose, IconFolder, IconPlus, IconReload, IconWorktree } from './icons';
import { Select } from './Select';
import { Group, Page, Rich, Row } from './settings/parts';
import '../styles/git-workspace.css';

import { t } from "../lib/i18n";
export function GitWorkspaceBody(props:{projectId:string;initialWorktree?:boolean;onOpened?:()=>void}){
 let alive=true;onCleanup(()=>{alive=false;});
 const [state,{refetch}]=createResource(()=>props.projectId,id=>get<GitWorkspaceState>(`/api/projects/${id}/git/workspace`));
 const [busy,setBusy]=createSignal(false),[error,setError]=createSignal('');
 const [creating,setCreating]=createSignal(props.initialWorktree?'worktree':''),[branch,setBranch]=createSignal(''),[base,setBase]=createSignal('HEAD'),[folder,setFolder]=createSignal(''),[existing,setExisting]=createSignal(false);
 const [query,setQuery]=createSignal('');
 const project=()=>app.projects[props.projectId];
 const sourceRunning=()=>Object.values(app.threads).some(thread=>thread.projectId===props.projectId&&thread.running);
 const reload=()=>{setError('');void Promise.resolve(refetch()).catch(()=>undefined);};
 const selectProject=async(p:Project)=>{if(!alive)return;setApp('projects',p.id,p);props.onOpened?.();await newThreadIn(p.id,true);toast(t('Åpnet {name}.',{name:p.name}),'info');};
 const changeBranch=async(name:string)=>{
  if(busy())return;setBusy(true);setError('');
  try{await post(`/api/projects/${props.projectId}/git/branch`,{branch:name});if(!alive)return;await refetch();toast(t('Byttet til {name}.',{name}),'info');}
  catch(err){if(alive)setError((err as Error).message);}finally{if(alive)setBusy(false);}
 };
 const create=async(e:SubmitEvent)=>{
  e.preventDefault();if(busy()||!branch().trim())return;setBusy(true);setError('');
  try{
   if(creating()==='worktree'){
    const result=await post<{project:Project}>(`/api/projects/${props.projectId}/git/worktrees`,{branch:branch().trim(),base:base(),...(folder().trim()?{path:folder().trim()}:{}),existing:existing()});
    if(!alive)return;await refetch();setCreating('');await selectProject(result.project);
   }else{await post(`/api/projects/${props.projectId}/git/branch`,{branch:branch().trim(),base:base(),create:true});if(!alive)return;await refetch();setCreating('');toast(t('Opprettet og byttet til {name}.',{name:branch().trim()}),'info');}
  }catch(err){if(alive)setError((err as Error).message);}finally{if(alive)setBusy(false);}
 };
 const openTree=async(path:string)=>{
  if(busy())return;setBusy(true);setError('');
  try{await selectProject(await post<Project>(`/api/projects/${props.projectId}/git/worktrees/open`,{path}));}
  catch(err){if(alive)setError((err as Error).message);}finally{if(alive)setBusy(false);}
 };
 return <div class="git-workspace-body" aria-busy={busy()}>
  <div class="git-workspace-context"><IconFolder size={15}/><span title={project()?.path}>{project()?.path}</span><button type="button" class="icon-button" aria-label={t("Oppfrisk Git-arbeidsområde")} disabled={busy()||state.loading} onClick={reload}><IconReload size={14}/></button></div>
  <Show when={state.loading&&!state()}><p class="muted" role="status">{t("Leser Git-arbeidsområdet…")}</p></Show>
  <Show when={state.error}><p class="field-error" role="alert">{String(state.error?.message??state.error)}</p><button type="button" class="btn" onClick={reload}>{t("Prøv igjen")}</button></Show>
  <Show when={state()}>{s=><>
   <Show when={s().repository} fallback={<p class="muted">{s().message}</p>}>
    <div class="git-workspace-current"><IconBranch size={16}/><strong>{s().branch??t('Frakoblet HEAD')}</strong><Show when={s().dirty}><span class="pill">{t("Lokale endringer")}</span></Show></div>
    <p class="muted git-workspace-help"><Rich text={t("Grenbytte gjelder hele repoet: {root}. Endringer slettes eller stashes ikke automatisk. Arbeidstrær åpnes som egne prosjekter med godkjenning av filendringer som standard.")} parts={{root:<code>{s().root}</code>}}/></p>
    <Show when={!s().hasCommits}><p role="status" class="muted">{t("Repoet trenger en første commit før nye grener og arbeidstrær kan opprettes.")}</p></Show>
    <Show when={sourceRunning()}><p role="status" class="muted">{t("En modell jobber i prosjektet. Vent eller stopp arbeidet før Git-endringer.")}</p></Show>
    <div class="git-workspace-actions">
     <button type="button" class="btn" disabled={busy()||!s().hasCommits||sourceRunning()||s().dirty} onClick={()=>{setCreating('branch');setBranch('');setError('');}}><IconPlus size={14}/>{t('Ny gren')}</button>
     <button type="button" class="btn" disabled={busy()||!s().hasCommits||sourceRunning()} onClick={()=>{setCreating('worktree');setBranch('');setError('');}}><IconWorktree size={14}/>{t('Nytt arbeidstre')}</button>
    </div>
    <Show when={creating()}>
     <form class="git-workspace-form" aria-label={creating()==='worktree'?t('Opprett arbeidstre'):t('Opprett gren')} onSubmit={create}>
      <h3>{creating()==='worktree'?t('Nytt arbeidstre'):t('Ny gren')}</h3>
      <Show when={creating()==='worktree'}><label class="git-use-existing"><input type="checkbox" checked={existing()} disabled={busy()} onChange={e=>{setExisting(e.currentTarget.checked);setBranch('');}}/>{t('Bruk en eksisterende lokal gren')}</label></Show>
      <label><span>{existing()&&creating()==='worktree'?t('Eksisterende gren'):t('Nytt grennavn')}</span><Show when={existing()&&creating()==='worktree'} fallback={<input class="input" aria-label={t("Nytt grennavn")} placeholder={t("For eksempel funksjon/ny-visning")} maxlength="120" value={branch()} disabled={busy()} onInput={e=>setBranch(e.currentTarget.value)}/>}><Select label={t("Eksisterende gren")} value={branch()} options={s().branches.filter(name=>!s().worktrees.some(t=>t.branch===name)).map(name=>({value:name,label:name}))} onChange={setBranch}/></Show></label>
      <Show when={!existing()||creating()!=='worktree'}><label><span>{t("Start fra")}</span><Select label={t("Start fra")} value={base()} options={[{value:'HEAD',label:t('Nåværende commit (HEAD)')},...s().branches.map(name=>({value:name,label:name}))]} onChange={setBase}/></label></Show>
      <Show when={creating()==='worktree'}><label><span>{t("Ny mappe (valgfritt)")}</span><input class="input" aria-label={t("Mappe for arbeidstre")} placeholder={`${s().suggestedParent}/…`} value={folder()} disabled={busy()} onInput={e=>setFolder(e.currentTarget.value)}/></label><p class="muted">{t('Tomt oppretter en ny mappe ved siden av repoet. Bare lagrede commits brukes; lokale, ucommittede endringer blir i originalmappen.')}</p></Show>
      <div class="git-workspace-actions"><button type="button" class="btn" disabled={busy()} onClick={()=>setCreating('')}>{t("Avbryt")}</button><button type="submit" class="btn btn-primary" disabled={busy()||!branch().trim()||sourceRunning()}>{busy()?t('Arbeider…'):creating()==='worktree'?t('Opprett og åpne arbeidstre'):t('Opprett og bytt gren')}</button></div>
     </form>
    </Show>
    <h3>{t("Lokale grener")}</h3><input type="search" class="input" aria-label={t("Filtrer grener")} placeholder={t("Finn en gren…")} value={query()} onInput={e=>setQuery(e.currentTarget.value)}/>
    <div class="git-workspace-branches"><For each={s().branches.filter(name=>name.toLocaleLowerCase().includes(query().toLocaleLowerCase()))} fallback={<p class="muted">{t("Ingen grener å vise.")}</p>}>{name=>{
     const tree=()=>s().worktrees.find(tree=>tree.branch===name);return <button type="button" class="git-branch-row" aria-label={t('Bytt til {name}',{name})} aria-pressed={name===s().branch} disabled={busy()||s().dirty||sourceRunning()||name===s().branch||!!tree()&&tree()!.path!==s().root} onClick={()=>void changeBranch(name)}><IconBranch size={14}/><span>{name}</span><span class="muted">{name===s().branch?t('Aktiv'):tree()?t('I annet arbeidstre'):''}</span></button>;
    }}</For></div>
    <h3>{t("Arbeidstrær")}</h3><div class="git-workspace-trees"><For each={s().worktrees}>{tree=><div class="git-tree-row"><IconWorktree size={15}/><div><strong>{tree.branch??t('Frakoblet HEAD')}</strong><code>{tree.path}</code><Show when={tree.locked||tree.prunable}><span class="muted">{tree.prunable?t('Mappen mangler eller kan ryddes i Git'):t('Låst i Git')}</span></Show></div><button type="button" class="btn btn-small" disabled={busy()||tree.prunable} onClick={()=>void openTree(tree.path)}>{t("Åpne")}</button></div>}</For></div>
   </Show>
  </>}</Show>
  <Show when={error()}><p class="field-error" role="alert">{error()}</p></Show>
 </div>;
}
export function GitWorkspaceHost(){
 const opening=gitWorkspaceDialog()!;let dialog!:HTMLDialogElement;
 const close=()=>setGitWorkspaceDialog(null);
 onMount(()=>dialog.showModal());
 return <dialog ref={dialog} class="dialog git-workspace-dialog" aria-label={t("Grener og arbeidstrær")} onCancel={close}><header><h2>{t("Grener og arbeidstrær")}</h2><button type="button" class="icon-button" aria-label={t("Lukk grener og arbeidstrær")} onClick={close}><IconClose size={17}/></button></header><GitWorkspaceBody projectId={opening.projectId} initialWorktree={opening.worktree} onOpened={close}/></dialog>;
}
export function GitSettings(){
 return <Page title="Git" intro={t("Lokale grener og arbeidstrær for valgt Kode-prosjekt. Ingen commits, push eller sletting skjer automatisk.")}><Show when={currentProject()} fallback={<Group title={t("Velg prosjekt")}><Row label={t("Ingen prosjektmappe er valgt")} text={t("Velg et prosjekt i Kode for å se grener og arbeidstrær.")}/></Group>}>{project=><><Group title={t("Grener og arbeidstrær")}><GitWorkspaceBody projectId={project().id} onOpened={()=>setSettingsOpen(null)}/></Group><Row label={t("Snarvei fra meldingsfeltet")} text={t("Bruk prosjektets tannhjul eller /worktree i Kode.")}><button type="button" class="btn" onClick={()=>openGitWorkspace(project().id,true)}>{t("Åpne arbeidstre-dialog")}</button></Row></>}</Show></Page>;
}
