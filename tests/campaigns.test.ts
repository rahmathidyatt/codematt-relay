import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import type {Database} from '../netlify/lib/db';
import {syncTemplates,fetchTemplates,templateList,metaConfig} from '../netlify/lib/templates';
import {audienceContacts,saveDraft,getCampaign,previewDraft} from '../netlify/lib/campaigns';
import {createContact,changeConsent,bulkContacts} from '../netlify/lib/contacts';
import {emptyAudience,templateShape,renderMessage,validateAudience,type Template} from '../src/features/campaigns/model';
let pg:PGlite,db:Database;
const waba='123456789';
const provider={provider_id:'official-1',name:'welcome',language:'id',category:'UTILITY',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'HEADER',format:'TEXT',text:'Untuk {{1}}'},{type:'BODY',text:'Halo {{1}}, info {{2}}.'}]};
beforeAll(async()=>{pg=new PGlite();for(const file of readdirSync('netlify/database/migrations').filter(f=>f.endsWith('.sql')).sort())await pg.exec(readFileSync('netlify/database/migrations/'+file,'utf8'));db=pg as unknown as Database;},30000);
afterAll(async()=>{await pg.close();});
const config={waba,token:'TOP-SECRET',version:'v24.0'};
describe('official template sync boundaries',()=>{
 it('requires explicit server config and keeps bearer token out of URLs',async()=>{
  expect(metaConfig({})).toBeNull();expect(metaConfig({WHATSAPP_ACCESS_TOKEN:'t',WHATSAPP_BUSINESS_ACCOUNT_ID:'../../bad',WHATSAPP_API_VERSION:'v24.0'})).toBeNull();
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data:[{...provider,id:'provider-1'}]})));
  expect(await fetchTemplates(config,transport)).toHaveLength(1);
  const [url,options]=transport.mock.calls[0];expect(String(url)).toContain('/v24.0/123456789/message_templates');expect(String(url)).not.toContain('TOP-SECRET');expect(options?.headers).toEqual({Authorization:'Bearer TOP-SECRET'});expect(options?.redirect).toBe('error');
 });
 it('rebuilds cursor URLs on the trusted host and rejects incomplete pagination',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({data:[],paging:{next:'https://evil.test/?access_token=secret',cursors:{after:'cursor1'}}}))).mockResolvedValueOnce(new Response(JSON.stringify({data:[]})));
  await fetchTemplates(config,transport);expect(String(transport.mock.calls[1][0])).toContain('https://graph.facebook.com/');expect(String(transport.mock.calls[1][0])).toContain('after=cursor1');
  const repeat=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({data:[],paging:{next:'x',cursors:{after:'repeat'}}})));
  await expect(fetchTemplates(config,repeat)).rejects.toThrow('tidak selesai');expect(repeat).toHaveBeenCalledTimes(2);
 });
 it('bounds actual provider bytes and sanitizes error bodies',async()=>{
  await expect(fetchTemplates(config,async()=>new Response('secret-token',{status:401}))).rejects.toThrow('Periksa token');
  await expect(fetchTemplates(config,async()=>new Response('x'.repeat(2*1024*1024+1)))).rejects.toThrow('tidak selesai');
  await expect(fetchTemplates(config,async()=>{throw new Error('TOP-SECRET');})).rejects.not.toThrow('TOP-SECRET');
 });
 it('atomically syncs, preserves data on fetch failure, and marks missing templates unavailable',async()=>{
  await syncTemplates(db,'admin',waba,async()=>[provider]);let list=await templateList(db,waba);expect(list[0].usable).toBe(true);expect(list[0].variables).toEqual(['HEADER:1','BODY:1','BODY:2']);
  await expect(syncTemplates(db,'admin',waba,async()=>{throw new Error('fetch failed');})).rejects.toThrow();expect((await templateList(db,waba))[0].status).toBe('APPROVED');
  await syncTemplates(db,'admin',waba,async()=>[]);expect((await templateList(db,waba))[0].status).toBe('UNAVAILABLE');
  await syncTemplates(db,'admin',waba,async()=>[provider]);list=await templateList(db,'other-account');expect(list[0].usable).toBe(false);
  await db.query("UPDATE templates SET synced_at=now()-interval '25 hours'");expect((await templateList(db,waba))[0].reason).toContain('24 jam');await syncTemplates(db,'admin',waba,async()=>[provider]);
 });
 it('supports named text variables and refuses unsupported media/dynamic buttons',()=>{
  expect(templateShape({...provider,parameter_format:'NAMED',components:[{type:'BODY',text:'Halo {{nama}}'}]})).toEqual({variables:['BODY:nama'],reason:''});
  expect(templateShape({...provider,components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Halo'}]}).reason).toContain('media');
  expect(templateShape({...provider,components:[{type:'BODY',text:'Hi'},{type:'BUTTONS',buttons:[{type:'URL',text:'Open',url:'https://x.test/{{1}}'}]}]}).reason).toContain('dinamis');
  expect(templateShape({...provider,components:[{type:'BODY',text:'Hi {{2}}'}]}).reason).toContain('Urutan');
  const t={...provider,components:[{type:'BODY',text:'Hi {{nama}}'}]} as unknown as Template;
  expect(renderMessage(t,{'BODY:nama':{source:'literal',value:'$& <img onerror=x>'}},{name:'N',phone_e164:'+6281'})[0].text).toBe('Hi $& <img onerror=x>');
 });
});
describe('audience and draft lifecycle',()=>{
 it('counts exclusive skip reasons, manual IDs, tag any/all, and literal search',async()=>{
  const active={name:'Audience %',phone:'081231234560',tags:['audience','jakarta'],consent_status:'active',consent_source:'Signed form',consent_at:'2026-01-01'};
  const a=await createContact(db,active,'admin');
  await createContact(db,{...active,phone:'081231234561',consent_status:'unknown',tags:['audience']},'admin');
  await createContact(db,{...active,phone:'081231234562',consent_status:'revoked',tags:['audience']},'admin');
  const archived=await createContact(db,{...active,phone:'081231234563'},'admin');await bulkContacts(db,{action:'archive',contacts:[{id:archived.id,version:archived.version}]},'admin');
  const all=await audienceContacts(db,emptyAudience());expect(all.counts).toMatchObject({selected:4,eligible:1,no_consent:1,opted_out:1,archived:1});
  const both=await audienceContacts(db,{...emptyAudience(),mode:'segment',tags:['audience','jakarta'],match:'all'});expect(both.counts.selected).toBe(2);
  const literal=await audienceContacts(db,{...emptyAudience(),mode:'segment',q:'%'});expect(literal.counts.selected).toBe(4);
  const manual=await audienceContacts(db,{...emptyAudience(),mode:'manual',ids:[a.id,randomUUID()]});expect(manual.counts).toMatchObject({selected:2,eligible:1,missing:1});
  expect(()=>validateAudience({...emptyAudience(),ids:['invalid']})).toThrow();
 });
 it('persists partial drafts, guards versions, and never enqueues recipients',async()=>{
  const id=randomUUID();const initial={id,name:'Partial draft',template_id:null,audience_rules:emptyAudience(),variable_mapping:{}};
  const saved=await saveDraft(db,initial,'admin',waba);expect(saved.version).toBe(1);expect(saved.status).toBe('draft');expect((await getCampaign(db,id)).name).toBe('Partial draft');
  const updated=await saveDraft(db,{...initial,version:1,name:'Edited'},'operator',waba);expect(updated.version).toBe(2);
  await expect(saveDraft(db,{...initial,version:1},'admin',waba)).rejects.toThrow('Draft berubah');
  await expect(saveDraft(db,{...initial,status:'queued'},'admin',waba)).rejects.toThrow('Hanya draft');
  const counts=await db.query<{recipients:number;outbox:number}>('SELECT (SELECT count(*)::int FROM campaign_recipients) AS recipients,(SELECT count(*)::int FROM dispatch_outbox) AS outbox');expect(counts.rows[0]).toEqual({recipients:0,outbox:0});
 });
 it('resolves personalized preview, flags missing mappings, and rechecks opt-out',async()=>{
  const t=(await templateList(db,waba))[0];const raw={id:randomUUID(),name:'Preview campaign',template_id:t.id,audience_rules:emptyAudience(),variable_mapping:{'HEADER:1':{source:'name'},'BODY:1':{source:'name'},'BODY:2':{source:'literal',value:'Oktober'}}};
  const p=await previewDraft(db,raw,waba);expect(p.issues).toEqual([]);expect(p.samples[0].parts[1].text).toBe('Halo Audience %, info Oktober.');
  expect((await previewDraft(db,{...raw,variable_mapping:{}},waba)).issues).toHaveLength(3);
  const saved=await saveDraft(db,raw,'operator',waba);expect(saved.audience_snapshot?.ids).toHaveLength(1);
  const c=(await db.query<{id:string;version:number}>("SELECT id,version FROM contacts WHERE phone_e164='+6281231234560'")).rows[0];
  await changeConsent(db,c.id,{version:c.version,status:'revoked',source:'STOP',confirmed:true},'operator');
  const after=await previewDraft(db,raw,waba);expect(after.counts.eligible).toBe(0);expect(after.samples).toHaveLength(0);expect(after.issues).toContain('Belum ada kontak yang layak menerima pesan.');
  expect((await getCampaign(db,saved.id)).audience_snapshot?.ids).toHaveLength(1); // Saved snapshot is historical, never dispatch authority.
 });
 it('revalidates provider status and current component variables',async()=>{
  const t=(await templateList(db,waba))[0];await syncTemplates(db,'admin',waba,async()=>[{...provider,status:'PAUSED'}]);
  const p=await previewDraft(db,{template_id:t.id,audience_rules:emptyAudience(),variable_mapping:{}},waba);expect(p.issues[0]).toContain('PAUSED');
  await syncTemplates(db,'admin',waba,async()=>[{...provider,components:[{type:'BODY',text:'Halo {{1}}'}]}]);
  const changed=await previewDraft(db,{template_id:t.id,audience_rules:emptyAudience(),variable_mapping:{'HEADER:1':{source:'name'}}},waba);expect(changed.issues).toContain('Pemetaan HEADER:1 sudah tidak ada pada template.');
 });
});
