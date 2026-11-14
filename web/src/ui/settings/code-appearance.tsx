import { createSignal, For } from 'solid-js';
import type { CodeFont } from '../../../../shared/protocol';
import { app, setApp } from '../../state/app';
import { patch } from '../../lib/api';
import { Choice, Group, Row, reset, save, Segmented, Toggle } from './parts';

type Palette = 'app' | 'clear' | 'warm' | 'contrast';
const fonts: Array<{value:CodeFont; label:string}> = [
 {value:'system',label:'Systemets monospace'},{value:'ubuntu',label:'Ubuntu Mono'},{value:'dejavu',label:'DejaVu Sans Mono'},
 {value:'jetbrains',label:'JetBrains Mono'},{value:'fira',label:'Fira Code'},{value:'cascadia',label:'Cascadia Code'},
];
const palettes: Array<{value:Palette;label:string}> = [{value:'app',label:'Følg appen'},{value:'clear',label:'Klar'},{value:'warm',label:'Varm'},{value:'contrast',label:'Høy kontrast'}];
function CodePreview(props:{tone:'light'|'dark';palette:Palette}) {
 return <div class="code-settings-preview" data-code-preview={props.tone} data-code-light={props.palette} data-code-dark={props.palette} data-theme={props.tone}>
  <pre><span class="code-preview-line"><i>1</i><span class="tok-keyword">function</span> <span class="tok-function">hils</span>(navn: <span class="tok-typeName">string</span>) {'{'}</span>
   <span class="code-preview-line del"><i>2</i>  <span class="tok-keyword">return</span> <span class="tok-string">"Hei, "</span> + navn;</span>
   <span class="code-preview-line add"><i>2</i>  <span class="tok-keyword">return</span> <span class="tok-string">{'`Hei, ${navn}!`'}</span>;</span>
   <span class="code-preview-line"><i>3</i>{'}'}</span></pre>
 </div>;
}
export function CodeAppearance() {
 const [custom,setCustom]=createSignal(app.settings.codeFontCustom??'');
 const [error,setError]=createSignal('');
 const commit=async()=>{
  const name=custom().trim();if(name===(app.settings.codeFontCustom??''))return;
  if(name.length>120 || /[\u0000-\u001f\u007f]/.test(name))return setError('Bruk et skriftnavn på høyst 120 tegn.');
  try{await patch('/api/settings',{codeFontCustom:name});setApp('settings','codeFontCustom',name);setError('');}
  catch(err){setError((err as Error).message);}
 };
 return <Group title="Kodeutseende">
  <div class="setting setting-block"><div class="setting-text"><strong>Fargetema for kode</strong><span class="muted">Eget lyst og mørkt tema for kodeblokker, filvisning og syntaksfarger. Appens tema styrer hvilken variant som brukes. Skriftvalgene gjelder også kode i Chat og terminalen.</span></div>
   <div class="code-palette-grid"><For each={['light','dark'] as const}>{tone=>{const value=()=>tone==='light' ? app.settings.codeThemeLight??'app' : app.settings.codeThemeDark??'app';return <div>
    <Choice<Palette> label={tone==='light'?'Lyst kodetema':'Mørkt kodetema'} value={value()} options={palettes} onChange={v=>save(tone==='light'?{codeThemeLight:v}:{codeThemeDark:v})}/>
    <CodePreview tone={tone} palette={value()}/>
   </div>;}}</For></div>
  </div>
  <Row label="Kodeskrift" text="Velg en installert skrift. Systemets monospace brukes som reserve."><Choice<CodeFont> label="Kodeskrift" value={app.settings.codeFont??'system'} options={fonts} onChange={v=>{setCustom('');save({codeFont:v,codeFontCustom:''});}}/></Row>
  <Row label="Egen kodeskrift" text="Skriv navnet på en skrift som finnes på maskinen. Tomt følger valget over. Ingen skrift lastes ned."><div><input class="input" aria-label="Egen kodeskrift" placeholder="For eksempel JetBrains Mono" maxlength="120" value={custom()} onInput={e=>setCustom(e.currentTarget.value)} onBlur={()=>void commit()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void commit();}}}/><span class="field-error" role={error()?'alert':undefined}>{error()}</span></div></Row>
  <Row label="Skriftstørrelse for kode" text="Kodeblokker, filvisning, differanser, kommandoutdata og terminal."><Choice<number> label="Skriftstørrelse for kode" value={app.settings.codeFontSize??0} options={[{value:0,label:"Standard"},...[11,12,13,14,15,16,17,18].map(n=>({value:n,label:`${n} px`}))]} onChange={v=>v===0?reset("codeFontSize"):save({codeFontSize:v})}/></Row>
  <Row label="Tabulatorbredde" text="Visningsbredden på tabulatortegn i kode."><Segmented<number> label="Tabulatorbredde" value={app.settings.tabSize??4} options={[2,4,8].map(n=>({value:n,label:String(n)}))} onChange={v=>save({tabSize:v})}/></Row>
  <Toggle label="Bryt lange linjer" text="Bryt lange linjer i kodeblokker fremfor å rulle sidelengs." checked={app.settings.wrapCode??false} onChange={v=>save({wrapCode:v})}/>
 </Group>;
}
