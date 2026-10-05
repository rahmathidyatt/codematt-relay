import Papa from 'papaparse';
import { Unzip,UnzipInflate,strFromU8,zipSync } from 'fflate';
import { LIMITS,type ContactDraft,type ImportRow } from './types.ts';
import { InputError,validateDraft } from './validation.ts';
export type Sheet={name:string;rows:string[][]};
export type Field='name'|'phone'|'tags'|'consent_status'|'consent_source'|'consent_at';
export type Mapping=Record<Field,number>;
export const fields:Field[]=['name','phone','tags','consent_status','consent_source','consent_at'];
function boundedRows(rows:unknown[][]):string[][] {
  if(rows.length>LIMITS.rows+1)throw new InputError('Maksimal 10.000 baris data per file.');
  return rows.map(row=>{
    if(row.length>LIMITS.columns)throw new InputError('Maksimal 40 kolom per file.');
    return row.map(cell=>{
      const value=cell instanceof Date?cell.toISOString().slice(0,10):String(cell??'');
      if(value.length>LIMITS.cellLength)throw new InputError('Ada sel dengan isi terlalu panjang (maksimal 2.000 karakter).');
      return value;
    });
  });
}
export function parseCsv(contents:string):Sheet[] {
  const rows:string[][]=[];let problem='';
  Papa.parse<string[]>(contents.replace(/^\uFEFF/,''),{skipEmptyLines:false,step(result,parser){
    if(result.errors.length){problem='Struktur CSV tidak valid. Periksa tanda kutip dan pemisah kolom.';parser.abort();return;}
    rows.push(result.data);if(rows.length>LIMITS.rows+2){problem='Maksimal 10.000 baris data per file.';parser.abort();}
  }});
  if(problem)throw new InputError(problem);
  while(rows.length&&rows[rows.length-1].every(c=>!c.trim()))rows.pop();
  return [{name:'CSV',rows:boundedRows(rows)}];
}
export function inspectXlsx(bytes:Uint8Array) {
  if(bytes.length<4||bytes[0]!==80||bytes[1]!==75)throw new InputError('File bukan XLSX yang valid.');
  let count=0,total=0,completed=0;const seen=new Set<string>();const entries:Record<string,Uint8Array>=Object.create(null);
  const unzip=new Unzip(file=>{
    count++;
    if(count>200||seen.has(file.name)||file.name.includes('..')||file.name.startsWith('/')||/vbaProject|externalLinks/i.test(file.name))throw new InputError('Struktur XLSX tidak didukung. Gunakan workbook sederhana tanpa macro / tautan eksternal.');
    seen.add(file.name);
    if((file.originalSize??0)>20*1024*1024)throw new InputError('Isi XLSX terlalu besar.');
    const chunks:Uint8Array[]=[];let size=0;
    file.ondata=(error,data,final)=>{
      if(error){if(error instanceof InputError)throw error;throw new InputError('XLSX rusak atau terkompresi tidak valid.');}
      size+=data.length;total+=data.length;
      if(total>20*1024*1024)throw new InputError('Isi XLSX setelah diekstrak melebihi 20 MB.');
      chunks.push(data);
      if(final){completed++;
        const buf=new Uint8Array(size);let offset=0;for(const c of chunks){buf.set(c,offset);offset+=c.length;}
        entries[file.name]=buf;
        if(file.name.endsWith('.xml')){
        const xml=strFromU8(buf);
        if(/<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|\/|>)/i.test(xml))throw new InputError('XLSX mengandung formula atau struktur XML yang tidak didukung. Salin sebagai nilai terlebih dahulu.');
        if(file.name.startsWith('xl/worksheets/'))for(const match of xml.matchAll(/\br="([A-Z]*)(\d+)"/g)){
          let column=0;for(const c of match[1])column=column*26+c.charCodeAt(0)-64;
          if(column>LIMITS.columns||Number(match[2])>LIMITS.rows+1)throw new InputError('Rentang XLSX melebihi 40 kolom / 10.000 baris data. Hapus baris kosong berformat di luar data.');
        }
      }}
    };file.start();
  });
  unzip.register(UnzipInflate);
  for(let i=0;i<bytes.length;i+=1024)unzip.push(bytes.subarray(i,Math.min(i+1024,bytes.length)),i+1024>=bytes.length);
  if(!seen.has('xl/workbook.xml')||completed!==count)throw new InputError('Workbook XLSX tidak lengkap.');
  return zipSync(entries,{level:0});
}
export async function parseFile(name:string,buffer:ArrayBuffer):Promise<Sheet[]> {
  if(buffer.byteLength>LIMITS.fileBytes)throw new InputError('Ukuran file maksimal 5 MB.');
  if(/\.csv$/i.test(name))return parseCsv(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
  if(!/\.xlsx$/i.test(name))throw new InputError('Pilih file .csv atau .xlsx. Simpan ulang .xls sebagai .xlsx.');
  const sanitized=inspectXlsx(new Uint8Array(buffer));
  const {default:read}=await import('read-excel-file/web-worker');
  const sheets=await read(Uint8Array.from(sanitized).buffer,{parseNumber:value=>value});
  if(sheets.length>10)throw new InputError('Maksimal 10 sheet per file.');
  return sheets.map(sheet=>({name:sheet.sheet,rows:boundedRows(sheet.data)}));
}
export function autoMap(headers:string[]):Mapping {
  const aliases:Record<Field,string[]>={name:['name','nama','nama panggilan'],phone:['phone','phone e164','nomor','no whatsapp','no wa','nomor telepon','telepon'],tags:['tags','tag','kategori'],consent_status:['consent','consent status','persetujuan'],consent_source:['consent source','sumber consent','sumber persetujuan'],consent_at:['consent at','consent date','tanggal consent','tanggal persetujuan']};
  return Object.fromEntries(fields.map(field=>[field,headers.findIndex(h=>aliases[field].includes(h.toLowerCase().replaceAll('_',' ').trim()))])) as Mapping;
}
export type ReviewedRow=ImportRow&{kind:'valid'|'missing'|'duplicate'|'invalid';reason?:string};
export function mapRows(rows:string[][],mapping:Mapping,country='ID'):ReviewedRow[] {
  if(mapping.name<0||mapping.phone<0)throw new InputError('Petakan kolom nama dan nomor telepon terlebih dahulu.');
  const selected=Object.values(mapping).filter(x=>x>=0);
  if(new Set(selected).size!==selected.length)throw new InputError('Satu kolom hanya boleh dipakai untuk satu field.');
  const seen=new Set<string>();
  return rows.slice(1).map((cells,i)=>{
    const get=(field:Field)=>(cells[mapping[field]]??'').trim();
    const raw=get('consent_status').toLowerCase();
    const status=['active','aktif','yes','ya','true','1'].includes(raw)?'active':['revoked','opt-out','opted out','berhenti','stop'].includes(raw)?'revoked':['','unknown','no','tidak','false','0','belum'].includes(raw)?'unknown':raw;
    // Safe CSV exports prefix phone cells with an apostrophe to neutralize spreadsheet formulas.
    const phone=get('phone').replace(/^'(?=\+\d)/,'');
    const data:ContactDraft={name:get('name'),phone,country,tags:get('tags').split(/[;,]/).map(x=>x.trim()).filter(Boolean),consent_status:status,consent_source:get('consent_source'),consent_at:get('consent_at')};
    try {
      const normalized=validateDraft(data);
      if(seen.has(normalized.phone_e164))return {row:i+2,data,kind:'duplicate' as const,reason:'Nomor berulang dalam file.'};
      seen.add(normalized.phone_e164);
      return {row:i+2,data,kind:status==='unknown'?'missing' as const:'valid' as const,...(status==='unknown'?{reason:'Disimpan tanpa consent aktif; tidak layak menerima campaign.'}:{})};
    }catch(e){return {row:i+2,data,kind:'invalid' as const,reason:e instanceof Error?e.message:'Data tidak valid.'};}
  });
}
