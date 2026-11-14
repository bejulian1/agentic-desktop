import {createSignal,Show} from 'solid-js';
import {post,del} from '../../lib/api';
import {modPreferences,refreshUiMods,uiMods,wallpaperPreferences} from '../../state/ui-mods';
import {Group,Row} from './parts';

// Decode and resize on this device. These bytes have a separate local endpoint and are never
// attached to the conversation or included in a provider request.
async function prepare(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Velg et PNG-, JPEG- eller WebP-bilde.');
 if(file.size>12*1024*1024)throw Error('Originalbildet kan være maks 12 MB.');
 const image=await createImageBitmap(file);
 try{
  const scale=Math.min(1,2560/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Kunne ikke behandle bildet.');ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Kunne ikke behandle bildet.')),'image/webp',0.88));
  if(blob.size>3*1024*1024)throw Error('Bildet er fortsatt for stort. Prøv et mindre bilde.');
  const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Kunne ikke lese bildet.'));r.readAsDataURL(blob);});
  return {name:file.name,mime:blob.type,data};
 }finally{image.close();}
}
export function WallpaperSettings(){
 let picker!:HTMLInputElement;const [busy,setBusy]=createSignal(false),[error,setError]=createSignal('');
 const run=async(fn:()=>Promise<unknown>)=>{if(busy())return;setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const wallpaper=()=>uiMods().wallpaper;
 return <Group title="Bakgrunn og glassflater">
  <Row label="Bakgrunnsbilde" text="Et felles bakgrunnsbilde for hele appen, i både Chat og Kode. Lagres lokalt og sendes ikke til modellen. Samtaletemaer kan ha sin egen bakgrunn.">
   <input ref={picker} class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Last opp bakgrunnsbilde" disabled={busy()} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void run(async()=>{await post('/api/appearance/wallpaper',await prepare(file));await refreshUiMods();});}}/>
   <button class="btn btn-small" disabled={busy()} onClick={()=>picker.click()}>{busy()?'Behandler…':wallpaper()?'Bytt bilde':'Velg bilde'}</button>
   <Show when={wallpaper()}><button class="btn btn-small btn-quiet" disabled={busy()} onClick={()=>void run(async()=>{await del('/api/appearance/wallpaper');await refreshUiMods();})}>Fjern bilde</button></Show>
  </Row>
  <Show when={wallpaper()}>{image=><>
   <div class="wallpaper-preview"><img src={`/api/appearance/wallpaper/${image().id}`} alt="Forhåndsvisning av bakgrunnsbildet"/><span>{image().name}</span></div>
   <Row label="Bildestyrke" text="Demp bildet for roligere paneler og tydelig tekst."><label class="wallpaper-range"><input type="range" aria-label="Bildestyrke" min="0" max="1" step="0.05" value={image().opacity} disabled={busy()} onChange={e=>void run(()=>wallpaperPreferences({opacity:e.currentTarget.valueAsNumber}))}/><output>{Math.round(image().opacity*100)} %</output></label></Row>
   <Row label="Uskarp bakgrunn" text="Myker opp bildet uten å endre originalfilen."><label class="wallpaper-range"><input type="range" aria-label="Uskarp bakgrunn" min="0" max="16" step="1" value={image().blur} disabled={busy()} onChange={e=>void run(()=>wallpaperPreferences({blur:e.currentTarget.valueAsNumber}))}/><output>{image().blur} px</output></label></Row>
  </>}</Show>
  <Row as="label" label="Uskarp glassbakgrunn" text="Hele bakgrunnen bak samtalen blir uskarp og dempet når et bakgrunnsbilde eller samtaletema vises, så teksten kan stå uten egne flater. Gjelder både Chat og Kode."><input type="checkbox" role="switch" class="switch" checked={uiMods().glass!==false} disabled={busy()} onChange={e=>void run(()=>modPreferences({glass:e.currentTarget.checked}))}/></Row>
  <Show when={error()}><p class="field-error wallpaper-error" role="alert">{error()}</p></Show>
 </Group>;
}
