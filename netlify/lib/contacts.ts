import type { Database, Query } from './db.ts';
import type { Contact, ContactList, ConsentEvent } from '../../src/features/contacts/types.ts';
import { InputError, object, text, tags, uuid, version, validateDraft, consentDate } from '../../src/features/contacts/validation.ts';
export const selectContact="c.*, ARRAY(SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id=t.id WHERE ct.contact_id=c.id ORDER BY t.name) AS tags";
export async function audit(tx:Query,actor:string,action:string,entity:string,id:string,metadata:Record<string,unknown>={}) {
  await tx.query('INSERT INTO audit_logs(actor,action,entity,entity_id,safe_metadata) VALUES($1,$2,$3,$4,$5::jsonb)',[actor,action,entity,id,JSON.stringify(metadata)]);
}
export async function assignTags(tx:Query,id:string,names:string[],replace=true) {
  if(replace) await tx.query('DELETE FROM contact_tags WHERE contact_id=$1',[id]);
  for(const name of names) {
    const result=await tx.query<{id:string}>('INSERT INTO tags(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[name]);
    await tx.query('INSERT INTO contact_tags(contact_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,result.rows[0].id]);
  }
}
export async function getContact(db:Query,id:string):Promise<Contact> {
  const result=await db.query<Contact>(`SELECT ${selectContact} FROM contacts c WHERE c.id=$1`,[uuid(id)]);
  if(!result.rows[0]) throw new InputError('Kontak tidak ditemukan.','NOT_FOUND',404);
  return result.rows[0];
}
export async function lockContact(tx:Query,id:string,expected:unknown) {
  const result=await tx.query<Contact>('SELECT * FROM contacts WHERE id=$1 FOR UPDATE',[uuid(id)]);
  if(!result.rows[0]) throw new InputError('Kontak tidak ditemukan.','NOT_FOUND',404);
  if(result.rows[0].version!==version(expected)) throw new InputError('Kontak telah berubah. Muat ulang lalu ulangi perubahan Anda.','VERSION_CONFLICT',409);
  return result.rows[0];
}
function filters(params:URLSearchParams) {
  const values:unknown[]=[]; const clauses:string[]=[];
  const add=(value:unknown,sql:(p:string)=>string)=>{values.push(value);clauses.push(sql(`$${values.length}`));};
  const search=params.get('q')?.trim();
  if(search) {if(search.length>100) throw new InputError('Pencarian maksimal 100 karakter.');add('%'+search.replace(/[\\%_]/g,'\\$&')+'%',p=>`(c.name ILIKE ${p} OR c.phone_e164 ILIKE ${p})`);}
  const archived=params.get('archived')??'active';
  if(!['active','archived','all'].includes(archived)) throw new InputError('Filter arsip tidak valid.');
  if(archived!=='all') clauses.push(`c.archived_at IS ${archived==='active'?'':'NOT '}NULL`);
  const status=params.get('consent');
  if(status) {if(!['active','unknown','revoked'].includes(status)) throw new InputError('Filter consent tidak valid.');add(status,p=>`c.consent_status=${p}`);}
  const tag=params.get('tag');
  if(tag) add(text(tag,'Tag',50),p=>`EXISTS(SELECT 1 FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=c.id AND t.name=${p})`);
  return {values,clauses};
}
function integer(value:string|null,fallback:number,max:number) {
  if(value===null)return fallback;
  if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>max)throw new InputError('Parameter halaman tidak valid.');
  return Number(value);
}
export async function listContacts(db:Database,params:URLSearchParams):Promise<ContactList> {
  const {values,clauses}=filters(params); const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  const page=integer(params.get('page'),1,100000),pageSize=integer(params.get('pageSize'),25,100);
  const sort=params.get('sort')??'newest';
  const order:Record<string,string>={newest:'c.created_at DESC,c.id',oldest:'c.created_at ASC,c.id',name:'lower(c.name),c.id'};
  if(!order[sort])throw new InputError('Urutan tidak valid.');
  return db.transaction(async tx=>{
    const count=await tx.query<{total:number}>(`SELECT count(*)::int AS total FROM contacts c ${where}`,values);
    const result=await tx.query<Contact>(`SELECT ${selectContact} FROM contacts c ${where} ORDER BY ${order[sort]} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pageSize,(page-1)*pageSize]);
    return {items:result.rows,total:count.rows[0].total,page,pageSize};
  });
}
export async function exportContacts(db:Database,params:URLSearchParams) {
  const {values,clauses}=filters(params);
  const cursor=params.get('cursor'); if(cursor) {values.push(uuid(cursor));clauses.push(`c.id > $${values.length}`);}
  const until=params.get('until')??new Date().toISOString();
  if(!Number.isFinite(Date.parse(until)))throw new InputError('Batas waktu ekspor tidak valid.');
  values.push(until);clauses.push(`c.created_at <= $${values.length}::timestamptz`);
  const result=await db.query<Contact>(`SELECT ${selectContact} FROM contacts c WHERE ${clauses.join(' AND ')} ORDER BY c.id LIMIT 501`,values);
  const items=result.rows.slice(0,500);
  return {items,until,next:result.rows.length>500?items[items.length-1].id:null};
}
export async function insertContact(tx:Query,value:unknown,actor:string,skipDuplicate=false) {
  const data=validateDraft(value);
  const result=await tx.query<{id:string}>(`INSERT INTO contacts(name,phone_e164,consent_status,consent_source,consent_at,opted_out_at,opt_out_source)
    VALUES($1,$2,$3,$4,$5,$6,$7) ${skipDuplicate?'ON CONFLICT(phone_e164) DO NOTHING':''} RETURNING id`,
    [data.name,data.phone_e164,data.consent_status,data.consent_status==='active'?data.consent_source:null,data.consent_status==='active'?data.consent_at:null,data.consent_status==='revoked'?data.consent_at:null,data.consent_status==='revoked'?data.consent_source:null]);
  const id=result.rows[0]?.id;if(!id)return null;
  await assignTags(tx,id,data.tags);
  if(data.consent_status!=='unknown') await tx.query('INSERT INTO consent_events(contact_id,status,source,occurred_at,actor) VALUES($1,$2,$3,$4,$5)',[id,data.consent_status,data.consent_source,data.consent_at,actor]);
  await audit(tx,actor,'contact.created','contact',id,{consent_status:data.consent_status});
  return id;
}
export async function createContact(db:Database,value:unknown,actor:string) {
  return db.transaction(async tx=>{const id=await insertContact(tx,value,actor);return getContact(tx,id!);});
}
export async function updateContact(db:Database,id:string,value:unknown,actor:string) {
  const body=object(value);const name=text(body.name,'Nama');const names=tags(body.tags);
  if('phone' in body || 'phone_e164' in body || 'consent_status' in body)throw new InputError('Nomor dan consent harus dikelola melalui alur khusus.');
  return db.transaction(async tx=>{
    await lockContact(tx,id,body.version);
    await tx.query('UPDATE contacts SET name=$1 WHERE id=$2',[name,id]);await assignTags(tx,id,names);
    await audit(tx,actor,'contact.updated','contact',id);return getContact(tx,id);
  });
}
export async function changeConsent(db:Database,id:string,value:unknown,actor:string) {
  const body=object(value),status=body.status;
  if(status!=='active'&&status!=='revoked')throw new InputError('Pilih persetujuan baru atau opt-out.');
  if(body.confirmed!==true)throw new InputError('Konfirmasi bukti consent / permintaan opt-out terlebih dahulu.');
  const source=text(body.source,'Sumber bukti',300);
  const at=status==='active'?consentDate(body.occurred_at):new Date().toISOString();
  return db.transaction(async tx=>{
    const contact=await lockContact(tx,id,body.version);
    if(status==='active'&&(contact.archived_at || (contact.opted_out_at && Date.parse(at)<=new Date(contact.opted_out_at).getTime()) || (contact.consent_at && Date.parse(at)<new Date(contact.consent_at).getTime()))) {
      throw new InputError('Pulihkan kontak dari arsip dan gunakan persetujuan baru yang lebih baru daripada opt-out / bukti sebelumnya.');
    }
    if(status==='active')await tx.query("UPDATE contacts SET consent_status='active',consent_source=$1,consent_at=$2 WHERE id=$3",[source,at,id]);
    else await tx.query("UPDATE contacts SET consent_status='revoked',opted_out_at=$1,opt_out_source=$2 WHERE id=$3",[at,source,id]);
    await tx.query('INSERT INTO consent_events(contact_id,status,source,occurred_at,actor) VALUES($1,$2,$3,$4,$5)',[id,status,source,at,actor]);
    await audit(tx,actor,status==='active'?'contact.consent_granted':'contact.opted_out','contact',id);
    return getContact(tx,id);
  });
}
export async function bulkContacts(db:Database,value:unknown,actor:string) {
  const body=object(value);
  if(!Array.isArray(body.contacts)||body.contacts.length<1||body.contacts.length>100)throw new InputError('Pilih 1–100 kontak.');
  const refs=body.contacts.map(value=>{const item=object(value);return {id:uuid(item.id),version:version(item.version)};}).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(refs.map(x=>x.id)).size!==refs.length)throw new InputError('Kontak dipilih lebih dari sekali.');
  if(!['archive','restore','tag'].includes(String(body.action)))throw new InputError('Aksi tidak valid.');
  const names=body.action==='tag'?tags(body.tags):[];
  if(body.action==='tag'&&!names.length)throw new InputError('Isi tag terlebih dahulu.');
  return db.transaction(async tx=>{
    for(const ref of refs) {
      await lockContact(tx,ref.id,ref.version);
      if(body.action==='tag') {
        const current=await getContact(tx,ref.id);
        if(new Set([...current.tags,...names]).size>20)throw new InputError('Gabungan tag melebihi 20 per kontak.');
        await assignTags(tx,ref.id,names,false);await tx.query('UPDATE contacts SET updated_at=now() WHERE id=$1',[ref.id]);
      } else await tx.query(`UPDATE contacts SET archived_at=${body.action==='archive'?'now()':'NULL'} WHERE id=$1`,[ref.id]);
      await audit(tx,actor,'contact.'+body.action,'contact',ref.id);
    }
    return {count:refs.length};
  });
}
export async function history(db:Database,id:string,params:URLSearchParams) {
  await getContact(db,id);const page=integer(params.get('page'),1,100000);
  const results=await db.query<ConsentEvent>('SELECT id,status,source,occurred_at,actor FROM consent_events WHERE contact_id=$1 ORDER BY occurred_at DESC,id LIMIT 51 OFFSET $2',[id,(page-1)*50]);
  return {items:results.rows.slice(0,50),hasMore:results.rows.length>50,page};
}
