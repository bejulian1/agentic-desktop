import {createEffect,onCleanup,onMount} from 'solid-js';
import type {ModScene,PixelLayer} from '../../../shared/ui-mods';
import {uiMods} from '../state/ui-mods';
import {app,settingsOpen} from '../state/app';
const W=320,H=180;
const sprites=new WeakMap<PixelLayer,HTMLCanvasElement>();
function random(seed:number){let v=seed|0;return ()=>{v=(Math.imul(v,1664525)+1013904223)|0;return (v>>>0)/4294967296;};}
function layer(ctx:CanvasRenderingContext2D,l:PixelLayer,time:number){const phase=time/l.period*Math.PI*2,dx=l.motion==='drift'?Math.sin(phase)*l.amplitude:0,dy=l.motion==='float'?Math.sin(phase)*l.amplitude:0;ctx.save();ctx.translate(Math.round(l.x+dx),Math.round(l.y+dy));ctx.fillStyle=l.color;if(l.motion==='twinkle')ctx.globalAlpha=.45+.55*(Math.sin(phase)+1)/2;
 if(l.kind==='rect')ctx.fillRect(0,0,l.width,l.height);
 if(l.kind==='ellipse'){ctx.beginPath();ctx.ellipse(l.width/2,l.height/2,l.width/2,l.height/2,0,0,Math.PI*2);ctx.fill();}
 if(l.kind==='polygon'&&l.points?.length){ctx.beginPath();l.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
 if(l.kind==='sprite'&&l.pixels){let sprite=sprites.get(l);if(!sprite){sprite=document.createElement('canvas');sprite.width=Math.max(1,...l.pixels.map(r=>r.length));sprite.height=l.pixels.length;const pixels=sprite.getContext('2d')!;l.pixels.forEach((row,y)=>[...row].forEach((p,x)=>{if(p!=='.'){pixels.fillStyle=l.palette![p];pixels.fillRect(x,y,1,1);}}));sprites.set(l,sprite);}ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,0,0,l.width,l.height);}ctx.restore();}
export function drawModScene(ctx:CanvasRenderingContext2D,s:ModScene,time:number){
 const rng=random(s.seed),t=time*s.speed;ctx.globalAlpha=1;ctx.clearRect(0,0,W,H);const sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,s.sky);sky.addColorStop(1,s.horizon);ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 for(let i=0;i<s.stars;i++){const x=Math.floor(rng()*W),y=Math.floor(rng()*H*.78),phase=rng()*6;ctx.globalAlpha=.35+.65*(Math.sin(t*.6+phase)+1)/2;ctx.fillStyle=s.star;const size=rng()>.93?2:1;ctx.fillRect(x,y,size,size);}ctx.globalAlpha=1;
 if(s.preset==='aurora'){for(let band=0;band<3;band++){for(let x=0;x<W;x+=2){const wave=Math.sin(x*.022+t*.35+band)*12+Math.sin(x*.038-t*.18)*6,y=25+wave+band*14;ctx.fillStyle=band===1?s.effect2:s.effect;for(let z=0;z<30;z+=2){ctx.globalAlpha=(1-z/30)*.13*s.intensity;ctx.fillRect(x,Math.round(y+z),2,4);}}}ctx.globalAlpha=1;}
 if(s.preset==='stargazer'||s.preset==='ocean'){ctx.fillStyle=s.star;ctx.beginPath();ctx.ellipse(67,39,12,12,0,0,7);ctx.fill();ctx.globalAlpha=.12;ctx.beginPath();ctx.ellipse(67,39,17,17,0,0,7);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle=s.horizon;ctx.fillRect(64,34,3,3);ctx.fillRect(70,42,2,3);}
 if(s.preset!=='custom'&&s.preset!=='none'&&s.preset!=='ocean'){for(let depth=0;depth<2;depth++){ctx.fillStyle=depth?s.front:s.back;ctx.beginPath();ctx.moveTo(0,H);for(let x=0;x<=W;x+=3){const y=128+depth*24+Math.sin(x*.027+depth*3)*11+Math.sin(x*.071+2)*5;ctx.lineTo(x,Math.round(y));}ctx.lineTo(W,H);ctx.fill();}}
 if(s.preset==='forest'){for(let i=0;i<22;i++){const x=Math.floor(rng()*W),height=20+rng()*35,y=H-10-rng()*20;ctx.fillStyle=s.front;ctx.fillRect(x,y-height,2,height);for(let d=0;d<3;d++){ctx.beginPath();ctx.moveTo(x+1,y-height+d*9);ctx.lineTo(x-10+d*2,y-height+20+d*6);ctx.lineTo(x+12-d*2,y-height+20+d*6);ctx.fill();}}}
 if(s.preset==='ocean'){ctx.fillStyle=s.front;ctx.fillRect(0,105,W,H);for(let y=108;y<H;y+=5){for(let x=0;x<W;x+=8){ctx.fillStyle=(x+y)%3?s.effect:s.effect2;ctx.globalAlpha=.15+s.intensity*.25;ctx.fillRect(Math.round(x+Math.sin(t*.5+y*.2)*4),y,3+Math.sin(x*.1+t+y)*2,1);}}ctx.globalAlpha=1;}
 if(s.preset==='stargazer'){for(let x=0;x<W;x+=3){ctx.fillStyle=x%2?s.front:s.effect;ctx.globalAlpha=.55;ctx.fillRect(x,H-6-rng()*8,1,12);}for(let i=0;i<14;i++){const x=rng()*W,y=150+rng()*25;ctx.fillStyle=s.effect2;ctx.globalAlpha=.15+.6*(Math.sin(t*.5+i)+1)/2;ctx.fillRect(Math.floor(x+Math.sin(t*.2+i)*2),Math.floor(y+Math.sin(t*.3+i)*2),1,1);}ctx.globalAlpha=1;}
 for(const item of s.layers)layer(ctx,item,t);ctx.globalAlpha=1;
}
export default function UiModBackdrop(props:{scene:ModScene}){
 let canvas!:HTMLCanvasElement,visible=true,raf=0,last=0,time=0,previous:ModScene|undefined;const media=matchMedia('(prefers-reduced-motion: reduce)');
 const stop=()=>{cancelAnimationFrame(raf);raf=0;};
 const paint=(now:number)=>{raf=0;if(document.hidden||!visible)return;if(now-last>=1000/24){time+=(now-last)/1000;drawModScene(canvas.getContext('2d')!,props.scene,time);last=now;}raf=requestAnimationFrame(paint);};
 const update=()=>{stop();last=performance.now();drawModScene(canvas.getContext('2d')!,props.scene,time);if(props.scene.animated&&props.scene.speed>0&&uiMods().animated&&!app.settings.reduceMotion&&!media.matches&&!document.hidden&&visible&&!settingsOpen())raf=requestAnimationFrame(paint);};
 onMount(()=>{const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??false;update();});observer.observe(canvas);document.addEventListener('visibilitychange',update);media.addEventListener('change',update);onCleanup(()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);media.removeEventListener('change',update);stop();});});
 createEffect(()=>{if(previous!==props.scene){previous=props.scene;time=0;}uiMods().animated;app.settings.reduceMotion;settingsOpen();if(canvas)update();});
 return <canvas ref={canvas} width={W} height={H} class="ui-mod-backdrop" aria-hidden="true" data-testid="mod-backdrop" style={{opacity:props.scene.intensity}}/>;
}
