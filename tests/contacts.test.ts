import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {Database} from '../netlify/lib/db';
import {createContact,updateContact,changeConsent,bulkContacts,getContact,listContacts,exportContacts,history} from '../netlify/lib/contacts';
import {createImport,importChunk,getImport} from '../netlify/lib/imports';
import {jsonBody,sameOrigin,rateLimit} from '../netlify/lib/contact-api';
import {eligible,normalizePhone,validateDraft,consentDate} from '../src/features/contacts/validation';
let pg:PGlite,db:Database;
beforeAll(async()=>{pg=new PGlite();db=pg as unknown as Database;await pg.exec(readFileSync('netlify/database/migrations/0001_foundation.sql','utf8'));await pg.exec(readFileSync('netlify/database/migrations/0002_contacts_imports.sql','utf8'));},30000);
afterAll(()=>pg.close());
const sample=(phone:string)=>({name:'Kontak Uji',phone,tags:['Training','training'],consent_status:'unknown'});
describe('contact validation',()=>{
  it('normalizes Indonesian local/international numbers and rejects text and impossible numbers',()=>{
    for(const phone of ['0812 3456 7890','6281234567890','+62 812-3456-7890','006281234567890'])expect(normalizePhone(phone)).toBe('+6281234567890');
    expect(normalizePhone('(213) 373-4253','US')).toBe('+12133734253');
    for(const phone of ['call 081234567890','123','+00012345','8.12E+11'])expect(()=>normalizePhone(phone)).toThrow();
  });
  it('requires source and timestamp for active consent',()=>{
    expect(()=>validateDraft({...sample('081234567890'),consent_status:'active'})).toThrow();
    expect(()=>validateDraft({...sample('081234567890'),consent_status:'active',consent_source:'',consent_at:'2026-01-01'})).toThrow();
  });
  it('rejects impossible or future timestamps and interprets date-only in Jakarta',()=>{
    expect(()=>consentDate('2026-02-30')).toThrow();expect(()=>consentDate('2999-01-01')).toThrow();expect(()=>consentDate('2026-01-01T10:00:00')).toThrow();
    expect(consentDate('2026-01-01')).toBe('2025-12-31T17:00:00.000Z');
  });
});
describe('transactional contacts and consent',()=>{
  it('creates normalized contacts with deduplicated tags and rejects a duplicate phone',async()=>{
    const c=await createContact(db,sample('081234567890'),'admin');expect(c.phone_e164).toBe('+6281234567890');expect(c.tags).toEqual(['training']);expect(eligible(c)).toBe(false);
    await expect(createContact(db,sample('+6281234567890'),'admin')).rejects.toThrow();
  });
  it('updates fields with optimistic locking and prevents phone or consent edits through generic update',async()=>{
    const c=await createContact(db,sample('081234567891'),'admin');const updated=await updateContact(db,c.id,{name:'Updated',tags:['leader'],version:c.version},'admin');
    expect(updated.version).toBe(c.version+1);expect(updated.tags).toEqual(['leader']);
    await expect(updateContact(db,c.id,{name:'Overwrite',tags:[],version:c.version},'admin')).rejects.toThrow('berubah');
    await expect(updateContact(db,c.id,{name:'Bad',tags:[],version:updated.version,consent_status:'active'},'admin')).rejects.toThrow('khusus');
  });
  it('preserves opt-out through generic edit, archive, restore and duplicate import',async()=>{
    let c=await createContact(db,sample('081234567892'),'operator');
    c=await changeConsent(db,c.id,{version:c.version,status:'revoked',source:'Permintaan kontak',confirmed:true},'operator');
    c=await updateContact(db,c.id,{version:c.version,name:'Renamed',tags:['leader']},'operator');
    await bulkContacts(db,{contacts:[{id:c.id,version:c.version}],action:'archive'},'operator');c=await getContact(db,c.id);expect(eligible(c)).toBe(false);
    await bulkContacts(db,{contacts:[{id:c.id,version:c.version}],action:'restore'},'operator');c=await getContact(db,c.id);expect(c.consent_status).toBe('revoked');
    const id=randomUUID();await createImport(db,{id,row_count:1},'operator');const result=await importChunk(db,id,{index:0,rows:[{row:2,data:{...sample(c.phone_e164),consent_status:'active',consent_source:'Imported old form',consent_at:'2026-01-01'}}]},'operator');
    expect(result.results[0].status).toBe('duplicate');expect((await getContact(db,c.id)).consent_status).toBe('revoked');
    await expect(changeConsent(db,c.id,{version:c.version,status:'active',source:'Old evidence',occurred_at:'2026-01-01',confirmed:true},'operator')).rejects.toThrow('lebih baru');
  });
  it('records new consent after a previous opt-out and excludes archived contacts from eligibility',async()=>{
    let c=await createContact(db,{...sample('081234567893'),consent_status:'revoked',consent_source:'Previous request',consent_at:'2025-01-01'},'admin');
    c=await changeConsent(db,c.id,{version:c.version,status:'active',source:'New signed form',occurred_at:'2026-01-01',confirmed:true},'admin');expect(eligible(c)).toBe(true);expect(c.opted_out_at).not.toBeNull();
    const events=await history(db,c.id,new URLSearchParams());expect(events.items.map(e=>e.status)).toEqual(['active','revoked']);
    await bulkContacts(db,{contacts:[{id:c.id,version:c.version}],action:'archive'},'admin');c=await getContact(db,c.id);expect(eligible(c)).toBe(false);
    await expect(changeConsent(db,c.id,{version:c.version,status:'active',source:'New',occurred_at:'2026-02-01',confirmed:true},'admin')).rejects.toThrow();
  });
  it('rolls back an entire bulk change when any selected contact is stale',async()=>{
    const a=await createContact(db,sample('081234567894'),'admin'),b=await createContact(db,sample('081234567895'),'admin');
    await expect(bulkContacts(db,{action:'archive',contacts:[{id:a.id,version:a.version},{id:b.id,version:b.version+1}]},'admin')).rejects.toThrow();expect((await getContact(db,a.id)).archived_at).toBeNull();
  });
  it('supports paginated literal search, tag and consent filters',async()=>{
    const c=await createContact(db,{...sample('081234567896'),name:'Literal % Contact',tags:['Unique']},'admin');
    const result=await listContacts(db,new URLSearchParams({q:'%',tag:'unique',pageSize:'1',sort:'name'}));expect(result.total).toBe(1);expect(result.items[0].id).toBe(c.id);
    await expect(listContacts(db,new URLSearchParams({sort:'name; DROP TABLE contacts'}))).rejects.toThrow();
    const exported=await exportContacts(db,new URLSearchParams({tag:'unique'}));expect(exported.items).toHaveLength(1);
  });
});
describe('import batches',()=>{
  it('idempotently commits results, counts and audit events; rejects changed payload on replay',async()=>{
    const id=randomUUID();await createImport(db,{id,row_count:3},'importer');
    const rows=[{row:2,data:sample('081234567897')},{row:3,data:sample('081234567897')},{row:4,data:sample('bad')}];
    const a=await importChunk(db,id,{index:0,rows},'importer'),b=await importChunk(db,id,{index:0,rows},'importer');
    expect(a.results).toEqual(b.results);expect(a.job.imported_count).toBe(1);expect(a.job.duplicate_count).toBe(1);expect(a.job.error_count).toBe(1);expect(a.job.processed_count).toBe(3);expect(a.job.status).toBe('completed');
    const count=await db.query<{total:number}>("SELECT count(*)::int AS total FROM audit_logs WHERE entity_id=$1 AND action='contacts.import_completed'",[id]);expect(count.rows[0].total).toBe(1);
    await expect(importChunk(db,id,{index:0,rows:rows.slice(0,2)},'importer')).rejects.toThrow('berbeda');
    await expect(getImport(db,id,'another-user')).rejects.toThrow('tidak ditemukan');
  });
  it('resumes a 101-row import after an acknowledged batch and safely replays a committed batch',async()=>{
    const id=randomUUID();await createImport(db,{id,row_count:101},'batch-user');
    const rows=Array.from({length:101},(_,i)=>({row:i+2,data:sample(String(6281231000000+i))}));
    const first=await importChunk(db,id,{index:0,rows:rows.slice(0,100)},'batch-user');expect(first.job.processed_count).toBe(100);expect(first.job.status).toBe('processing');
    const repeated=await importChunk(db,id,{index:0,rows:rows.slice(0,100)},'batch-user');expect(repeated.job.imported_count).toBe(100);
    const second=await importChunk(db,id,{index:1,rows:rows.slice(100)},'batch-user');expect(second.job.processed_count).toBe(101);expect(second.job.imported_count).toBe(101);expect(second.job.status).toBe('completed');
  });
  it('enforces chunk ordering and row counts',async()=>{
    const id=randomUUID();await createImport(db,{id,row_count:101},'importer');
    await expect(importChunk(db,id,{index:1,rows:[{row:2,data:sample('081234567898')}]},'importer')).rejects.toThrow('Urutan');
    await expect(importChunk(db,id,{index:0,rows:[{row:2,data:sample('081234567898')}]},'importer')).rejects.toThrow('Urutan');
  });
  it('requires same-origin JSON and bounds real body bytes even with a forged length',async()=>{
    expect(()=>sameOrigin(new Request('https://relay.example/api/contacts',{headers:{Origin:'https://evil.example'}}))).toThrow();
    expect(()=>sameOrigin(new Request('https://relay.example/api/contacts'))).toThrow();
    await expect(jsonBody(new Request('https://relay.example',{method:'POST',headers:{'content-type':'application/json','content-length':'1'},body:'x'.repeat(256*1024+1)}))).rejects.toThrow('besar');
  });
  it('enforces persistent per-actor rate limits',async()=>{
    const bucket=Math.floor(Date.now()/60000);await db.query('INSERT INTO api_rate_buckets(actor,bucket,count) VALUES($1,$2,180)',['limit-user',bucket]);await expect(rateLimit(db,'limit-user')).rejects.toThrow('Terlalu banyak');await rateLimit(db,'another-user');
  });
});
