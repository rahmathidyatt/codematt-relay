import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import type {Database,Query} from './db.ts';
import {InputError,object,normalizePhone} from '../../src/features/contacts/validation.ts';
import {audit} from './contacts.ts';
export type WebhookConfig={waba:string;phoneId:string;secret:string;verifyToken:string};
export function webhookConfig(env:Record<string,string|undefined>=process.env):WebhookConfig|null {
 const {WHATSAPP_BUSINESS_ACCOUNT_ID:waba,WHATSAPP_PHONE_NUMBER_ID:phoneId,META_APP_SECRET:secret,WHATSAPP_VERIFY_TOKEN:verifyToken}=env;
 return waba&&phoneId&&secret&&verifyToken?{waba,phoneId,secret,verifyToken}:null;
}
export async function readWebhookBody(request:Request) {
 const reader=request.body?.getReader();if(!reader)throw new InputError('Body kosong.');let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024*1024){await reader.cancel();throw new InputError('Webhook terlalu besar.','PAYLOAD_TOO_LARGE',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
export function validSignature(body:Uint8Array,signature:string|null,secret:string) {
 if(!signature||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(body).digest();return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));
}
export function verifyChallenge(url:URL,config:WebhookConfig) {
 const mode=url.searchParams.get('hub.mode'),token=url.searchParams.get('hub.verify_token')??'',challenge=url.searchParams.get('hub.challenge');
 const a=Buffer.from(token),b=Buffer.from(config.verifyToken);
 if(mode!=='subscribe'||a.length!==b.length||!timingSafeEqual(a,b)||!challenge||challenge.length>200)throw new InputError('Verifikasi ditolak.','VERIFY_REJECTED',403);
 return challenge;
}
function timestamp(raw:unknown) {
 if(typeof raw!=='string'||!/^\d{1,12}$/.test(raw))throw new InputError('Timestamp webhook tidak valid.');
 const date=new Date(Number(raw)*1000);if(!Number.isFinite(+date)||+date>Date.now()+300000)throw new InputError('Timestamp webhook tidak valid.');return date;
}
export async function reconcileMessages(tx:Query) {
 const ids=(await tx.query<{provider_message_id:string}>(`SELECT DISTINCT e.provider_message_id FROM message_events e JOIN campaign_recipients r ON r.provider_message_id=e.provider_message_id JOIN campaigns c ON c.id=r.campaign_id WHERE e.recipient_id IS NULL AND e.source_waba=c.source_waba AND e.sender_id=c.sender_id LIMIT 500`)).rows.map(r=>r.provider_message_id);if(!ids.length)return;
 await tx.query(`UPDATE message_events e SET recipient_id=r.id FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE e.recipient_id IS NULL AND e.provider_message_id=r.provider_message_id AND e.source_waba=c.source_waba AND e.sender_id=c.sender_id AND e.provider_message_id=ANY($1::text[])`,[ids]);
 await tx.query(`WITH evidence AS (SELECT recipient_id,min(occurred_at) FILTER(WHERE status='sent') AS sent_at,min(occurred_at) FILTER(WHERE status='delivered') AS delivered_at,min(occurred_at) FILTER(WHERE status='read') AS read_at,min(occurred_at) FILTER(WHERE status='failed') AS failed_at FROM message_events WHERE recipient_id IS NOT NULL AND provider_message_id=ANY($1::text[]) GROUP BY recipient_id)
 UPDATE campaign_recipients r SET status=CASE WHEN e.read_at IS NOT NULL THEN 'read' WHEN e.delivered_at IS NOT NULL THEN 'delivered' WHEN e.failed_at IS NOT NULL THEN 'failed' ELSE 'sent' END,sent_at=COALESCE(r.sent_at,e.sent_at),delivered_at=COALESCE(r.delivered_at,e.delivered_at),read_at=COALESCE(r.read_at,e.read_at),failed_at=COALESCE(r.failed_at,e.failed_at),failure_code=CASE WHEN e.failed_at IS NOT NULL AND e.delivered_at IS NULL AND e.read_at IS NULL THEN 'PROVIDER_FAILED' ELSE NULL END,failure_reason=CASE WHEN e.failed_at IS NOT NULL AND e.delivered_at IS NULL AND e.read_at IS NULL THEN 'Meta melaporkan kegagalan pengiriman.' ELSE NULL END FROM evidence e WHERE r.id=e.recipient_id AND (r.status IS DISTINCT FROM CASE WHEN e.read_at IS NOT NULL THEN 'read' WHEN e.delivered_at IS NOT NULL THEN 'delivered' WHEN e.failed_at IS NOT NULL THEN 'failed' ELSE 'sent' END OR (r.sent_at IS NULL AND e.sent_at IS NOT NULL) OR (r.delivered_at IS NULL AND e.delivered_at IS NOT NULL) OR (r.read_at IS NULL AND e.read_at IS NOT NULL) OR (r.failed_at IS NULL AND e.failed_at IS NOT NULL))`,[ids]);
}
async function remember(tx:Query,key:string,type:string) {
 return (await tx.query<{id:string}>('INSERT INTO webhook_events(event_key,event_type) VALUES($1,$2) ON CONFLICT(event_key) DO NOTHING RETURNING id',[key,type])).rows[0]?.id;
}
export async function processWebhook(db:Database,raw:unknown,config:Pick<WebhookConfig,'waba'|'phoneId'>) {
 const body=object(raw);if(body.object!=='whatsapp_business_account')return {processed:0};if(!Array.isArray(body.entry)||body.entry.length>100)throw new InputError('Payload webhook tidak valid.');
 return db.transaction(async tx=>{
  await tx.query('UPDATE delivery_control SET last_webhook_at=now() WHERE id=true');
  let processed=0,seen=0;const keywordRows=await tx.query<{opt_out_keywords:string[]}>('SELECT opt_out_keywords FROM app_settings WHERE id=true');const keywords=keywordRows.rows[0].opt_out_keywords.map(s=>s.trim().toUpperCase());
  for(const rawEntry of body.entry as unknown[]) {
   const entry=object(rawEntry);if(entry.id!==config.waba)continue;if(!Array.isArray(entry.changes))continue;
   for(const rawChange of entry.changes) {
    const change=object(rawChange),value=object(change.value);if(++seen>500)throw new InputError('Terlalu banyak event.');
    if(change.field==='message_template_status_update') {
     const provider=String(value.message_template_id??''),status=String(value.event??'');
     if(!provider||!status)continue;
     const key=createHash('sha256').update(JSON.stringify([entry.id,'template',value])).digest('hex');const eventId=await remember(tx,key,'template');if(!eventId)continue;
     // A status webhook invalidates the cache; only a full sync can make it usable again.
     await tx.query("UPDATE templates SET status='UNAVAILABLE' WHERE provider_id=$1 AND source_waba=$2",[provider,config.waba]);
     await tx.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1',[eventId]);processed++;continue;
    }
    if(change.field!=='messages'||object(value.metadata).phone_number_id!==config.phoneId)continue;
    if(Array.isArray(value.statuses))for(const s0 of value.statuses) {
     if(++seen>500)throw new InputError('Terlalu banyak event.');const s=object(s0);if(!['sent','delivered','read','failed'].includes(String(s.status)))continue;
     if(typeof s.id!=='string'||s.id.length>300)throw new InputError('ID pesan tidak valid.');const at=timestamp(s.timestamp);
     const key=createHash('sha256').update(JSON.stringify([config.waba,config.phoneId,s.id,s.status,s.timestamp])).digest('hex');const eventId=await remember(tx,key,'status');if(!eventId)continue;
     await tx.query('INSERT INTO message_events(webhook_event_id,provider_message_id,status,occurred_at,source_waba,sender_id) VALUES($1,$2,$3,$4,$5,$6)',[eventId,s.id,s.status,at,config.waba,config.phoneId]);
     await tx.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1',[eventId]);processed++;
    }
    if(Array.isArray(value.messages))for(const m0 of value.messages) {
     if(++seen>500)throw new InputError('Terlalu banyak event.');const m=object(m0);
     const candidates:unknown[]=[];if(m.type==='text')candidates.push(object(m.text).body);if(m.type==='button'){candidates.push(object(m.button).text,object(m.button).payload);}if(m.type==='interactive'){const i=object(m.interactive);if(i.type==='button_reply'){const b=object(i.button_reply);candidates.push(b.title,b.id);}}
     if(!candidates.some(x=>typeof x==='string'&&keywords.includes(x.trim().toUpperCase())))continue;
     if(typeof m.id!=='string'||m.id.length>300)throw new InputError('ID pesan tidak valid.');const phone=normalizePhone('+'+String(m.from).replace(/^\+/,''));const occurred=timestamp(m.timestamp);const at=new Date(Math.min(+occurred,Date.now()));
     const key=createHash('sha256').update(JSON.stringify([config.waba,config.phoneId,'inbound',m.id])).digest('hex');const eventId=await remember(tx,key,'opt_out');if(!eventId)continue;
     await tx.query('INSERT INTO contact_suppressions(phone_e164,opted_out_at) VALUES($1,$2) ON CONFLICT(phone_e164) DO UPDATE SET opted_out_at=GREATEST(contact_suppressions.opted_out_at,excluded.opted_out_at)',[phone,at]);
     const contact=(await tx.query<{id:string;consent_at:string|null;opted_out_at:string|null}>('SELECT id,consent_at,opted_out_at FROM contacts WHERE phone_e164=$1 FOR UPDATE',[phone])).rows[0];
     if(contact) {
      const newerConsent=contact.consent_at&&new Date(contact.consent_at)>at;const newerOptout=contact.opted_out_at&&new Date(contact.opted_out_at)>at;
      if(!newerConsent&&!newerOptout)await tx.query("UPDATE contacts SET consent_status='revoked',opted_out_at=$2,opt_out_source='WhatsApp inbound opt-out' WHERE id=$1",[contact.id,at]);
      await tx.query("INSERT INTO consent_events(contact_id,status,source,occurred_at,actor) VALUES($1,'revoked','WhatsApp inbound opt-out',$2,'webhook')",[contact.id,at]);await audit(tx,'webhook','contact.opt_out_received','contact',contact.id,{ignoredForNewerConsent:Boolean(newerConsent)});
     }
     await tx.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1',[eventId]);processed++;
    }
   }
  }
  await reconcileMessages(tx);return {processed};
 });
}
