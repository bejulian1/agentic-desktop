// Python sees an empty, read-only root, runtime libraries and bounded tmpfs mounts only.
// Files enter/leave as bounded byte payloads; no writable host folder is ever mounted.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
export interface PythonPayloadFile {name:string;data:string}
export interface PythonReply {files:PythonPayloadFile[];documents:any[];error?:string;output:string}
export const PYTHON_LIMITS={wallMs:30000,codeChars:60000,fileBytes:10*1024*1024,totalBytes:20*1024*1024,memoryBytes:512*1024*1024};
const SCRIPT=String.raw`
import sys, os, json, base64, io, traceback, resource, types, pathlib, stat
payload=json.load(sys.stdin)
raw=sys.stdout
send=lambda v: (raw.write(json.dumps(v,ensure_ascii=True)+'\n'),raw.flush())
for f in payload.get('files',[]):
    with open('/work/'+f['name'],'wb') as out: out.write(base64.b64decode(f['data']))
original={f['name']:f['data'] for f in payload.get('files',[])}
requests=[]
def document(name, **data):
    requests.append(dict(data,name=name))
    if len(requests)>10: raise ValueError('Maks 10 dokumenter per kjøring')
helper=types.ModuleType('agentic_files'); helper.create_document=document;sys.modules['agentic_files']=helper
class Output(io.TextIOBase):
    def write(self,s):
        if s: send(dict(type='output',text=str(s)))
        return len(s)
    def flush(self): pass
sys.stdout=Output();sys.stderr=Output()
resource.setrlimit(resource.RLIMIT_AS,(${PYTHON_LIMITS.memoryBytes},${PYTHON_LIMITS.memoryBytes}))
resource.setrlimit(resource.RLIMIT_CPU,(20,21))
resource.setrlimit(resource.RLIMIT_FSIZE,(${PYTHON_LIMITS.fileBytes},${PYTHON_LIMITS.fileBytes}))
resource.setrlimit(resource.RLIMIT_NPROC,(0,0))
resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
error=None
try: exec(compile(payload['code'],'<chat>','exec'),dict(__name__='__main__'))
except BaseException: error=traceback.format_exc(limit=8)[-6000:];send(dict(type='error',text=error))
# Send only regular top-level output files. Names, sizes and bytes are revalidated by Node.
files=[];total=0
for p in sorted(pathlib.Path('/work').iterdir()):
    if len(files)>=30: send(dict(type='error',text='Maks 30 resultatfiler per kjøring')); break
    try:
        st=p.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_size>${PYTHON_LIMITS.fileBytes}: continue
        encoded=base64.b64encode(p.read_bytes()).decode('ascii')
        if original.get(p.name)==encoded: continue
        total+=st.st_size
        if total>${PYTHON_LIMITS.totalBytes}: raise ValueError('Filene overstiger 20 MB')
        files.append(dict(name=p.name,data=encoded))
    except (OSError,ValueError) as e: send(dict(type='error',text=str(e)))
for doc in requests: send(dict(type='document',document=doc))
send(dict(type='files',files=files))
send(dict(type='done'))
`;
export function pythonExecutable():string|null {return ['/usr/bin/python3','/usr/local/bin/python3'].find(p=>existsSync(p))??null;}
export function bwrapExecutable():string|null {return ['/usr/bin/bwrap','/bin/bwrap'].find(p=>existsSync(p))??null;}
export function sandboxPython(code:string,files:PythonPayloadFile[],signal:AbortSignal,output:(text:string)=>void=()=>{},wallMs=PYTHON_LIMITS.wallMs):Promise<PythonReply> {
 const python=pythonExecutable(),bwrap=bwrapExecutable();if(!python||!bwrap)return Promise.reject(new Error('Kodekjøring i Chat krever Python 3 og bubblewrap på Linux. Ingen kode ble kjørt.'));
 signal.throwIfAborted();
 const args=['--unshare-all','--unshare-user','--disable-userns','--cap-drop','ALL','--new-session','--die-with-parent','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--size',String(16*1024*1024),'--tmpfs','/tmp','--size',String(64*1024*1024),'--tmpfs','/work','--remount-ro','/dev','--remount-ro','/','--chdir','/work','--clearenv','--setenv','HOME','/work','--setenv','PATH','/usr/bin:/bin','--setenv','LANG','C.UTF-8',python,'-I','-u','-c',SCRIPT];
 return new Promise((resolve,reject)=>{
  const child=spawn(bwrap,args,{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
  let lines='',stderr='',bytes=0,done=false,why='',logged=0;const result:PythonReply={files:[],documents:[],output:''};
  const stop=(reason:string)=>{why=reason;child.kill('SIGKILL');};
  const abort=()=>stop('Avbrutt av brukeren.');signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop('Tidsavbrudd: Python-kjøringen stoppet etter 30 sekunder.'),wallMs);
  const log=(value:string)=>{const clipped=value.slice(0,Math.max(0,64000-logged));logged+=clipped.length;if(clipped){result.output+=clipped;output(clipped);}};
  const readLine=(line:string)=>{try{const v=JSON.parse(line);if(v.type==='output'&&typeof v.text==='string')log(v.text);else if(v.type==='error')result.error=String(v.text).slice(0,6000);else if(v.type==='document'){if(result.documents.length>=10)stop('For mange dokumenter.');else result.documents.push(v.document);}else if(v.type==='files'&&Array.isArray(v.files)&&!done){result.files=v.files;}else if(v.type==='done')done=true;}catch{log(line+'\n');}};
  child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{bytes+=Buffer.byteLength(part);if(bytes>32*1024*1024)return stop('Kjøringen produserte for mye utdata.');lines+=part;let i;while((i=lines.indexOf('\n'))>=0){readLine(lines.slice(0,i));lines=lines.slice(i+1);}});
  child.stderr.setEncoding('utf8');child.stderr.on('data',(part:string)=>{stderr=(stderr+part).slice(-6000);});
  const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);};
  child.once('error',err=>{cleanup();reject(err);});
  child.once('close',code=>{cleanup();if(why)return reject(new Error(why));if(!done||code!==0)return reject(new Error(`Den isolerte Python-prosessen stoppet${code!==null?` (kode ${code})`:''}. ${stderr}`.trim()));resolve(result);});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({code,files}));
 });
}
