import {createEffect,onCleanup,type Accessor} from 'solid-js';
import type {Mode} from '../../../shared/protocol';
import {effectiveUiMod,setModTarget} from '../state/ui-mods';
import {modVariables} from '../lib/ui-mod-theme';
import {setThemeOverride} from '../lib/theme';
export function UiModRoot(props:{threadId:Accessor<string|null>;mode:Accessor<Mode>}){
 createEffect(()=>{setModTarget({threadId:props.threadId(),mode:props.mode()});const mod=effectiveUiMod(props.threadId(),props.mode());if(!mod)return;
  const root=document.documentElement,vars=modVariables(mod),previous=new Map(Object.keys(vars).map(k=>[k,root.style.getPropertyValue(k)]));
  for(const [key,value]of Object.entries(vars))root.style.setProperty(key,value);root.dataset.uiMod=mod.id;setThemeOverride(mod.scheme);
  onCleanup(()=>{for(const [key,value]of previous)if(value)root.style.setProperty(key,value);else root.style.removeProperty(key);delete root.dataset.uiMod;setThemeOverride(null);});
 });return null;
}
