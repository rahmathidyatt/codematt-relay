import type { Database } from './db.ts';
import { success } from './http.ts';
import { InputError } from '../../src/features/contacts/validation.ts';
import { LIMITS } from '../../src/features/contacts/types.ts';
import { bulkContacts,changeConsent,createContact,exportContacts,history,listContacts,updateContact } from './contacts.ts';
import { createImport,getImport,importChunk } from './imports.ts';
export function contactRoute(path:string):boolean {return /^\/api\/(contacts(?:\/(?:export|bulk|[0-9a-f-]+(?:\/consent|\/history)?))?|tags|imports(?:\/[0-9a-f-]+(?:\/chunks)?)?)$/i.test(path);}
export async function jsonBody(request:Request):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new InputError('Gunakan format JSON.','CONTENT_TYPE',415);
  if(Number(request.headers.get('content-length'))>LIMITS.bodyBytes)throw new InputError('Ukuran permintaan terlalu besar.','PAYLOAD_TOO_LARGE',413);
  const reader=request.body?.getReader();if(!reader)throw new InputError('Data kosong.');
  let size=0;const chunks:Uint8Array[]=[];
  try {
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>LIMITS.bodyBytes){await reader.cancel();throw new InputError('Ukuran permintaan terlalu besar.','PAYLOAD_TOO_LARGE',413);}chunks.push(part.value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new InputError('JSON tidak valid.');}
}
export function sameOrigin(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin)throw new InputError('Asal permintaan tidak diizinkan. Muat ulang halaman.','ORIGIN_REJECTED',403);
}
export async function rateLimit(db:Database,actor:string) {
  const bucket=Math.floor(Date.now()/60000);
  await db.query('DELETE FROM api_rate_buckets WHERE bucket < $1',[bucket-2]);
  const r=await db.query<{count:number}>('INSERT INTO api_rate_buckets(actor,bucket) VALUES($1,$2) ON CONFLICT(actor,bucket) DO UPDATE SET count=api_rate_buckets.count+1 RETURNING count',[actor,bucket]);
  if(r.rows[0].count>180)throw new InputError('Terlalu banyak permintaan. Coba lagi setelah satu menit.','RATE_LIMITED',429);
}
export async function handleContacts(request:Request,db:Database,actor:string):Promise<Response> {
  const url=new URL(request.url);const path=url.pathname;const method=request.method;
  if(!['GET','POST','PATCH'].includes(method))throw new InputError('Metode tidak didukung.','METHOD_NOT_ALLOWED',405);
  if(method!=='GET')sameOrigin(request);
  if(path==='/api/contacts'&&method==='GET')return success(await listContacts(db,url.searchParams));
  if(path==='/api/contacts/export'&&method==='GET')return success(await exportContacts(db,url.searchParams));
  if(path==='/api/contacts'&&method==='POST')return success(await createContact(db,await jsonBody(request),actor));
  if(path==='/api/contacts/bulk'&&method==='POST')return success(await bulkContacts(db,await jsonBody(request),actor));
  if(path==='/api/tags'&&method==='GET') {
    const q=(url.searchParams.get('q')??'').trim();if(q.length>50)throw new InputError('Pencarian tag maksimal 50 karakter.');
    return success((await db.query<{name:string}>('SELECT name FROM tags WHERE name ILIKE $1 ORDER BY name LIMIT 100',['%'+q.replace(/[\\%_]/g,'\\$&')+'%'])).rows);
  }
  const contact=path.match(/^\/api\/contacts\/([0-9a-f-]+)(?:\/(consent|history))?$/i);
  if(contact) {
    if(method==='GET'&&contact[2]==='history')return success(await history(db,contact[1],url.searchParams));
    if(method==='POST'&&contact[2]==='consent')return success(await changeConsent(db,contact[1],await jsonBody(request),actor));
    if(method==='PATCH'&&!contact[2])return success(await updateContact(db,contact[1],await jsonBody(request),actor));
  }
  if(path==='/api/imports'&&method==='POST')return success(await createImport(db,await jsonBody(request),actor));
  const job=path.match(/^\/api\/imports\/([0-9a-f-]+)(\/chunks)?$/i);
  if(job) {
    if(method==='GET'&&!job[2])return success(await getImport(db,job[1],actor));
    if(method==='POST'&&job[2])return success(await importChunk(db,job[1],await jsonBody(request),actor));
  }
  throw new InputError('Metode tidak didukung.','METHOD_NOT_ALLOWED',405);
}
