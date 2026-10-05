import type {Database,Query} from './db.ts';
import {InputError,object,text} from '../../src/features/contacts/validation.ts';
import {templateShape,type Template,type Component} from '../../src/features/campaigns/model.ts';
export type MetaConfig={token:string;waba:string;version:string};
export function metaConfig(env:Record<string,string|undefined>=process.env):MetaConfig|null {
 const token=env.WHATSAPP_ACCESS_TOKEN?.trim(),waba=env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim(),version=env.WHATSAPP_API_VERSION?.trim();
 return token&&/^\d{5,30}$/.test(waba??'')&&/^v\d{1,3}\.0$/.test(version??'')?{token,waba:waba!,version:version!}:null;
}
export function decorateTemplate(t:Template,waba:string|null):Template {
 const shape=templateShape(t);
 const reason=!waba||t.source_waba!==waba?'Sinkronkan template akun yang aktif.':t.status!=='APPROVED'?`Status Meta: ${t.status}.`:Date.now()-new Date(t.synced_at).getTime()>86400000?'Sinkronisasi lebih dari 24 jam. Sinkronkan ulang.':shape.reason;
 return {...t,...shape,reason,usable:!reason};
}
export async function templateList(db:Query,waba:string|null) {
 return (await db.query<Template>("SELECT * FROM templates ORDER BY (source_waba=$1 AND status<>'UNAVAILABLE') DESC NULLS LAST,name,language LIMIT 1000",[waba])).rows.map(t=>decorateTemplate(t,waba));
}
function providerTemplate(raw:unknown) {
 const t=object(raw);const components=t.components;
 if(!Array.isArray(components)||components.length>20||JSON.stringify(components).length>100000)throw new InputError('Komponen respons Meta tidak valid.','META_RESPONSE',502);
 for(const rawC of components){const c=object(rawC);text(c.type,'Tipe komponen',50);if(c.text!==undefined)text(c.text,'Teks komponen',10000);if(c.format!==undefined)text(c.format,'Format komponen',50);if(c.buttons!==undefined){if(!Array.isArray(c.buttons)||c.buttons.length>20)throw new InputError('Tombol respons Meta tidak valid.','META_RESPONSE',502);for(const b0 of c.buttons){const b=object(b0);text(b.type,'Tipe tombol',50);for(const k of ['text','url','phone_number'])if(b[k]!==undefined)text(b[k],'Isi tombol',2000);}}}
 return {provider_id:text(t.id,'ID template',100),name:text(t.name,'Nama template',200),language:text(t.language,'Bahasa',30),category:text(t.category,'Kategori',50),status:text(t.status,'Status',50),parameter_format:t.parameter_format===undefined?'POSITIONAL':text(t.parameter_format,'Format variabel',30),components:components as Component[]};
}
export type ProviderTemplate=ReturnType<typeof providerTemplate>;
async function boundedJson(response:Response):Promise<unknown> {
 const reader=response.body?.getReader();if(!reader)throw new Error('Empty response');let size=0;const chunks:Uint8Array[]=[];
 try {while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>2*1024*1024){await reader.cancel();throw new Error('Response limit');}chunks.push(r.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function fetchTemplates(config:MetaConfig,transport:typeof fetch=fetch):Promise<ProviderTemplate[]> {
 const result:ProviderTemplate[]=[];let after:string|undefined;const cursors=new Set<string>();const signal=AbortSignal.timeout(20000);
 try {
  for(let page=0;page<10;page++) {
   const url=new URL(`https://graph.facebook.com/${config.version}/${config.waba}/message_templates`);
   url.searchParams.set('fields','id,name,language,category,status,components,parameter_format');url.searchParams.set('limit','100');if(after)url.searchParams.set('after',after);
   const response=await transport(url,{headers:{Authorization:`Bearer ${config.token}`},signal,redirect:'error'});
   if(!response.ok)throw new InputError(response.status===429?'Meta membatasi permintaan. Coba lagi nanti.':'Sinkronisasi Meta gagal. Periksa token, izin pengelolaan WhatsApp, WABA ID, dan versi API di server.','META_SYNC_FAILED',502);
   const body=object(await boundedJson(response));if(!Array.isArray(body.data))throw new Error('Invalid data');
   result.push(...body.data.map(providerTemplate));if(result.length>1000)throw new Error('Template limit');
   const paging=body.paging?object(body.paging):{};
   if(!paging.next)return result;
   // Never follow a provider-returned URL: reconstruct the fixed Graph host using only a cursor.
   const cursor=object(paging.cursors).after;if(typeof cursor!=='string'||!cursor||cursor.length>4000||cursors.has(cursor))throw new Error('Invalid cursor');cursors.add(cursor);after=cursor;
  }
  throw new Error('Page limit');
 }catch(e){if(e instanceof InputError&&e.code==='META_SYNC_FAILED')throw e;throw new InputError('Sinkronisasi tidak selesai: koneksi, batas 1.000 template / 10 halaman, atau format respons. Data sebelumnya tetap disimpan.','META_SYNC_FAILED',502);}
}
export async function syncTemplates(db:Database,actor:string,waba:string,load:()=>Promise<ProviderTemplate[]>) {
 return db.transaction(async tx=>{
  // One workspace sync at a time. Reject competing syncs instead of overwriting a newer snapshot.
  const locked=await tx.query('SELECT id FROM template_sync_state WHERE id=true FOR UPDATE NOWAIT').catch(()=>{throw new InputError('Sinkronisasi sedang berjalan. Coba lagi sebentar.','SYNC_BUSY',409);});
  if(!locked.rows.length)throw new Error('Missing sync state');
  const incoming=await load();const keys=new Set<string>();for(const t of incoming){const key=t.provider_id+':'+t.language;if(keys.has(key))throw new InputError('Respons Meta memuat template ganda.','META_SYNC_FAILED',502);keys.add(key);}
  await tx.query("UPDATE templates SET status='UNAVAILABLE'");
  for(const t of incoming)await tx.query(`INSERT INTO templates(provider_id,name,language,category,status,components,source_waba,parameter_format) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(provider_id,language) DO UPDATE SET name=excluded.name,category=excluded.category,status=excluded.status,components=excluded.components,source_waba=excluded.source_waba,parameter_format=excluded.parameter_format,synced_at=now()`,[t.provider_id,t.name,t.language,t.category,t.status,JSON.stringify(t.components),waba,t.parameter_format]);
  await tx.query('UPDATE template_sync_state SET source_waba=$1,synced_at=now() WHERE id=true',[waba]);
  await tx.query("INSERT INTO audit_logs(actor,action,entity,safe_metadata) VALUES($1,'templates.synced','templates',$2)",[actor,JSON.stringify({count:incoming.length})]);
  return {count:incoming.length};
 });
}
