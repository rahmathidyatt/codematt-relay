import type {Database,Query} from './db.ts';
import type {DeliveryConfig} from './delivery-config.ts';
import {wakeCampaign,newLease} from './delivery.ts';
import {reconcileMessages} from './webhooks.ts';
export async function settleCampaign(tx:Query,id:string) {
 const state=(await tx.query<{pending:number;bad:number}>(`SELECT count(*) FILTER(WHERE status IN ('queued','dispatching'))::int AS pending,count(*) FILTER(WHERE status IN ('failed','uncertain'))::int AS bad FROM campaign_recipients WHERE campaign_id=$1`,[id])).rows[0];
 if(!state.pending)await tx.query("UPDATE campaigns SET status=$2,completed_at=now(),version=version+1 WHERE id=$1 AND status IN ('queued','sending')",[id,state.bad?'failed':'completed']);
}
export async function schedulerTick(db:Database,cfg:DeliveryConfig) {
 return db.transaction(async tx=>{
  await tx.query('UPDATE delivery_control SET last_scheduler_at=now() WHERE id=true');
  await tx.query("UPDATE campaign_recipients SET status='uncertain',failure_code='WORKER_INTERRUPTED',failure_reason='Worker terhenti setelah klaim. Tidak dikirim ulang otomatis.' WHERE status='dispatching' AND lease_expires_at<now()");
  await reconcileMessages(tx);
  const campaigns=(await tx.query<{id:string;status:string}>(`SELECT id,status FROM campaigns WHERE delivery_mode=$1 AND status IN ('scheduled','queued','sending') AND (scheduled_at IS NULL OR scheduled_at<=now()) ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED`,[cfg.demo?'demo':'live'])).rows;
  for(const c of campaigns) {
   if(c.status==='scheduled')await tx.query("UPDATE campaigns SET status='queued',version=version+1 WHERE id=$1",[c.id]);
   await settleCampaign(tx,c.id);
   const pending=(await tx.query<{due:string|null}>("SELECT min(COALESCE(next_attempt_at,now())) AS due FROM campaign_recipients WHERE campaign_id=$1 AND status='queued'",[c.id])).rows[0];
   if(!pending.due)continue;
   const box=(await tx.query<{published_at:string|null;lease_expires_at:string|null}>('SELECT published_at,lease_expires_at FROM dispatch_outbox WHERE campaign_id=$1',[c.id])).rows[0];
   if(!box||(box.published_at&&new Date(box.published_at).getTime()<Date.now()-120000))await wakeCampaign(tx,c.id,new Date(pending.due));
  }
  return {checked:campaigns.length};
 });
}
export type Publish=(data:{campaignId:string;generation:number})=>Promise<void>;
export async function publishOutbox(db:Database,publish:Publish,cfg:DeliveryConfig) {
 const lease=newLease();const rows=await db.transaction(async tx=>{
  const r=await tx.query<{id:string;campaign_id:string;generation:number}>(`SELECT o.id,o.campaign_id,o.generation FROM dispatch_outbox o JOIN campaigns c ON c.id=o.campaign_id WHERE o.published_at IS NULL AND o.available_at<=now() AND (o.lease_expires_at IS NULL OR o.lease_expires_at<now()) AND c.status IN ('queued','sending') AND c.delivery_mode=$1 ORDER BY o.available_at LIMIT 10 FOR UPDATE OF o SKIP LOCKED`,[cfg.demo?'demo':'live']);
  for(const o of r.rows)await tx.query("UPDATE dispatch_outbox SET lease_token=$2,lease_expires_at=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",[o.id,lease]);return r.rows;
 });
 let sent=0;
 for(const o of rows)try{
  await publish({campaignId:o.campaign_id,generation:o.generation});
  await db.query('UPDATE dispatch_outbox SET published_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=$1 AND generation=$2 AND lease_token=$3',[o.id,o.generation,lease]);sent++;
 }catch{await db.query("UPDATE dispatch_outbox SET lease_token=NULL,lease_expires_at=NULL,available_at=now()+interval '1 minute' WHERE id=$1 AND generation=$2 AND lease_token=$3",[o.id,o.generation,lease]);}
 return {published:sent,attempted:rows.length};
}
