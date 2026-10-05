import type {Database,Query} from './db.ts';
import {InputError,object,text,uuid,eligible,normalizePhone} from '../../src/features/contacts/validation.ts';
import type {Contact} from '../../src/features/contacts/types.ts';
import {validateAudience,validateMapping,mappingIssues,renderMessage,type Audience,type Mapping,type Counts,type Campaign,type Template} from '../../src/features/campaigns/model.ts';
import {decorateTemplate} from './templates.ts';
export function draftInput(raw:unknown) {
 const b=object(raw);if(Object.keys(b).some(k=>!['id','version','name','template_id','audience_rules','variable_mapping'].includes(k)))throw new InputError('Hanya draft yang dapat disimpan; pengiriman belum tersedia.');
 if(b.version!==undefined&&(!Number.isSafeInteger(b.version)||Number(b.version)<1))throw new InputError('Versi draft tidak valid.');
 return {id:uuid(b.id),version:b.version as number|undefined,name:text(b.name,'Nama campaign'),template_id:b.template_id?uuid(b.template_id):null,audience_rules:validateAudience(b.audience_rules),variable_mapping:validateMapping(b.variable_mapping)};
}
export async function audienceContacts(db:Query,a:Audience) {
 const params:unknown[]=[];const clauses:string[]=[];const add=(v:unknown)=>{params.push(v);return '$'+params.length;};
 if(a.mode==='manual')clauses.push(`c.id = ANY(${add(a.ids)}::uuid[])`);
 if(a.mode==='segment') {
  if(a.tags.length){const p=add(a.tags);clauses.push(a.match==='all'?`(SELECT count(DISTINCT t.name) FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=c.id AND t.name=ANY(${p}::text[]))=cardinality(${p}::text[])`:`EXISTS(SELECT 1 FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.contact_id=c.id AND t.name=ANY(${p}::text[]))`);}
  if(a.q){const p=add('%'+a.q.replace(/[\\%_]/g,'\\$&')+'%');clauses.push(`(c.name ILIKE ${p} OR c.phone_e164 ILIKE ${p})`);}
 }
 const rows=(await db.query<Contact>(`SELECT c.* FROM contacts c ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY c.id LIMIT 10001`,params)).rows;
 if(rows.length>10000)throw new InputError('Audience melebihi 10.000 kontak. Persempit segmen terlebih dahulu.');
 const counts:Counts={selected:rows.length,eligible:0,archived:0,no_consent:0,opted_out:0,invalid:0,missing:a.mode==='manual'?a.ids.length-rows.length:0};counts.selected+=counts.missing;
 const contacts:Contact[]=[];
 for(const c of rows) {
  if(c.archived_at){counts.archived++;continue;}
  if(c.consent_status==='revoked'||(c.opted_out_at&&(!c.consent_at||new Date(c.consent_at)<=new Date(c.opted_out_at)))){counts.opted_out++;continue;}
  if(!eligible(c)||new Date(c.consent_at!).getTime()>Date.now()){counts.no_consent++;continue;}
  try{if(normalizePhone(c.phone_e164)!==c.phone_e164)throw new Error();}catch{counts.invalid++;continue;}
  counts.eligible++;contacts.push(c);
 }return {counts,contacts};
}
async function chosenTemplate(db:Query,id:string|null,waba:string|null) {
 if(!id)return null;const t=(await db.query<Template>('SELECT * FROM templates WHERE id=$1',[id])).rows[0];
 if(!t)throw new InputError('Template tidak ditemukan.','NOT_FOUND',404);return decorateTemplate(t,waba);
}
export async function previewDraft(db:Database,raw:unknown,waba:string|null,page=1) {
 const b=object(raw);const a=validateAudience(b.audience_rules);const mapping=validateMapping(b.variable_mapping);const id=b.template_id?uuid(b.template_id):null;
 if(!Number.isInteger(page)||page<1||page>2000)throw new InputError('Halaman preview tidak valid.');
 const {counts,contacts}=await audienceContacts(db,a);const t=await chosenTemplate(db,id,waba);
 const issues=t?mappingIssues(t,mapping):['Pilih template terlebih dahulu.'];if(!counts.eligible)issues.push('Belum ada kontak yang layak menerima pesan.');
 return {counts,issues,samples:t?contacts.slice((page-1)*5,page*5).map(c=>({id:c.id,name:c.name,phone_e164:c.phone_e164,parts:renderMessage(t,mapping,c)})):[],page,pages:Math.max(1,Math.ceil(contacts.length/5))};
}
export async function saveDraft(db:Database,raw:unknown,actor:string,waba:string|null) {
 const b=draftInput(raw);
 return db.transaction(async tx=>{
  const existing=(await tx.query<Campaign>('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[b.id])).rows[0];
  if(existing&&(existing.status!=='draft'||existing.version!==b.version))throw new InputError('Draft berubah atau tidak lagi dapat diedit. Buka ulang draft sebelum menyimpan.','STALE_DRAFT',409);
  if(!existing&&b.version!==undefined)throw new InputError('Draft tidak ditemukan.','NOT_FOUND',404);
  const t=await chosenTemplate(tx,b.template_id,waba);const {counts,contacts}=await audienceContacts(tx,b.audience_rules);
  const snapshot={ids:contacts.map(c=>c.id),counts,captured_at:new Date().toISOString()};
  const params=[b.name,b.template_id,t?JSON.stringify(t):null,JSON.stringify(b.audience_rules),JSON.stringify(snapshot),JSON.stringify(b.variable_mapping)];
  const result=existing?await tx.query<Campaign>(`UPDATE campaigns SET name=$1,template_id=$2,template_snapshot=$3,audience_rules=$4,audience_snapshot=$5,variable_mapping=$6,version=version+1 WHERE id=$7 RETURNING *`,[...params,b.id]):await tx.query<Campaign>(`INSERT INTO campaigns(name,template_id,template_snapshot,audience_rules,audience_snapshot,variable_mapping,id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[...params,b.id,actor]);
  await tx.query("INSERT INTO audit_logs(actor,action,entity,entity_id,safe_metadata) VALUES($1,$2,'campaign',$3,$4)",[actor,existing?'campaign.draft_updated':'campaign.draft_created',b.id,JSON.stringify({version:result.rows[0].version,eligible:counts.eligible})]);
  return result.rows[0];
 }).catch(e=>{if(e&&typeof e==='object'&&'code' in e&&e.code==='23505')throw new InputError('Draft sudah tersimpan atau berubah. Tutup dan buka ulang dari daftar campaign.','DRAFT_CONFLICT',409);throw e;});
}
export async function campaignList(db:Query,page:number,q:string) {
 if(!Number.isInteger(page)||page<1||page>10000||q.length>100)throw new InputError('Filter campaign tidak valid.');
 const search='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 const total=(await db.query<{total:number}>('SELECT count(*)::int AS total FROM campaigns WHERE name ILIKE $1',[search])).rows[0].total;
 const items=(await db.query<Pick<Campaign,'id'|'name'|'status'|'version'|'updated_at'>>('SELECT id,name,status,version,updated_at FROM campaigns WHERE name ILIKE $1 ORDER BY updated_at DESC,id LIMIT 25 OFFSET $2',[search,(page-1)*25])).rows;
 return {items,total,page};
}
export async function getCampaign(db:Query,id:string){const c=(await db.query<Campaign>('SELECT * FROM campaigns WHERE id=$1',[uuid(id)])).rows[0];if(!c)throw new InputError('Campaign tidak ditemukan.','NOT_FOUND',404);return c;}
// Preview and save intentionally never create campaign_recipients or dispatch_outbox records.
export type {Mapping};
