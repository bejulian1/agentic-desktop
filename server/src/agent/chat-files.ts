import type {Tool} from './tools.ts';
import type {ChatWorkspace} from '../chat-workspace.ts';
const str={type:'string'};
const rows={type:'array',items:{type:'array',items:{anyOf:[str,{type:'number'},{type:'boolean'},{type:'null'},{type:'object',properties:{formula:str,result:{type:'number'}},required:['formula']}]}}};
// What each tool lets Chat do, in plain words (Tool.can): the assistant's picture of itself is built from these.
const CAN:Record<string,string>={create_document:'create Word, Excel, PowerPoint and text files to download',list_chat_files:'see the files made in this chat',read_chat_file:'see the files made in this chat',run_python:'run Python for calculations and analysis in an isolated workspace'};
export function chatFileTools(workspace:ChatWorkspace,documents:boolean,python:boolean):Tool[]{
 const make=(name:string,description:string,properties:Record<string,unknown>,required:string[],run:Tool['run']):Tool=>({can:CAN[name]??'',def:{name,description,parameters:{type:'object',properties,required,additionalProperties:false}},kind:'read',summary:input=>name==='run_python'?'Kjører Python i isolert Chat-arbeidsområde':input.name??'Ser på filer i chatten',run});
 const out:Tool[]=[];
 if(documents)out.push(make('create_document','Create a real downloadable file in this Chat only: md/txt/csv/json, Word docx, Excel xlsx, PowerPoint pptx. Use bounded structured data, never code or host paths. Returns download links. Excel formulas are explicit {formula:"SUM(A2:A4)",result:12} objects; strings stay text. No external links/macros. Max 10 MB per file.',{
  name:{...str,description:'Filename with extension, without folders.'},title:str,text:{...str,description:'Content for text files, or paragraphs for Word.'},
  sheets:{type:'array',items:{type:'object',properties:{name:str,headers:{type:'array',items:str},rows},required:['name','rows']}},
  sections:{type:'array',items:{type:'object',properties:{heading:str,text:str,bullets:{type:'array',items:str},table:{type:'object',properties:{headers:{type:'array',items:str},rows},required:['rows']}}}},
  slides:{type:'array',items:{type:'object',properties:{title:str,body:str,bullets:{type:'array',items:str},notes:str},required:['title']}}
 },['name'],async(input,ctx)=>{const files=await workspace.document(ctx.thread.id,input,ctx.signal);return {text:JSON.stringify({files}),files};}));
 if(python)out.push(make('run_python',`Execute Python 3 for calculations/data analysis in this Chat's isolated /work. Standard library only (csv, json, math, statistics, sqlite3, etc). No network, host/home/project files, API keys, pip or shell access. 30s/512MB. Variables reset each call; top-level supported files persist, including explicitly attached text files. Write files in current directory for download, max 10MB each/20MB output. ${documents?'For Office output: from agentic_files import create_document; create_document("report.xlsx", sheets=[{"name":"Data","headers":["Value"],"rows":[[42]]}]). Same structured fields as create_document tool.':'Office document helper is disabled.'} Check errors before claiming success.`,{code:{...str,description:'Python code, max 60000 characters.'}},['code'],async(input,ctx)=>workspace.python(ctx.thread.id,input.code,ctx.signal,ctx.output??(()=>{}),documents)));
 if(documents||python)out.push(make('list_chat_files','List files in this Chat workspace only. The newest file with a given name is available to Python. Previous conversation/project workspaces are excluded.',{},[],async(_input,ctx)=>({text:JSON.stringify({files:workspace.list(ctx.thread.id)})})));
 return out;
}
