import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startHarness} from './helpers.ts';
test('Manuell annotering: lokal namespace, eksplisitt fane og validering uten modellverktøy',async t=>{
 const h=await startHarness(t);const calls:Array<[string,string]>=[];
 h.app.browser.annotationSnapshot=async(projectId,tabId)=>{calls.push([projectId,tabId]);return {url:'http://local.test/',pngBase64:'',width:800,height:600,elements:[]};};
 const snap=await h.api('GET','/api/browser/annotation?projectId=local&tabId=t1');assert.equal(snap.width,800);assert.deepEqual(calls,[['local','t1']]);
 assert.equal((await h.raw('GET','/api/browser/annotation?projectId=missing&tabId=t1')).status,404);
 assert.equal((await h.raw('GET','/api/browser/annotation?projectId=local&tabId=bad%2Ftab')).status,400);
 assert.equal((await h.raw('GET','/api/browser/annotation?projectId=local&tabId='+ 't'.repeat(41))).status,400);
 assert.equal(calls.length,1);
});
test('Kodeutseende og ny fane: gyldige verdier lagres og ugyldige avvises',async t=>{
 const h=await startHarness(t);
 const saved=await h.api('PATCH','/api/settings',{panelNewTab:'browser',codeThemeLight:'clear',codeThemeDark:'warm',codeFontCustom:'DejaVu Sans Mono',codeTranscriptView:'detailed'});
 assert.equal(saved.panelNewTab,'browser');assert.equal(saved.codeFontCustom,'DejaVu Sans Mono');
 assert.equal((await h.api('GET','/api/bootstrap')).settings.codeThemeDark,'warm');
 for(const patch of [{panelNewTab:'unknown'},{panelNewTab:null},{codeFontCustom:'x'.repeat(121)},{codeFontCustom:'bad\nfont'},{codeThemeLight:'unknown'},{codeThemeDark:'unknown'},{codeTranscriptView:'unknown'}]){
  assert.equal((await h.raw('PATCH','/api/settings',{headers:{'content-type':'application/json'},body:JSON.stringify(patch)})).status,400);
 }
});
