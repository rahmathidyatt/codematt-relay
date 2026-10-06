import type {Database} from '../netlify/lib/db.ts';
import {deliveryConfig} from '../netlify/lib/delivery-config.ts';
import {schedulerTick} from '../netlify/lib/queue.ts';
import {dispatchBatch} from '../netlify/lib/worker.ts';
import {processWebhook} from '../netlify/lib/webhooks.ts';
import {success} from '../netlify/lib/http.ts';
import {sameOrigin,jsonBody} from '../netlify/lib/contact-api.ts';
import {InputError,object,uuid} from '../src/features/contacts/validation.ts';
export async function handleDemoDelivery(request:Request,db:Database) {
 sameOrigin(request);if(request.method!=='POST')throw new InputError('Gunakan POST.','METHOD_NOT_ALLOWED',405);
 const value=object(await jsonBody(request));const id=uuid(value.campaign_id);const action=new URL(request.url).pathname.split('/').pop();const cfg=deliveryConfig(true)!;
 const c=(await db.query<{delivery_mode:string}>('SELECT delivery_mode FROM campaigns WHERE id=$1',[id])).rows[0];if(c?.delivery_mode!=='demo')throw new InputError('Pilih campaign simulasi yang sudah diluncurkan.');
 if(action==='tick') {await schedulerTick(db,cfg);return success(await dispatchBatch(db,id,cfg));}
 if(action==='event') {
  const r=(await db.query<{id:string;provider_message_id:string|null;phone_snapshot:string}>('SELECT id,provider_message_id,phone_snapshot FROM campaign_recipients WHERE id=$1 AND campaign_id=$2',[uuid(value.recipient_id),id])).rows[0];if(!r)throw new InputError('Penerima tidak ditemukan.');
  if(!['sent','delivered','read','failed','opt_out'].includes(String(value.status)))throw new InputError('Status simulasi tidak valid.');
  const timestamp=String(Math.floor(Date.now()/1000));let content:unknown;
  if(value.status==='opt_out')content={messages:[{id:'demo-stop-'+crypto.randomUUID(),from:r.phone_snapshot.replace(/^\+/,''),timestamp,type:'text',text:{body:'STOP'}}]};
  else {if(!r.provider_message_id)throw new InputError('Proses antrean simulasi terlebih dahulu.');content={statuses:[{id:r.provider_message_id,status:value.status,timestamp}]};}
  return success(await processWebhook(db,{object:'whatsapp_business_account',entry:[{id:cfg.waba,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},...(content as object)}}]}]},cfg));
 }
 throw new InputError('Endpoint demo tidak ditemukan.','NOT_FOUND',404);
}
