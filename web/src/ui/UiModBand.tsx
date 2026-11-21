import { language } from "../lib/i18n.ts";
import {createSignal,createEffect,For,onCleanup,type Accessor} from 'solid-js';
import type {UiMod} from '../../../shared/ui-mods';
import type {Usage} from '../../../shared/protocol';
import {formatTokens} from '../lib/format';
export function UiModBand(props:{mod:UiMod;workspace:string;usage:Accessor<Usage|null>}){
 const [now,setNow]=createSignal(new Date());createEffect(()=>{if(!props.mod.widgets.some(w=>w.kind==='clock'))return;const timer=setInterval(()=>setNow(new Date()),60000);onCleanup(()=>clearInterval(timer));});
 const value=(kind:string,text:string)=>kind==='clock'?now().toLocaleTimeString(language(),{hour:'2-digit',minute:'2-digit'}):kind==='workspace'?props.workspace:kind==='usage'?(props.usage()?formatTokens(props.usage()!.inputTokens+props.usage()!.outputTokens)+' tokens · siste tur':'Ingen tokenbruk ennå'):text;
 return <div class="ui-mod-band" data-testid="mod-widgets"><For each={props.mod.widgets}>{w=><div><strong>{w.label||({clock:'Klokke',workspace:'Arbeidsområde',usage:'Tokenbruk',note:'Notat'}[w.kind])}</strong><span>{value(w.kind,w.text)}</span></div>}</For></div>;
}
