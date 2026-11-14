import {For} from 'solid-js';
import type {ChatFile} from '../../../shared/protocol';
import {IconFilePlus} from './icons';
export function ChatFileCards(props:{files:ChatFile[]}){
 const valid=()=>props.files.filter(f=>/^[a-f0-9-]{36}$/.test(f.id)&&/^[a-f0-9-]{36}$/.test(f.threadId));
 return <div class="chat-file-cards" aria-label="Filer klare for nedlasting" data-testid="chat-file-cards"><For each={valid()}>{file=><a class="chat-file-card" href={`/api/chat-files/${file.threadId}/${file.id}/download`} download={file.name}><IconFilePlus size={22}/><span><strong>{file.name}</strong><small>{file.bytes<1024?`${file.bytes} B`:`${Math.ceil(file.bytes/1024)} kB`} · Last ned</small></span></a>}</For></div>;
}
