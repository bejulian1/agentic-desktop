import type {UiMod} from '../../../shared/ui-mods';
import {contrast} from '../../../shared/ui-mods';
export function modVariables(mod:UiMod):Record<string,string>{
 const p=mod.palette,dark=mod.scheme==='dark';
 const vars:Record<string,string>={'--bg':p.background,'--bg-sidebar':p.panel,'--bg-panel':p.panel,'--surface':p.panel,'--surface-2':p.surface,'--surface-3':p.surface,'--text':p.text,'--text-2':p.text,'--text-3':p.muted,'--text-4':p.muted,'--accent':p.accent,'--accent-text':p.accent,'--accent-soft':p.accent+'20','--accent-fg':contrast(p.accent,'#101820')>contrast(p.accent,'#ffffff')?'#101820':'#ffffff','--border':p.text+'22','--border-strong':p.text+'44','--hover':p.text+'12','--active':p.accent+'22','--selection':p.accent+'40','--code-bg':p.panel,'--code-fg':p.text,'--tok-keyword':p.keyword,'--tok-string':p.string,'--tok-number':p.number,'--tok-function':p.function,'--tok-type':p.function,'--tok-comment':p.comment,'--tok-prop':p.text,'--tok-meta':p.muted,'--ok':dark?'#7ed9a6':'#246545','--danger':dark?'#f7a29f':'#ad3636','--warn':dark?'#efd18b':'#855311','--add-text':dark?'#9cddb6':'#246545','--del-text':dark?'#f4aaa4':'#ad3636','--add-bg':dark?'#204337':'#e2f1e7','--del-bg':dark?'#4a2d36':'#f8e4e4','--content-max':mod.layout.contentWidth+'px','--ui-mod-radius':mod.layout.radius+'px'};
 return vars;
}
