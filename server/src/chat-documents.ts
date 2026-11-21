// Trusted document builders accept bounded data, never executable JavaScript or filesystem paths.
import path from 'node:path';
import { HttpError } from './errors.ts';
export const DOCUMENT_TYPES: Record<string,string> = {md:'text/markdown',txt:'text/plain',csv:'text/csv',json:'application/json',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',png:'image/png',svg:'image/svg+xml',pdf:'application/pdf',py:'text/x-python'};
export function fileName(value:unknown):string {
 if(typeof value!=='string'||!value.trim()||value.length>160||value!==path.basename(value)||/[\\/\x00-\x1f\x7f]/.test(value)||value.startsWith('.'))throw new HttpError(400,'Bruk et vanlig filnavn uten mapper.');
 const name=value.trim();if(name.startsWith('.'))throw new HttpError(400,'Skjulte filnavn støttes ikke.');const ext=path.extname(name).slice(1).toLowerCase();if(!DOCUMENT_TYPES[ext])throw new HttpError(400,'Ustøttet filtype. Bruk md, txt, csv, json, xlsx, docx, pptx, png, svg, pdf eller py.');return name;
}
const text=(v:unknown,max=32000)=>{if(typeof v!=='string'||v.length>max)throw new HttpError(400,'Forventet tekst innenfor størrelsesgrensen.');return v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');};
const list=(v:unknown,max:number):any[]=>{if(v===undefined)return [];if(!Array.isArray(v)||v.length>max)throw new HttpError(400,`Forventet en liste med maks ${max} elementer.`);return v;};
function cell(v:any):any {
 if(v===null||typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))return v;
 if(typeof v==='string')return text(v,32767);
 if(v&&typeof v==='object'&&typeof v.formula==='string'){
  const f=v.formula.replace(/^=/,'');
  if(f.length>2000||/[\[\]|\\]/.test(f)||/\b(?:WEBSERVICE|HYPERLINK|RTD|EXEC|CALL|REGISTER|PY)\s*\(/i.test(f))throw new HttpError(400,'Eksterne koblinger og aktive regnearkfunksjoner støttes ikke.');
  return {formula:f,...(typeof v.result==='number'&&Number.isFinite(v.result)?{result:v.result}:{})};
 }
 throw new HttpError(400,'Regnearkceller må være tekst, tall, true/false, null eller en eksplisitt formel.');
}
export async function createDocument(input:any):Promise<{name:string;mime:string;data:Buffer}> {
 if(!input||typeof input!=='object'||Array.isArray(input)||JSON.stringify(input).length>250000)throw new HttpError(400,'Dokumentinnholdet er for stort eller ugyldig.');
 const name=fileName(input.name),ext=path.extname(name).slice(1).toLowerCase(),title=input.title===undefined?name.slice(0,-ext.length-1):text(input.title,500);
 let data:Buffer;
 if(['md','txt','csv','json','py','svg'].includes(ext)) { const content=text(input.text,240000);if(ext==='json'){try{JSON.parse(content);}catch{throw new HttpError(400,'JSON-filen må inneholde gyldig JSON.');}}data=Buffer.from(content,'utf8'); }
 else if(ext==='xlsx') {
  const Excel=(await import('exceljs')).default;const book=new Excel.Workbook();book.creator='Agentic Desktop';book.calcProperties.fullCalcOnLoad=true;
  const sheets=list(input.sheets,10);if(!sheets.length)throw new HttpError(400,'Excel trenger minst ett ark.');let cells=0;
  for(const [i,s] of sheets.entries()){
   const sheet=book.addWorksheet(text(s.name??`Ark ${i+1}`,31).replace(/[\\/*?:\[\]]/g,'_')||`Ark ${i+1}`);
   const headers=list(s.headers,100).map(h=>text(h,200));if(headers.length){sheet.addRow(headers);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2F6FED'}};sheet.views=[{state:'frozen',ySplit:1}];}
   for(const row of list(s.rows,5000)){const values=list(row,100).map(cell);cells+=values.length;if(cells>50000)throw new HttpError(400,'Maks 50 000 celler per dokument.');sheet.addRow(values);}
   sheet.columns.forEach(c=>{c.width=22;});sheet.eachRow(r=>{r.alignment={vertical:'top',wrapText:true};r.eachCell(c=>{c.font={name:'Aptos',size:11,...c.font};});});
  }
  data=Buffer.from(await book.xlsx.writeBuffer());
 } else if(ext==='docx') {
  const d=await import('docx');const children:any[]=[new d.Paragraph({text:title,heading:d.HeadingLevel.TITLE})];
  const sections=[...list(input.sections,100)];if(input.text!==undefined)sections.unshift({text:text(input.text,200000)});
  if(!sections.length)throw new HttpError(400,'Word-dokumentet trenger tekst eller seksjoner.');
  for(const s of sections){
   if(s.heading)children.push(new d.Paragraph({text:text(s.heading,500),heading:d.HeadingLevel.HEADING_1}));
   if(s.text!==undefined)for(const line of text(s.text,200000).split('\n'))children.push(new d.Paragraph({text:line,spacing:{after:120}}));
   for(const b of list(s.bullets,100))children.push(new d.Paragraph({text:text(b,2000),bullet:{level:0}}));
   if(s.table){const rows=[...(s.table.headers?[list(s.table.headers,30)]:[]),...list(s.table.rows,200)];children.push(new d.Table({width:{size:100,type:d.WidthType.PERCENTAGE},rows:rows.map((row,i)=>new d.TableRow({tableHeader:!!s.table.headers&&i===0,children:list(row,30).map(v=>new d.TableCell({children:[new d.Paragraph(typeof v==='object'&&v!==null?text(v.result===undefined?'':String(v.result)):String(cell(v)??''))]}))}))}));}
  }
  data=await d.Packer.toBuffer(new d.Document({creator:'Agentic Desktop',title,styles:{default:{document:{run:{font:'Aptos',size:22},paragraph:{spacing:{after:160}}}}},sections:[{properties:{},children}]}));
 } else if(ext==='pptx') {
  const Pptx=(await import('pptxgenjs')).default as unknown as new()=>import('pptxgenjs').default;const deck=new Pptx();deck.layout='LAYOUT_WIDE';deck.author='Agentic Desktop';deck.title=title;deck.subject=title;
  const slides=list(input.slides,30);if(!slides.length)throw new HttpError(400,'PowerPoint trenger minst ett lysbilde.');
  for(const [i,s] of slides.entries()){
   const slide=deck.addSlide();slide.background={color:'F7F9FC'};
   slide.addText(text(s.title??title,500),{x:0.7,y:0.5,w:11.9,h:0.8,fontFace:'Aptos',fontSize:28,bold:true,color:'17345C',breakLine:false,fit:'shrink'});
   const body=[...(s.body!==undefined?[text(s.body,12000)]:[]),...list(s.bullets,30).map(b=>'• '+text(b,2000))].join('\n\n');
   slide.addText(body,{x:0.75,y:1.65,w:11.8,h:4.8,fontFace:'Aptos',fontSize:20,color:'26364D',valign:'top',fit:'shrink'});
   slide.addText(String(i+1),{x:11.8,y:7,w:0.8,h:0.25,fontSize:10,color:'66758B',align:'right'});if(s.notes)slide.addNotes(text(s.notes,10000));
  }
  data=Buffer.from(await deck.write({outputType:'nodebuffer',compression:true}) as ArrayBuffer);
 } else throw new HttpError(400,'Denne filtypen kan lages med Python-verktøyet, ikke dokumentgeneratoren.');
 if(data.length>10*1024*1024)throw new HttpError(413,'Filen er for stor (maks 10 MB).');return {name,mime:DOCUMENT_TYPES[ext],data};
}
