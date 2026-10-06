import type {Database} from './db.ts';
import type {DeliveryConfig} from './delivery-config.ts';
import type {Template} from '../../src/features/campaigns/model.ts';
import type {DeliveryCampaign} from '../../src/features/delivery/model.ts';
import type {Contact} from '../../src/features/contacts/types.ts';
import {eligible,normalizePhone,uuid} from '../../src/features/contacts/validation.ts';
import {decorateTemplate} from './templates.ts';
import {newLease,wakeCampaign} from './delivery.ts';
import {settleCampaign} from './queue.ts';
import {reconcileMessages} from './webhooks.ts';
import {sendWhatsApp,type SendResult,type MessagePart} from './whatsapp.ts';
import {audit} from './contacts.ts';
type WorkRecipient={id:string;contact_id:string;phone_snapshot:string;message_parameters:MessagePart[];attempt_count:number};
export type Sender=(to:string,template:Template,parameters:MessagePart[],attempt:number,id:string)=>Promise<SendResult>;
function sameTemplate(a:Template,b:Template) {return a.provider_id===b.provider_id&&a.name===b.name&&a.language===b.language&&a.parameter_format===b.parameter_format&&JSON.stringify(a.components)===JSON.stringify(b.components);}
export async function dispatchBatch(db:Database,campaignId:string,cfg:DeliveryConfig,send?:Sender) {
 uuid(campaignId);const owner=newLease(),started=Date.now();let processed=0;
 const claimed=await db.query(`UPDATE delivery_control SET lease_token=$1,lease_expires_at=now()+interval '90 seconds',last_worker_at=now() WHERE id=true AND (lease_expires_at IS NULL OR lease_expires_at<now()) RETURNING id`,[owner]);
 if(!claimed.rows.length)return {processed:0,busy:true};
 const sender:Sender=send??(cfg.demo?async(_to,_t,_p,_a,id)=>({kind:'accepted',id:'demo-'+id}):async(to,t,p,a)=>sendWhatsApp(cfg,to,t,p,a));
 try {
  for(let i=0;i<cfg.batchSize&&Date.now()-started<35000;i++) {
   const claim=await db.transaction(async tx=>{
    const gate=(await tx.query<{lease_token:string;next_send_at:string;lease_expires_at:string}>('SELECT lease_token,next_send_at,lease_expires_at FROM delivery_control WHERE id=true FOR UPDATE')).rows[0];
    if(gate.lease_token!==owner||new Date(gate.lease_expires_at)<=new Date()||new Date(gate.next_send_at)>new Date())return null;
    const c=(await tx.query<DeliveryCampaign>('SELECT * FROM campaigns WHERE id=$1 FOR UPDATE',[campaignId])).rows[0];
    if(!c||!['queued','sending'].includes(c.status)||c.delivery_mode!==(cfg.demo?'demo':'live'))return null;
    if(c.source_waba!==cfg.waba||c.sender_id!==cfg.phoneId){await tx.query("UPDATE campaigns SET status='paused',pause_reason='Akun pengirim berubah.',version=version+1 WHERE id=$1",[campaignId]);return null;}
    const raw=(await tx.query<Template>('SELECT * FROM templates WHERE id=$1',[c.template_id])).rows[0];const template=raw?decorateTemplate(raw,cfg.waba):null;
    if(!template?.usable||!c.template_snapshot||!sameTemplate(template,c.template_snapshot)) {await tx.query("UPDATE campaigns SET status='paused',pause_reason=$2,version=version+1 WHERE id=$1",[campaignId,template?.reason||'Konten template berubah. Periksa lalu buat campaign baru jika perlu.']);return null;}
    const r=(await tx.query<WorkRecipient>("SELECT * FROM campaign_recipients WHERE campaign_id=$1 AND status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=now()) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",[campaignId])).rows[0];if(!r)return null;
    const contact=(await tx.query<Contact>('SELECT * FROM contacts WHERE id=$1 FOR UPDATE',[r.contact_id])).rows[0];
    const suppression=(await tx.query<{opted_out_at:string}>('SELECT opted_out_at FROM contact_suppressions WHERE phone_e164=$1',[r.phone_snapshot])).rows[0];
    let valid=contact&&eligible(contact)&&new Date(contact.consent_at!).getTime()<=Date.now()&&contact.phone_e164===r.phone_snapshot&&(!suppression||new Date(contact.consent_at!)>new Date(suppression.opted_out_at));
    try{valid=valid&&normalizePhone(r.phone_snapshot)===r.phone_snapshot;}catch{valid=false;}
    if(!valid){await tx.query("UPDATE campaign_recipients SET status='skipped',failure_code='INELIGIBLE',failure_reason='Consent, opt-out, arsip, atau nomor berubah.' WHERE id=$1",[r.id]);return {skipped:true as const};}
    const token=newLease();await tx.query("UPDATE campaign_recipients SET status='dispatching',attempt_count=attempt_count+1,lease_token=$2,lease_expires_at=now()+interval '2 minutes',dispatch_started_at=now() WHERE id=$1",[r.id,token]);
    await tx.query("UPDATE campaigns SET status='sending',started_at=COALESCE(started_at,now()) WHERE id=$1",[campaignId]);
    await tx.query("UPDATE delivery_control SET lease_expires_at=now()+interval '90 seconds',next_send_at=now()+($2*interval '1 millisecond') WHERE id=true AND lease_token=$1",[owner,cfg.minInterval]);
    return {skipped:false as const,r,token,template};
   });
   if(!claim)break;if(claim.skipped){processed++;continue;}
   // Once this intent is committed, no lease recovery can ever put it back in the queue.
   let result:SendResult;try{result=await sender(claim.r.phone_snapshot,claim.template,claim.r.message_parameters,claim.r.attempt_count+1,claim.r.id);}catch{result={kind:'uncertain',code:'ADAPTER_INTERRUPTED'};}
   await db.transaction(async tx=>{
    await tx.query('SELECT id FROM delivery_control WHERE id=true FOR UPDATE');
    const campaign=(await tx.query<{status:string}>('SELECT status FROM campaigns WHERE id=$1 FOR UPDATE',[campaignId])).rows[0];
    const current=(await tx.query<{status:string;lease_token:string;attempt_count:number}>('SELECT status,lease_token,attempt_count FROM campaign_recipients WHERE id=$1 FOR UPDATE',[claim.r.id])).rows[0];
    if(current.lease_token!==claim.token||!['dispatching','uncertain'].includes(current.status))return;
    if(result.kind==='retry')await tx.query('UPDATE delivery_control SET next_send_at=GREATEST(next_send_at,$1) WHERE id=true',[new Date(Date.now()+result.after)]);
    if(result.kind==='accepted')await tx.query("UPDATE campaign_recipients SET status='accepted',provider_message_id=$2,accepted_at=now(),lease_expires_at=NULL,failure_code=NULL,failure_reason=NULL WHERE id=$1",[claim.r.id,result.id]);
    else if(result.kind==='retry'&&current.attempt_count<5&&campaign.status!=='canceled') {
     const at=new Date(Date.now()+result.after);await tx.query("UPDATE campaign_recipients SET status='queued',next_attempt_at=$2,lease_expires_at=NULL,failure_code=$3,failure_reason='Dibatasi provider; menunggu retry.' WHERE id=$1",[claim.r.id,at,result.code]);
     await tx.query('UPDATE delivery_control SET next_send_at=GREATEST(next_send_at,$1) WHERE id=true',[at]);
    } else if(result.kind==='pause'&&campaign.status!=='canceled') {
     await tx.query("UPDATE campaign_recipients SET status='failed',failure_code=$2,failure_reason='Provider menolak. Periksa konfigurasi/quality sebelum melanjutkan.',lease_expires_at=NULL WHERE id=$1",[claim.r.id,result.code]);
     await tx.query("UPDATE campaigns SET status='paused',pause_reason=$2,version=version+1 WHERE id=$1",[campaignId,'Provider menolak: '+result.code]);await audit(tx,'worker','campaign.provider_paused','campaign',campaignId,{code:result.code});
    } else await tx.query("UPDATE campaign_recipients SET status=$2,failure_code=$3,failure_reason=$4,lease_expires_at=NULL WHERE id=$1",[claim.r.id,result.kind==='uncertain'?'uncertain':result.kind==='retry'&&campaign.status==='canceled'?'skipped':'failed',result.code,result.kind==='uncertain'?'Hasil belum pasti. Tidak dikirim ulang otomatis.':'Permintaan ditolak atau batas percobaan tercapai.']);
    await reconcileMessages(tx);
   });
   processed++;
   if(result.kind==='retry'||result.kind==='pause')break;
   if(cfg.minInterval&&Date.now()-started+cfg.minInterval<35000)await new Promise(resolve=>setTimeout(resolve,cfg.minInterval));
  }
  await db.transaction(async tx=>{
   await tx.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[campaignId]);await settleCampaign(tx,campaignId);
   const c=(await tx.query<{status:string}>('SELECT status FROM campaigns WHERE id=$1',[campaignId])).rows[0];
   if(c&&['queued','sending'].includes(c.status)) {
    const r=(await tx.query<{at:string|null}>("SELECT min(COALESCE(next_attempt_at,now())) AS at FROM campaign_recipients WHERE campaign_id=$1 AND status='queued'",[campaignId])).rows[0];
    if(r.at)await wakeCampaign(tx,campaignId,new Date(r.at));
   }
  });
  return {processed,busy:false};
 }finally{await db.query('UPDATE delivery_control SET lease_token=NULL,lease_expires_at=NULL WHERE id=true AND lease_token=$1',[owner]);}
}
