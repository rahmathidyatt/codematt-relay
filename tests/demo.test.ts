import {createServer,type ViteDevServer} from 'vite';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {demoPlugin} from '../dev/demo-plugin';
let server:ViteDevServer,base:string;
beforeAll(async()=>{
  process.env.RELAY_DEMO_DIR=await mkdtemp(join(tmpdir(),'relay-demo-test-'));
  server=await createServer({configFile:false,plugins:[demoPlugin()],server:{host:'127.0.0.1',port:0}});await server.listen();
  const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('No test server');base=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{await server?.close();delete process.env.RELAY_DEMO_DIR;});
it('serves the real local API, persists edits, and rejects foreign-origin writes',async()=>{
  const response=await fetch(base+'/__demo/api/contacts',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Local Demo',phone:'081234567890'})});
  expect(response.status).toBe(200);const result=await response.json();expect(result.data.phone_e164).toBe('+6281234567890');
  const list=await(await fetch(base+'/__demo/api/contacts')).json();expect(list.data.total).toBe(1);
  const summary=await(await fetch(base+'/__demo/api/dashboard')).json();expect(summary.data.contacts).toBe(1);
  const rejected=await fetch(base+'/__demo/api/reset',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{"confirmed":true}'});expect(rejected.status).toBe(403);
},30000);

it('exercises template samples and persistent draft APIs without any provider call',async()=>{
 const headers={Origin:base,'Content-Type':'application/json'};
 const sync=await fetch(base+'/__demo/api/templates/sync',{method:'POST',headers});expect(sync.status).toBe(200);
 const templates=await(await fetch(base+'/__demo/api/templates')).json();expect(templates.data.demo).toBe(true);expect(templates.data.items).toHaveLength(4);
 const id=crypto.randomUUID();const input={id,name:'HTTP draft',template_id:null,audience_rules:{mode:'all',tags:[],ids:[],match:'any',q:''},variable_mapping:{}};
 const created=await fetch(base+'/__demo/api/campaigns',{method:'POST',headers,body:JSON.stringify(input)});expect(created.status).toBe(200);
 const reopened=await(await fetch(base+'/__demo/api/campaigns/'+id)).json();expect(reopened.data.name).toBe('HTTP draft');
 const summary=await(await fetch(base+'/__demo/api/dashboard')).json();expect(summary.data.campaigns).toBe(1);expect(summary.data.templates).toBe(4);
 const send=await fetch(base+'/__demo/api/campaigns/send',{method:'POST',headers});expect(send.status).toBe(404);
},30000);
it('exercises launch, queued simulation, callback statuses and monitor over HTTP',async()=>{
 const headers={Origin:base,'Content-Type':'application/json'};
 async function post(path:string,body:object){const r=await fetch(base+'/__demo/api/'+path,{method:'POST',headers,body:JSON.stringify(body)});const result=await r.json();expect(r.status,result.error?.message).toBe(200);return result.data;}
 await post('templates/sync',{});const templates=await(await fetch(base+'/__demo/api/templates')).json();const template=templates.data.items.find((t:{name:string})=>t.name==='contoh_update');
 const contact=await post('contacts',{name:'Delivery HTTP',phone:'081234567877',consent_status:'active',consent_source:'Fixture form',consent_at:'2026-01-01'});
 const campaign=await post('campaigns',{id:crypto.randomUUID(),name:'HTTP launch',template_id:template.id,audience_rules:{mode:'manual',ids:[contact.id],tags:[],q:'',match:'any'},variable_mapping:{'BODY:nama':{source:'name'},'BODY:informasi':{source:'literal',value:'Latihan'}}});
 const review=(await(await fetch(base+`/__demo/api/campaigns/${campaign.id}/review`)).json()).data;await post(`campaigns/${campaign.id}/launch`,{version:review.version,review_hash:review.hash,confirmed:true,timezone:'Asia/Jakarta'});await post('demo/tick',{campaign_id:campaign.id});
 let detail=(await(await fetch(base+`/__demo/api/campaigns/${campaign.id}/delivery`)).json()).data;expect(detail.counts.accepted).toBe(1);await post('demo/event',{campaign_id:campaign.id,recipient_id:detail.items[0].id,status:'delivered'});
 detail=(await(await fetch(base+`/__demo/api/campaigns/${campaign.id}/delivery`)).json()).data;expect(detail.counts.delivered).toBe(1);
},30000);
