import { createSignal, For } from 'solid-js';
import type { CodeFont } from '../../../../shared/protocol';
import { app, setApp } from '../../state/app';
import { patch } from '../../lib/api';
import { Choice, Group, Row, reset, save, Segmented, Toggle } from './parts';

import { t } from '../../lib/i18n';
type Palette = 'app' | 'clear' | 'warm' | 'contrast';
// Functions, so the labels follow the active language.
export const codeFonts = (): Array<{value:CodeFont; label:string}> => [
 {value:'system',label:t('Systemets monospace')},{value:'jetbrains',label:'JetBrains Mono'},{value:'fira',label:'Fira Code'},
 {value:'liberation',label:'Liberation Mono'},{value:'dejavu',label:'DejaVu Sans Mono'},{value:'ubuntu',label:'Ubuntu Mono'},{value:'cascadia',label:'Cascadia Code'},
];
const codeSizes = () => [{value:0,label:t("Standard")},...[11,12,13,14,15,16,17,18].map(n=>({value:n,label:`${n} px`}))];
// v1.3.0: the code font and its size side by side, as in T3 Code's Typografi. Used here and in Utseende.
export function MonoFontControls(props:{onFont?:()=>void}) {
 return <div class="font-pair">
  <Choice<CodeFont> label={t("Kodeskrift")} value={app.settings.codeFont??'system'} options={codeFonts()} onChange={v=>{props.onFont?.();save({codeFont:v,codeFontCustom:''});}}/>
  <Choice<number> label={t("Skriftstørrelse for kode")} value={app.settings.codeFontSize??0} options={codeSizes()} onChange={v=>v===0?reset("codeFontSize"):save({codeFontSize:v})}/>
 </div>;
}
const palettes = (): Array<{value:Palette;label:string}> => [{value:'app',label:t('Følg appen')},{value:'clear',label:t('Klar')},{value:'warm',label:t('Varm')},{value:'contrast',label:t('Høy kontrast')}];
function CodePreview(props:{tone:'light'|'dark';palette:Palette}) {
 return <div class="code-settings-preview" data-code-preview={props.tone} data-code-light={props.palette} data-code-dark={props.palette} data-theme={props.tone}>
  <pre><span class="code-preview-line"><i>1</i><span class="tok-keyword">function</span> <span class="tok-function">hils</span>(navn: <span class="tok-typeName">string</span>) {'{'}</span>
   <span class="code-preview-line del"><i>2</i>  <span class="tok-keyword">return</span> <span class="tok-string">"Hei, "</span> + navn;</span>
   <span class="code-preview-line add"><i>2</i>  <span class="tok-keyword">return</span> <span class="tok-string">{'`Hei, ${navn}!`'}</span>;</span>
   <span class="code-preview-line"><i>3</i>{'}'}</span></pre>
 </div>;
}
// v1.2.0: what code looks like with the choices below, in the app's own colours: a diff and a
// terminal. The font, the size, the tab width and the wrapping follow the settings at once.
export function CodeLivePreview(props:{bare?:boolean}) {
 const grid = <div class="code-live-grid" data-testid={props.bare?"code-live-preview":undefined}>
   <div class="code-live-block" data-kind="diff">
    <div class="code-live-head"><span>{t("Endringer")}</span><span class="code-live-file">src/greet.ts</span></div>
    <pre aria-label={t("Eksempel på en endring")}><span class="code-preview-line"><i>1</i><span class="tok-keyword">export function</span> <span class="tok-function">hils</span>(navn: <span class="tok-typeName">string</span>) {'{'}</span>
<span class="code-preview-line del"><i>2</i>{'\t'}<span class="tok-keyword">return</span> <span class="tok-string">"Hei, "</span> + navn;</span>
<span class="code-preview-line add"><i>2</i>{'\t'}<span class="tok-keyword">return</span> <span class="tok-string">{'`Hei, ${navn}! Dette er en lang linje som viser hvordan linjebryting virker.`'}</span>;</span>
<span class="code-preview-line"><i>3</i>{'}'}</span></pre>
   </div>
   <div class="code-live-block" data-kind="terminal">
    <div class="code-live-head"><span>{t("Terminal")}</span></div>
    <pre aria-label={t("Eksempel på terminalutdata")}><span class="code-preview-line"><span class="tok-function">$</span> npm test</span>
<span class="code-preview-line"><span class="code-live-ok">✔</span> hils returnerer en hilsen <span class="tok-comment">(3 ms)</span></span>
<span class="code-preview-line"><span class="code-live-fail">✖</span> hils uten navn <span class="tok-comment">(1 ms)</span></span>
<span class="code-preview-line tok-comment">ℹ tests 2, pass 1, fail 1</span></pre>
   </div>
  </div>;
 if(props.bare)return grid;
 return <div class="setting setting-block code-live" data-testid="code-live-preview">
  <div class="setting-text"><strong>{t("Forhåndsvisning av kode")}</strong><span class="muted">{t("Viser skrift, størrelse, tabulatorbredde og linjebryting slik du har valgt dem.")}</span></div>
  {grid}
 </div>;
}

