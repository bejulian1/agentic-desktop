import {createSignal} from 'solid-js';
import type {UiMod,UiModsState} from '../../../shared/ui-mods';
import type {Mode} from '../../../shared/protocol';
import {get,put,del} from '../lib/api';
import {on,onOpen} from '../lib/socket';
const empty:UiModsState={enabled:true,animated:true,defaults:{chat:null,code:null},threads:{},allowedThreads:[],mods:[],pendingThreads:[],warnings:[],directory:''};
export const [uiMods,setUiMods]=createSignal<UiModsState>(empty);
export const [modTarget,setModTarget]=createSignal<{threadId:string|null;mode:Mode}>({threadId:null,mode:'chat'});
export const [modsOpen,setModsOpen]=createSignal(false);
function accept(state:UiModsState){const old=new Map(uiMods().mods.map(m=>[m.id,m]));setUiMods({...state,mods:state.mods.map(m=>{const prior=old.get(m.id);return prior&&JSON.stringify(prior)===JSON.stringify(m)?prior:m;})});}
on('ui-mods.changed',({state})=>accept(state));
export const refreshUiMods=()=>get<UiModsState>('/api/ui-mods').then(accept);
onOpen(()=>{void refreshUiMods().catch(()=>undefined);});
export function selectedModId(threadId:string|null,mode:Mode):string|null {const s=uiMods();return threadId&&Object.hasOwn(s.threads,threadId)?s.threads[threadId]:s.defaults[mode];}
export function effectiveUiMod(threadId:string|null,mode:Mode):UiMod|undefined {const s=uiMods();return s.enabled?s.mods.find(m=>m.id===selectedModId(threadId,mode)):undefined;}
export async function chooseUiMod(id:string|null,target=modTarget()){if(target.threadId)await put(`/api/ui-mods/threads/${target.threadId}`,{modId:id});else await put('/api/ui-mods/preferences',{defaults:{[target.mode]:id}});await refreshUiMods();}
export async function saveUiMod(mod:UiMod){await put(`/api/ui-mods/library/${mod.id}`,mod);await refreshUiMods();}
export async function deleteUiMod(id:string){await del(`/api/ui-mods/library/${id}`);await refreshUiMods();}
export async function modPreferences(patch:Partial<Pick<UiModsState,'enabled'|'animated'|'defaults'>>){await put('/api/ui-mods/preferences',patch);await refreshUiMods();}
