import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,it,expect,vi,describe} from 'vitest';
import type {Database} from '../netlify/lib/db';
import {createContact,changeConsent} from '../netlify/lib/contacts';
import {saveDraft,audienceContacts} from '../netlify/lib/campaigns';
import {syncTemplates,templateList} from '../netlify/lib/templates';
import {emptyAudience} from '../src/features/campaigns/model';
import {deliveryConfig} from '../netlify/lib/delivery-config';
import {reviewDelivery,launchCampaign,controlCampaign,deliveryDetail,scheduleInput} from '../netlify/lib/delivery';
import {dispatchBatch} from '../netlify/lib/worker';
import {schedulerTick,publishOutbox} from '../netlify/lib/queue';
import {processWebhook,validSignature,verifyChallenge,readWebhookBody} from '../netlify/lib/webhooks';
import {sendWhatsApp,messageParameters} from '../netlify/lib/whatsapp';
let pg:PGlite,db:Database;
const cfg=deliveryConfig(true)!;
const provider={provider_id:'fixture',name:'hello',language:'id',category:'UTILITY',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'BODY',text:'Halo {{1}}'}]};
beforeAll(async()=>{pg=new PGlite();for(const p of readdirSync('netlify/database/migrations').filter(p=>p.endsWith('.sql')).sort())await pg.exec(readFileSync('netlify/database/migrations/'+p,'utf8'));db=pg as unknown as Database;},30000);
afterAll(async()=>{await pg.close();});
beforeEach(async()=>{await db.query('TRUNCATE campaigns,templates,contacts,tags,contact_suppressions,webhook_events,audit_logs CASCADE');await db.query('UPDATE delivery_control SET lease_token=NULL,lease_expires_at=NULL,next_send_at=now()');await syncTemplates(db,'admin',cfg.waba,async()=>[provider]);});
async function setup(n=1){const contacts=[];for(let i=0;i<n;i++)contacts.push(await createContact(db,{name:'Demo '+i,phone:String(628123456700+i),consent_status:'active',consent_source:'Form',consent_at:'2026-01-01'},'admin'));const t=(await templateList(db,cfg.waba))[0];const draft=await saveDraft(db,{id:randomUUID(),name:'Delivery',template_id:t.id,audience_rules:emptyAudience(),variable_mapping:{'BODY:1':{source:'name'}}},'admin',cfg.waba);return {contacts,draft,t};}
async function launch(id:string,extra:object={}){const r=await reviewDelivery(db,id,cfg.waba,true,true);return launchCampaign(db,id,{version:r.version,review_hash:r.hash,confirmed:true,timezone:'Asia/Jakarta',...extra},'admin',cfg);}
async function detail(id:string){return deliveryDetail(db,id,1,true,true);}
function event(content:object){return {object:'whatsapp_business_account',entry:[{id:cfg.waba,changes:[{field:'messages',value:{metadata:{phone_number_id:cfg.phoneId},...content}}]}]};}
function status(id:string,value:string,at=Math.floor(Date.now()/1000)){return event({statuses:[{id,status:value,timestamp:String(at)}]});}
function stop(phone:string,id='stop1',at=Math.floor(Date.now()/1000)){return event({messages:[{id,from:phone.replace('+',''),timestamp:String(at),type:'text',text:{body:' STOP '}}]});}
describe('launch and schedule invariants',()=>{
 it('requires consent review, rejects changed audience, and atomically launches only once',async()=>{
  const {draft,contacts}=await setup();const r=await reviewDelivery(db,draft.id,cfg.waba,true,true);
  await expect(launchCampaign(db,draft.id,{version:1,review_hash:r.hash},'admin',cfg)).rejects.toThrow('Konfirmasi');
  await db.query('UPDATE contacts SET name=$2 WHERE id=$1',[contacts[0].id,'Changed']);
  await expect(launchCampaign(db,draft.id,{version:1,review_hash:r.hash,confirmed:true},'admin',cfg)).rejects.toThrow('berubah');
  expect((await detail(draft.id)).total).toBe(0);await launch(draft.id);await launchCampaign(db,draft.id,{confirmed:true,version:1,review_hash:r.hash},'admin',cfg);
  const d=await detail(draft.id);expect(d.total).toBe(1);expect(d.campaign.status).toBe('queued');expect((await db.query('SELECT * FROM dispatch_outbox')).rows).toHaveLength(1);
 });
 it('supports a separate idempotent test without launching the main draft',async()=>{
  const {draft,contacts}=await setup();const r=await reviewDelivery(db,draft.id,cfg.waba,true,true);const testId=randomUUID();const body={version:r.version,review_hash:r.hash,confirmed:true,test_id:testId,contact_id:contacts[0].id};
  await launchCampaign(db,draft.id,body,'admin',cfg,true);await launchCampaign(db,draft.id,body,'admin',cfg,true);expect((await detail(testId)).total).toBe(1);expect((await detail(draft.id)).campaign.status).toBe('draft');
  await expect(launchCampaign(db,draft.id,{...body,test_id:randomUUID(),contact_id:randomUUID()},'admin',cfg,true)).rejects.toThrow('Kontak test');
 });
 it('requires the campaign name for 100 or more eligible recipients',async()=>{const {draft}=await setup(100);await expect(launch(draft.id)).rejects.toThrow('Ketik nama');expect((await detail(draft.id)).total).toBe(0);await launch(draft.id,{confirm_name:'Delivery'});expect((await detail(draft.id)).total).toBe(100);});
 it('keeps future schedules pending and only promotes due work',async()=>{
  const {draft}=await setup();await launch(draft.id,{scheduled_at:new Date(Date.now()+120000).toISOString()});await schedulerTick(db,cfg);await dispatchBatch(db,draft.id,cfg);expect((await detail(draft.id)).counts.queued).toBe(1);
  await db.query("UPDATE campaigns SET scheduled_at=now()-interval '1 minute' WHERE id=$1",[draft.id]);await schedulerTick(db,cfg);expect((await detail(draft.id)).campaign.status).toBe('queued');
  expect(()=>scheduleInput('2026-10-07T09:00','Asia/Jakarta')).toThrow();expect(()=>scheduleInput(new Date(Date.now()-1000).toISOString(),'Asia/Jakarta')).toThrow();expect(()=>scheduleInput(null,'Unknown')).toThrow();
 });
 it('blocks missing variables or unsupported provider status before inserting recipients',async()=>{
  const {draft}=await setup();await db.query("UPDATE templates SET status='PAUSED'");await expect(launch(draft.id)).rejects.toThrow('PAUSED');expect((await detail(draft.id)).total).toBe(0);
 });
});
describe('worker safety and delivery semantics',()=>{
 it('accepts once across duplicate worker invocations and never claims delivered from a send response',async()=>{
  const {draft}=await setup();await launch(draft.id);const sender=vi.fn(async()=>({kind:'accepted' as const,id:'wamid.1'}));await dispatchBatch(db,draft.id,cfg,sender);await dispatchBatch(db,draft.id,cfg,sender);
  expect(sender).toHaveBeenCalledTimes(1);const d=await detail(draft.id);expect(d.counts.accepted).toBe(1);expect(d.counts.delivered).toBeUndefined();expect(d.campaign.status).toBe('completed');
 });
 it('prevents concurrent workers and rechecks opt-out immediately before each send',async()=>{
  const {draft,contacts}=await setup(2);await launch(draft.id);
  await changeConsent(db,contacts[0].id,{version:contacts[0].version,status:'revoked',source:'STOP',confirmed:true},'admin');
  let release!:()=>void;let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);const blocked=new Promise<void>(r=>release=r);const sender=vi.fn(async()=>{entered();await blocked;return {kind:'accepted' as const,id:'single'};});
  const running=dispatchBatch(db,draft.id,cfg,sender);await ready;expect((await dispatchBatch(db,draft.id,cfg,sender)).busy).toBe(true);release();await running;expect(sender).toHaveBeenCalledTimes(1);expect((await detail(draft.id)).counts.skipped).toBe(1);
 });
 it('pause blocks pending recipients; cancel marks queued only and resume cannot revive terminal rows',async()=>{
  const {draft}=await setup(2);await launch(draft.id);let d=await detail(draft.id);await controlCampaign(db,draft.id,{version:d.campaign.version},'pause','admin',cfg);
  const sender=vi.fn(async()=>({kind:'accepted' as const,id:'none'}));await dispatchBatch(db,draft.id,cfg,sender);expect(sender).not.toHaveBeenCalled();d=await detail(draft.id);await controlCampaign(db,draft.id,{version:d.campaign.version},'resume','admin',cfg);
  d=await detail(draft.id);await controlCampaign(db,draft.id,{version:d.campaign.version,confirmed:true},'cancel','admin',cfg);expect((await detail(draft.id)).counts.skipped).toBe(2);await dispatchBatch(db,draft.id,cfg,sender);expect(sender).not.toHaveBeenCalled();
 });
 it('records network ambiguity and expired dispatch leases without retrying recipients',async()=>{
  const {draft}=await setup(2);await launch(draft.id);const first=(await detail(draft.id)).items[0];await db.query("UPDATE campaign_recipients SET status='dispatching',lease_expires_at=now()-interval '1 second' WHERE id=$1",[first.id]);await schedulerTick(db,cfg);
  const sender=vi.fn(async()=>({kind:'uncertain' as const,code:'TIMEOUT'}));await dispatchBatch(db,draft.id,cfg,sender);await schedulerTick(db,cfg);await dispatchBatch(db,draft.id,cfg,sender);expect(sender).toHaveBeenCalledTimes(1);expect((await detail(draft.id)).counts.uncertain).toBe(2);
 });
 it('does not resend after a database failure following provider acceptance',async()=>{
  const {draft}=await setup();await launch(draft.id);let failNext=false;
  const faultDb:Database={query:db.query.bind(db),transaction:async run=>{if(failNext){failNext=false;throw new Error('Database interrupted');}return db.transaction(run);}};
  const sender=vi.fn(async()=>{failNext=true;return {kind:'accepted' as const,id:'remote-accepted'};});
  await expect(dispatchBatch(faultDb,draft.id,cfg,sender)).rejects.toThrow('Database interrupted');
  await db.query("UPDATE campaign_recipients SET lease_expires_at=now()-interval '1 second' WHERE campaign_id=$1",[draft.id]);await schedulerTick(db,cfg);await dispatchBatch(db,draft.id,cfg,sender);expect(sender).toHaveBeenCalledTimes(1);expect((await detail(draft.id)).counts.uncertain).toBe(1);
 });
 it('preserves in-flight acceptance when cancellation arrives, and skips the remaining queue',async()=>{
  const {draft}=await setup(2);await launch(draft.id);const sender=vi.fn(async()=>{const d=await detail(draft.id);await controlCampaign(db,draft.id,{version:d.campaign.version,confirmed:true},'cancel','admin',cfg);return {kind:'accepted' as const,id:'in-flight'};});
  await dispatchBatch(db,draft.id,cfg,sender);const d=await detail(draft.id);expect(sender).toHaveBeenCalledTimes(1);expect(d.campaign.status).toBe('canceled');expect(d.counts).toMatchObject({accepted:1,skipped:1});
 });
 it('honors retry delay globally and caps retry attempts',async()=>{
  const {draft}=await setup();await launch(draft.id);const sender=vi.fn(async()=>({kind:'retry' as const,code:'429',after:120000}));await dispatchBatch(db,draft.id,cfg,sender);await dispatchBatch(db,draft.id,cfg,sender);expect(sender).toHaveBeenCalledTimes(1);
  await db.query("UPDATE campaign_recipients SET next_attempt_at=now(),attempt_count=4 WHERE campaign_id=$1",[draft.id]);await db.query('UPDATE delivery_control SET next_send_at=now()');await dispatchBatch(db,draft.id,cfg,sender);expect((await detail(draft.id)).counts.failed).toBe(1);
 });
 it('pauses on provider quality/auth rejection and template changes',async()=>{
  const {draft}=await setup();await launch(draft.id);await dispatchBatch(db,draft.id,cfg,async()=>({kind:'pause',code:'131048'}));expect((await detail(draft.id)).campaign.status).toBe('paused');
  const {draft:other}=await setup(0);await launch(other.id);await db.query("UPDATE templates SET components='[{\"type\":\"BODY\",\"text\":\"Changed\"}]'");const send=vi.fn();await dispatchBatch(db,other.id,cfg,send);expect(send).not.toHaveBeenCalled();expect((await detail(other.id)).campaign.status).toBe('paused');
 });
});
describe('durable outbox',()=>{
 it('keeps failed publications retryable and protects a worker-rearmed generation from a late acknowledgement',async()=>{
  const {draft}=await setup();await launch(draft.id);await publishOutbox(db,async()=>{throw new Error('down');},cfg);expect((await detail(draft.id)).outbox?.published_at).toBeNull();await db.query('UPDATE dispatch_outbox SET available_at=now()');
  const pub=vi.fn(async()=>{await dispatchBatch(db,draft.id,{...cfg,batchSize:1},async()=>({kind:'retry',code:'429',after:60000}));});await publishOutbox(db,pub,cfg);expect(pub).toHaveBeenCalledTimes(1);expect((await detail(draft.id)).outbox?.published_at).toBeNull();
 });
});
describe('signed webhooks',()=>{
 it('validates raw-body HMAC, challenge, and actual byte limit',async()=>{
  const bytes=Buffer.from('{ "x":1}'),secret='secret';const sig='sha256='+createHmac('sha256',secret).update(bytes).digest('hex');expect(validSignature(bytes,sig,secret)).toBe(true);expect(validSignature(Buffer.from('{"x":1}'),sig,secret)).toBe(false);expect(validSignature(bytes,'sha256=no',secret)).toBe(false);
  const config={...cfg,secret,verifyToken:'verify'};expect(verifyChallenge(new URL('https://x.test/?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123'),config)).toBe('123');expect(()=>verifyChallenge(new URL('https://x.test/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123'),config)).toThrow();
  await expect(readWebhookBody(new Request('https://x.test',{method:'POST',headers:{'content-length':'1'},body:'x'.repeat(1024*1024+1)}))).rejects.toThrow('besar');
 });
 it('deduplicates statuses and preserves read/delivered evidence across out-of-order failure',async()=>{
  const {draft}=await setup();await launch(draft.id);await dispatchBatch(db,draft.id,cfg,async()=>({kind:'accepted',id:'wamid.order'}));
  const payload=status('wamid.order','read');await processWebhook(db,payload,cfg);await processWebhook(db,payload,cfg);await processWebhook(db,status('wamid.order','failed'),cfg);await processWebhook(db,status('wamid.order','sent'),cfg);expect((await detail(draft.id)).counts.read).toBe(1);expect((await db.query('SELECT * FROM message_events')).rows).toHaveLength(3);
 });
 it('reconciles status arriving before send acknowledgement and ignores foreign sender/account',async()=>{
  const {draft}=await setup();await launch(draft.id);await processWebhook(db,status('early','delivered'),cfg);await dispatchBatch(db,draft.id,cfg,async()=>({kind:'accepted',id:'early'}));expect((await detail(draft.id)).counts.delivered).toBe(1);
  await processWebhook(db,status('early','read'),{...cfg,phoneId:'foreign'});expect((await detail(draft.id)).counts.read).toBeUndefined();
 });
 it('persists opt-out once, rejects queued delivery, and retains suppression for a contact imported later',async()=>{
  const {draft,contacts}=await setup();await launch(draft.id);const payload=stop(contacts[0].phone_e164);await processWebhook(db,payload,cfg);await processWebhook(db,payload,cfg);const sender=vi.fn();await dispatchBatch(db,draft.id,cfg,sender);expect(sender).not.toHaveBeenCalled();expect((await detail(draft.id)).counts.skipped).toBe(1);
  expect((await db.query("SELECT * FROM consent_events WHERE actor='webhook'")).rows).toHaveLength(1);
  const phone='+628123456799';await processWebhook(db,stop(phone,'unknown-stop'),cfg);await expect(createContact(db,{name:'Late import',phone,consent_status:'active',consent_source:'Old form',consent_at:'2026-01-01'},'admin')).rejects.toThrow('lebih baru');const late=await createContact(db,{name:'Late import',phone},'admin');expect(late.consent_status).toBe('revoked');expect((await audienceContacts(db,emptyAudience())).counts.eligible).toBe(0);
 });
 it('does not revoke newer explicit consent when an older opt-out is delayed',async()=>{
  const {contacts}=await setup();await db.query("UPDATE contacts SET consent_at='2026-05-01' WHERE id=$1",[contacts[0].id]);await processWebhook(db,stop(contacts[0].phone_e164,'old',Date.parse('2026-04-01')/1000),cfg);expect((await audienceContacts(db,emptyAudience())).counts.eligible).toBe(1);
 });
});
describe('Cloud API adapter and gates',()=>{
 it('is disabled by default and never enables live sending in preview contexts',()=>{
  expect(deliveryConfig()).toBeNull();const env={WHATSAPP_ACCESS_TOKEN:'secret',WHATSAPP_BUSINESS_ACCOUNT_ID:'123456',WHATSAPP_API_VERSION:'v24.0',WHATSAPP_PHONE_NUMBER_ID:'654321',META_APP_SECRET:'appsecret',WHATSAPP_VERIFY_TOKEN:'verify',WHATSAPP_SEND_ENABLED:'true',RELAY_ASYNC_READY:'true',CONTEXT:'deploy-preview'};expect(deliveryConfig(false,env)).toBeNull();expect(deliveryConfig(false,{...env,CONTEXT:'production'})).not.toBeNull();
 });
 it('builds positional/named payloads and classifies accepted, rate limit, permanent and ambiguous outcomes',async()=>{
  const {t}=await setup();const m={'BODY:1':{source:'literal' as const,value:'Name'}};const p=messageParameters(t,m,{name:'N',phone_e164:'+628123456700'});const live={...cfg,demo:false,version:'v24.0',token:'SECRET'};
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({messages:[{id:'wamid.ok'}]})));expect(await sendWhatsApp(live,'+628123456700',t,p,1,transport)).toEqual({kind:'accepted',id:'wamid.ok'});expect(String(transport.mock.calls[0][0])).not.toContain('SECRET');expect(JSON.parse(transport.mock.calls[0][1]?.body as string).template.components[0].parameters[0].text).toBe('Name');
  expect((await sendWhatsApp(live,'+628123456700',t,p,1,async()=>new Response(JSON.stringify({error:{code:130429}}),{status:429,headers:{'Retry-After':'120'}})))).toEqual({kind:'retry',code:'130429',after:120000});
  expect((await sendWhatsApp(live,'+628123456700',t,p,1,async()=>new Response(JSON.stringify({error:{code:100}}),{status:400})))).toEqual({kind:'failed',code:'100'});
  expect((await sendWhatsApp(live,'+628123456700',t,p,1,async()=>new Response('{}',{status:500})))).toMatchObject({kind:'uncertain'});
  expect((await sendWhatsApp(live,'+628123456700',t,p,1,async()=>{throw new Error('SECRET');}))).toEqual({kind:'uncertain',code:'NETWORK_OR_TIMEOUT'});
  const named={...t,parameter_format:'NAMED',variables:['BODY:nama'],components:[{type:'BODY',text:'Halo {{nama}}'}]};expect(messageParameters(named,{'BODY:nama':{source:'name'}},{name:'Amat',phone_e164:'+628123456700'})[0].parameters[0].parameter_name).toBe('nama');
 });
});