export function CodeAppearance() {
 const [custom,setCustom]=createSignal(app.settings.codeFontCustom??'');
 const [error,setError]=createSignal('');
 const commit=async()=>{
  const name=custom().trim();if(name===(app.settings.codeFontCustom??''))return;
  if(name.length>120 || /[\u0000-\u001f\u007f]/.test(name))return setError(t('Bruk et skriftnavn på høyst 120 tegn.'));
  try{await patch('/api/settings',{codeFontCustom:name});setApp('settings','codeFontCustom',name);setError('');}
  catch(err){setError((err as Error).message);}
 };
 return <Group title={t("Kodeutseende")}>
  <div class="setting setting-block"><div class="setting-text"><strong>{t("Fargetema for kode")}</strong><span class="muted">{t("Eget lyst og mørkt tema for kodeblokker, filvisning og syntaksfarger. Appens tema styrer hvilken variant som brukes. Skriftvalgene gjelder også kode i Chat og terminalen.")}</span></div>
   <div class="code-palette-grid"><For each={['light','dark'] as const}>{tone=>{const value=()=>tone==='light' ? app.settings.codeThemeLight??'app' : app.settings.codeThemeDark??'app';return <div>
    <Choice<Palette> label={tone==='light'?t('Lyst kodetema'):t('Mørkt kodetema')} value={value()} options={palettes()} onChange={v=>save(tone==='light'?{codeThemeLight:v}:{codeThemeDark:v})}/>
    <CodePreview tone={tone} palette={value()}/>
   </div>;}}</For></div>
  </div>
  <CodeLivePreview/>
  <Row label={t("Skrift for kode")} text={t("Kodeblokker, filvisning, differanser, kommandoutdata og terminal. Velg en installert skrift; systemets monospace brukes som reserve.")}><MonoFontControls onFont={()=>setCustom('')}/></Row>
  <Row label={t("Egen kodeskrift")} text={t("Skriv navnet på en skrift som finnes på maskinen. Tomt følger valget over. Ingen skrift lastes ned.")}><div><input class="input" aria-label={t("Egen kodeskrift")} placeholder={t("For eksempel JetBrains Mono")} maxlength="120" value={custom()} onInput={e=>setCustom(e.currentTarget.value)} onBlur={()=>void commit()} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void commit();}}}/><span class="field-error" role={error()?'alert':undefined}>{error()}</span></div></Row>
  <Row label={t("Tabulatorbredde")} text={t("Visningsbredden på tabulatortegn i kode.")}><Segmented<number> label={t("Tabulatorbredde")} value={app.settings.tabSize??4} options={[2,4,8].map(n=>({value:n,label:String(n)}))} onChange={v=>save({tabSize:v})}/></Row>
  <Toggle label={t("Bryt lange linjer")} text={t("Bryt lange linjer i kodeblokker fremfor å rulle sidelengs.")} checked={app.settings.wrapCode??false} onChange={v=>save({wrapCode:v})}/>
 </Group>;
}
