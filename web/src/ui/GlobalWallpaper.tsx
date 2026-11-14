import {createEffect,onCleanup,Show} from 'solid-js';
import {uiMods} from '../state/ui-mods';
export function GlobalWallpaper(){
 const wallpaper=()=>uiMods().wallpaper;
 createEffect(()=>{if(!wallpaper())return;document.documentElement.dataset.wallpaper='';onCleanup(()=>delete document.documentElement.dataset.wallpaper);});
 return <Show when={wallpaper()}>{image=><div class="global-wallpaper" data-testid="global-wallpaper" aria-hidden="true" style={{'background-image':`url("/api/appearance/wallpaper/${image().id}")`,opacity:image().opacity,filter:image().blur?`blur(${image().blur}px)`:undefined}}/>}</Show>;
}
