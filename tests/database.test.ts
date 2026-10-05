import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
let db: PGlite;
beforeAll(async () => { db = new PGlite(); await db.exec(readFileSync('netlify/database/migrations/0001_foundation.sql','utf8')); }, 30000);
afterAll(async () => { await db.close(); });
describe('Postgres migration constraints', () => {
  it('applies and creates the default Jakarta workspace', async () => {
    const {rows} = await db.query('SELECT timezone FROM app_settings');
    expect(rows).toEqual([{timezone:'Asia/Jakarta'}]);
  });
  it('rejects active consent without evidence', async () => {
    await expect(db.query("INSERT INTO contacts(name,phone_e164,consent_status) VALUES('No evidence','+628123456789','active')")).rejects.toThrow();
  });
  it('rejects malformed phone and duplicate normalized numbers', async () => {
    await expect(db.query("INSERT INTO contacts(name,phone_e164) VALUES('Bad','08123')")).rejects.toThrow();
    await db.query("INSERT INTO contacts(name,phone_e164) VALUES('A','+628111111111')");
    await expect(db.query("INSERT INTO contacts(name,phone_e164) VALUES('B','+628111111111')")).rejects.toThrow();
  });
  it('requires new consent after opt-out', async () => {
    await expect(db.query("INSERT INTO contacts(name,phone_e164,consent_status,consent_source,consent_at,opted_out_at) VALUES('A','+628222222222','active','form','2026-10-01','2026-10-02')")).rejects.toThrow();
  });
  it('prevents duplicate campaign-recipient rows and provider IDs', async () => {
    const c = await db.query<{id:string}>("INSERT INTO campaigns(name,created_by) VALUES('Test','admin') RETURNING id");
    const p = await db.query<{id:string}>("SELECT id FROM contacts WHERE phone_e164='+628111111111'");
    await db.query('INSERT INTO campaign_recipients(campaign_id,contact_id,provider_message_id) VALUES($1,$2,$3)',[c.rows[0].id,p.rows[0].id,'provider-1']);
    await expect(db.query('INSERT INTO campaign_recipients(campaign_id,contact_id) VALUES($1,$2)',[c.rows[0].id,p.rows[0].id])).rejects.toThrow();
    const other = await db.query<{id:string}>("INSERT INTO campaigns(name,created_by) VALUES('Other','admin') RETURNING id");
    await expect(db.query('INSERT INTO campaign_recipients(campaign_id,contact_id,provider_message_id) VALUES($1,$2,$3)',[other.rows[0].id,p.rows[0].id,'provider-1'])).rejects.toThrow();
  });
});
