import { localizedFormat } from "../lib/i18n.ts";
import {createSignal, Show, createUniqueId} from 'solid-js';
import {Portal} from 'solid-js/web';
import type {JSX} from 'solid-js';
const dateFormat=localizedFormat(locale => new Intl.DateTimeFormat(locale,{weekday:'long',day:'numeric',month:'long',year:'numeric'}));
const numberFormat=localizedFormat(locale => new Intl.NumberFormat(locale));
export function tokenDate(date:string){return dateFormat.format(new Date(date+'T12:00:00'));}
// No delay or per-cell timer. Text is formatted only when the pointed cell changes.
export function useTokenTooltip(){
 const id=createUniqueId();const [info,setInfo]=createSignal<{date:string;tokens:number;weekly?:boolean}|null>(null);const [point,setPoint]=createSignal({x:0,y:0});
 const place=(x:number,y:number)=>setPoint({x:Math.min(Math.max(8,x+12),Math.max(8,window.innerWidth-300)),y:Math.min(Math.max(8,y+14),Math.max(8,window.innerHeight-90))});
 const hide=()=>setInfo(null);
 const bind=(date:string,tokens:number,weekly=false,focusable=false):JSX.RectSVGAttributes<SVGRectElement>=>({
  tabIndex:focusable?0:-1,'aria-label':`${weekly?'Uken fra ':''}${tokenDate(date)}: ${numberFormat.format(tokens)} tokens`,'aria-describedby':id,
  onPointerEnter:e=>{setInfo({date,tokens,weekly});place(e.clientX,e.clientY);},onPointerMove:e=>place(e.clientX,e.clientY),onPointerLeave:hide,
  onFocus:e=>{setInfo({date,tokens,weekly});const r=e.currentTarget.getBoundingClientRect();place(r.right,r.bottom);},onBlur:hide,onKeyDown:e=>{if(e.key==='Escape')hide();else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const cells=[...e.currentTarget.closest('svg')!.querySelectorAll<SVGRectElement>('rect')],at=cells.indexOf(e.currentTarget);const next=e.key==='Home'?0:e.key==='End'?cells.length-1:at+({ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[e.key]??0);cells[Math.max(0,Math.min(cells.length-1,next))]?.focus();}}
 });
 const tooltip=()=> <Show when={info()}>{v=><Portal><div id={id} role="tooltip" class="token-tooltip" style={{left:point().x+'px',top:point().y+'px'}} data-testid="token-tooltip"><strong>{v().weekly?'Uken fra ':''}{tokenDate(v().date)}</strong><span>{numberFormat.format(v().tokens)} tokens</span></div></Portal>}</Show>;
 return {bind,tooltip};
}
