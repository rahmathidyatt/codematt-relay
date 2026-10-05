import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from 'libphonenumber-js/max';
import type { ContactDraft, ConsentStatus, Contact } from './types.ts';
export class InputError extends Error { constructor(message:string, public code='VALIDATION_ERROR', public status=400) { super(message); } }
export function object(value:unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Format data tidak valid.');
  return value as Record<string,unknown>;
}
export function text(value:unknown, label:string, max=200):string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length>max || [...value].some(c => (c.charCodeAt(0)<32 && ![9,10,13].includes(c.charCodeAt(0))) || c.charCodeAt(0)===127)) throw new InputError(`${label} wajib diisi dan maksimal ${max} karakter.`);
  return value.trim();
}
export function normalizePhone(input:unknown, country:unknown='ID'):string {
  let value=text(input,'Nomor telepon',40);
  if (typeof country!=='string' || !isSupportedCountry(country)) throw new InputError('Kode negara tidak didukung.');
  if (!/^\+?[\d\s().-]+$/.test(value)) throw new InputError('Format nomor telepon tidak valid.');
  value=value.replace(/[\s().-]/g,'');
  if (value.startsWith('00')) value='+'+value.slice(2);
  if (country==='ID' && value.startsWith('62')) value='+'+value;
  const phone=parsePhoneNumberFromString(value,{defaultCountry:country as CountryCode,extract:false});
  if (!phone?.isValid() || phone.ext) throw new InputError('Nomor telepon tidak valid. Gunakan kode negara yang sesuai.');
  return phone.number;
}
export function tags(value:unknown):string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length>20) throw new InputError('Maksimal 20 tag per kontak.');
  return [...new Set(value.map(v=>text(v,'Tag',50).normalize('NFKC').toLocaleLowerCase('id-ID')))];
}
export function consentDate(value:unknown, now=new Date()):string {
  const raw=text(value,'Tanggal persetujuan',40);
  // Date-only imports explicitly mean midnight Asia/Jakarta, not the operator's device timezone.
  const formatted=/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw+'T00:00:00+07:00' : raw;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(formatted)) throw new InputError('Gunakan tanggal YYYY-MM-DD atau ISO dengan zona waktu.');
  const day=raw.slice(0,10), [y,m,d]=day.split('-').map(Number);
  if(new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)!==day) throw new InputError('Tanggal tidak valid.');
  const date=new Date(formatted);
  if (!Number.isFinite(date.getTime()) || date>now) throw new InputError('Tanggal persetujuan tidak boleh di masa depan.');
  return date.toISOString();
}
export function validateDraft(value:unknown, now=new Date()) {
  const body=object(value);
  const status=(body.consent_status??'unknown') as ConsentStatus;
  if (!['active','unknown','revoked'].includes(status)) throw new InputError('Status persetujuan tidak dikenali.');
  const source=status==='unknown' ? null : text(body.consent_source,'Sumber persetujuan / opt-out',300);
  const at=status==='unknown' ? null : status==='revoked' && !body.consent_at ? now.toISOString() : consentDate(body.consent_at,now);
  return {name:text(body.name,'Nama'),phone_e164:normalizePhone(body.phone,body.country??'ID'),tags:tags(body.tags),consent_status:status,consent_source:source,consent_at:at};
}
export function uuid(value:unknown):string {
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new InputError('ID tidak valid.');
  return value;
}
export function version(value:unknown):number {
  if(!Number.isSafeInteger(value)||Number(value)<1) throw new InputError('Versi kontak tidak valid. Muat ulang data.');
  return Number(value);
}
export function eligible(contact: Pick<Contact,'consent_status'|'consent_at'|'consent_source'|'opted_out_at'|'archived_at'>):boolean {
  return !contact.archived_at && contact.consent_status==='active' && Boolean(contact.consent_source?.trim()) && Boolean(contact.consent_at) && (!contact.opted_out_at || Date.parse(contact.consent_at!)>Date.parse(contact.opted_out_at));
}
export function draft(value:ContactDraft) { return validateDraft(value); }
