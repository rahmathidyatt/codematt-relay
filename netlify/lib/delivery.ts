import {createHash,randomUUID} from 'node:crypto';
import type {Database,Query} from './db.ts';
import {InputError,object,uuid} from '../../src/features/contacts/validation.ts';
import {validateAudience,validateMapping,type Template,type Campaign} from '../../src/features/campaigns/model.ts';
import {zones,type DeliveryCampaign} from '../../src/features/delivery/model.ts';
import {audienceContacts} from './campaigns.ts';
import {decorateTemplate} from './templates.ts';
import {messageParameters} from './whatsapp.ts';
import type {DeliveryConfig} from './delivery-config.ts';
import {audit} from './contacts.ts';
export async function wakeCampaign(tx:Query,id:string,at=new Date()) {
 await tx.query(`INSERT INTO dispatch_outbox(campaign_id,dedupe_key,available_at) VALUES($1,$2,$3) ON CONFLICT(campaign_id) DO UPDATE SET available_at=excluded.available_at,published_at=NULL,generation=dispatch_outbox.generation+1,lease_token=NULL,lease_expires_at=NULL`,[id,'dispatch:'+id,at]);
}
async function campaign(tx:Query,id:string,lock=false) {const c=(await tx.query<DeliveryCampaign>(`SELECT * FROM campaigns WHERE id=$1 ${lock?'FOR UPDATE':''}`,[uuid(id)])).rows[0];if(!c)throw new InputError('Campaign tidak ditemukan.','NOT_FOUND',404);return c;}
export async function prepareDelivery(tx:Query,c:Campaign,waba:string|null) {
 if(c.status!=='draft')throw new InputError('Campaign sudah diluncurkan atau tidak lagi berupa draft.','NOT_DRAFT',409);
 const raw=(await tx.query<Template>('SELECT * FROM templates WHERE id=$1',[c.template_id])).rows[0];if(!raw)throw new InputError('Pilih template terlebih dahulu.');
 const t=decorateTemplate(raw,waba);const m=validateMapping(c.variable_mapping);const a=await audienceContacts(tx,validateAudience(c.audience_rules));
 if(!a.contacts.length)throw new InputError('Tidak ada kontak layak. Periksa audience dan consent.');
 const recipients=a.contacts.map(contact=>({contact_id:contact.id,phone:contact.phone_e164,parameters:messageParameters(t,m,contact)}));
 const hash=createHash('sha256').update(JSON.stringify({id:c.id,version:c.version,template:{id:t.provider_id,waba:t.source_waba,name:t.name,language:t.language,components:t.components,format:t.parameter_format},recipients,contactVersions:a.contacts.map(x=>x.version)})).digest('hex');
 return {template:t,recipients,hash,counts:a.counts,samples:a.contacts.slice(0,100).map(c=>({id:c.id,name:c.name}))};
}
export async function reviewDelivery(db:Query,id:string,waba:string|null,enabled:boolean,demo:boolean) {
 const c=await campaign(db,id);const r=await prepareDelivery(db,c,waba);return {version:c.version,hash:r.hash,counts:r.counts,name:c.name,template:r.template.name,language:r.template.language,enabled,demo,samples:r.samples};
}
export function scheduleInput(raw:unknown,zone:unknown) {
 if(typeof zone!=='string'||!Object.hasOwn(zones,zone))throw new InputError('Zona waktu tidak didukung.');
 if(raw===null||raw===undefined||raw==='')return null;
 if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw))throw new InputError('Jadwal wajib memiliki zona waktu.');
 const [year,month,day]=raw.slice(0,10).split('-').map(Number);if(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==raw.slice(0,10))throw new InputError('Tanggal jadwal tidak valid.');
 const at=new Date(raw);if(!Number.isFinite(+at)||+at<Date.now()+60000||+at>Date.now()+365*86400000)throw new InputError('Jadwal minimal 1 menit dan maksimal 1 tahun dari sekarang.');
 return at;
}
export async function launchCampaign(db:Database,id:string,raw:unknown,actor:string,cfg:DeliveryConfig,test=false) {
 const b=object(raw);if(b.confirmed!==true)throw new InputError('Konfirmasi persetujuan penerima terlebih dahulu.');
 const at=scheduleInput(test?null:b.scheduled_at,b.timezone??'Asia/Jakarta');
 return db.transaction(async tx=>{
  const original=await campaign(tx,id,true);
  if(!test&&original.status!=='draft') {
   // An exact repeated launch returns existing state; it can never create another set of recipients.
   if(original.consent_confirmed_by===actor&&original.delivery_mode===(cfg.demo?'demo':'live'))return {id:original.id,status:original.status,replayed:true};
   throw new InputError('Campaign tidak dapat diluncurkan ulang.','CONFLICT',409);
  }
  if(original.version!==b.version)throw new InputError('Draft berubah. Periksa ulang sebelum meluncurkan.','STALE_DRAFT',409);
  const review=await prepareDelivery(tx,original,cfg.waba);
  if(b.review_hash!==review.hash)throw new InputError('Audience, consent, atau template berubah. Periksa ulang ringkasan.','REVIEW_CHANGED',409);
  if(!test&&review.recipients.length>=100&&b.confirm_name!==original.name)throw new InputError('Ketik nama campaign untuk konfirmasi 100 penerima atau lebih.');
  let target=original.id,recipients=review.recipients;
  if(test){target=uuid(b.test_id);const selected=uuid(b.contact_id);recipients=recipients.filter(r=>r.contact_id===selected);if(recipients.length!==1)throw new InputError('Kontak test harus layak dan termasuk audience draft.');
   const prior=(await tx.query<DeliveryCampaign>('SELECT * FROM campaigns WHERE id=$1',[target])).rows[0];
   if(prior){if(prior.parent_id!==original.id||!prior.is_test)throw new InputError('ID test sudah dipakai.','CONFLICT',409);return {id:prior.id,status:prior.status,replayed:true};}
   await tx.query(`INSERT INTO campaigns(id,name,template_id,variable_mapping,audience_rules,created_by,is_test,parent_id) VALUES($1,$2,$3,$4,$5,$6,true,$7)`,[target,'Test · '+original.name.slice(0,190),original.template_id,JSON.stringify(original.variable_mapping),JSON.stringify({...original.audience_rules,mode:'manual',ids:[selected]}),actor,original.id]);
  }
  const status=at?'scheduled':'queued';
  await tx.query(`UPDATE campaigns SET status=$2,scheduled_at=$3,timezone=$4,delivery_mode=$5,source_waba=$6,sender_id=$7,template_snapshot=$8,audience_snapshot=$9,consent_confirmed_by=$10,consent_confirmed_at=now(),version=version+1 WHERE id=$1`,[target,status,at,b.timezone??'Asia/Jakarta',cfg.demo?'demo':'live',cfg.waba,cfg.phoneId,JSON.stringify(review.template),JSON.stringify({ids:recipients.map(r=>r.contact_id),counts:review.counts,captured_at:new Date().toISOString()}),actor]);
  await tx.query(`INSERT INTO campaign_recipients(campaign_id,contact_id,phone_snapshot,message_parameters) SELECT $1,x.contact_id,x.phone,x.parameters FROM jsonb_to_recordset($2::jsonb) AS x(contact_id uuid,phone text,parameters jsonb)`,[target,JSON.stringify(recipients)]);
  await wakeCampaign(tx,target,at??new Date());await audit(tx,actor,test?'campaign.test_queued':at?'campaign.scheduled':'campaign.launched','campaign',target,{recipients:recipients.length,mode:cfg.demo?'demo':'live'});
  return {id:target,status,replayed:false};
 });
}
export async function controlCampaign(db:Database,id:string,raw:unknown,action:'pause'|'resume'|'cancel',actor:string,cfg:DeliveryConfig|null) {
 const b=object(raw);return db.transaction(async tx=>{
  const c=await campaign(tx,id,true);if(c.version!==b.version)throw new InputError('Campaign berubah. Muat ulang detail.','STALE_CAMPAIGN',409);
  if(action==='pause'&&!['scheduled','queued','sending'].includes(c.status)||action==='resume'&&c.status!=='paused'||action==='cancel'&&!['scheduled','queued','sending','paused'].includes(c.status))throw new InputError('Tindakan tidak sesuai status campaign.','CONFLICT',409);
  const next=action==='pause'?'paused':action==='cancel'?'canceled':c.scheduled_at&&new Date(c.scheduled_at)>new Date()?'scheduled':'queued';
  if(action==='resume') {
   if(!cfg||c.source_waba!==cfg.waba||c.sender_id!==cfg.phoneId||c.delivery_mode!==(cfg.demo?'demo':'live'))throw new InputError('Konfigurasi pengiriman berubah atau nonaktif.');
   const t=(await tx.query<Template>('SELECT * FROM templates WHERE id=$1',[c.template_id])).rows[0];if(!t||!decorateTemplate(t,cfg.waba).usable)throw new InputError('Sinkronkan dan periksa template sebelum melanjutkan.');
   if(JSON.stringify(t.components)!==JSON.stringify(c.template_snapshot?.components))throw new InputError('Isi template berubah. Batalkan campaign dan buat draft baru.');
   await wakeCampaign(tx,id,next==='scheduled'?new Date(c.scheduled_at!):new Date());
  }
  if(action==='cancel'){if(b.confirmed!==true)throw new InputError('Konfirmasi pembatalan terlebih dahulu.');await tx.query("UPDATE campaign_recipients SET status='skipped',failure_code='CANCELED',failure_reason='Dibatalkan sebelum pengiriman.' WHERE campaign_id=$1 AND status='queued'",[id]);}
  await tx.query('UPDATE campaigns SET status=$2,pause_reason=$3,version=version+1 WHERE id=$1',[id,next,action==='pause'?'Dijeda oleh operator.':null]);await audit(tx,actor,'campaign.'+action,'campaign',id);return {status:next};
 });
}
export async function deliveryDetail(db:Query,id:string,page:number,enabled:boolean,demo:boolean) {
 if(!Number.isInteger(page)||page<1||page>1000)throw new InputError('Halaman tidak valid.');const c=await campaign(db,id);
 const grouped=(await db.query<{status:string;count:number}>('SELECT status,count(*)::int AS count FROM campaign_recipients WHERE campaign_id=$1 GROUP BY status',[id])).rows;const counts=Object.fromEntries(grouped.map(r=>[r.status,r.count]));
 const items=(await db.query(`SELECT r.id,c.name,r.phone_snapshot,r.status,r.attempt_count,r.failure_code,r.failure_reason,r.provider_message_id,r.next_attempt_at FROM campaign_recipients r JOIN contacts c ON c.id=r.contact_id WHERE r.campaign_id=$1 ORDER BY r.created_at,r.id LIMIT 25 OFFSET $2`,[id,(page-1)*25])).rows;
 const outbox=(await db.query('SELECT available_at,published_at,attempts FROM dispatch_outbox WHERE campaign_id=$1',[id])).rows[0]??null;
 const health=(await db.query('SELECT last_scheduler_at,last_worker_at,last_webhook_at FROM delivery_control WHERE id=true')).rows[0];
 return {campaign:c,counts,items,total:grouped.reduce((n,r)=>n+r.count,0),page,outbox,enabled,demo,...health};
}
export const newLease=()=>randomUUID();
