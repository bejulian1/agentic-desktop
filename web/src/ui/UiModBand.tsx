import { language, t } from "../lib/i18n";
import {createSignal,createEffect,For,onCleanup,type Accessor} from 'solid-js';
import type {UiMod} from '../../../shared/ui-mods';
import type {Usage} from '../../../shared/protocol';
import {formatTokens} from '../lib/format';
export function UiModBand(props:{mod:UiMod;workspace:string;usage:Accessor<Usage|null>}){
 const [now,setNow]=createSignal(new Date());createEffect(()=>{if(!props.mod.widgets.some(w=>w.kind==='clock'))return;const timer=setInterval(()=>setNow(new Date()),60000);onCleanup(()=>clearInterval(timer));});
 const value=(kind:string,text:string)=>kind==='clock'?now().toLocaleTimeString(language(),{hour:'2-digit',minute:'2-digit'}):kind==='workspace'?props.workspace:kind==='usage'?(props.usage()?t("{count} tokens · siste tur", { count: formatTokens(props.usage()!.inputTokens+props.usage()!.outputTokens) }):t("Ingen tokenbruk ennå")):text;
 return <div class="ui-mod-band" data-testid="mod-widgets"><For each={props.mod.widgets}>{w=><div><strong>{w.label||({clock:t("Klokke"),workspace:t("Arbeidsområde"),usage:t("Tokenbruk"),note:t("Notat")}[w.kind])}</strong><span>{value(w.kind,w.text)}</span></div>}</For></div>;
}
