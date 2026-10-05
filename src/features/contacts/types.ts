export type ConsentStatus = 'unknown' | 'active' | 'revoked';
export type Contact = {
  id: string; name: string; phone_e164: string; tags: string[];
  consent_status: ConsentStatus; consent_source: string | null; consent_at: string | null;
  opted_out_at: string | null; opt_out_source: string | null; archived_at: string | null;
  created_at: string; updated_at: string; version: number;
};
export type ContactDraft = {name: string; phone: string; country?: string; tags?: string[]; consent_status?: string; consent_source?: string; consent_at?: string};
export type ContactList = {items: Contact[]; total: number; page: number; pageSize: number};
export type ConsentEvent = {id:string; status:ConsentStatus; source:string; occurred_at:string; actor:string};
export type RowResult = {row:number; status:'imported'|'duplicate'|'invalid'; reason?:string};
export type ImportJob = {id:string; status:string; row_count:number; imported_count:number; error_count:number; duplicate_count:number; processed_count:number};
export type ImportRow = {row:number; data:ContactDraft};
export const LIMITS = {fileBytes:5*1024*1024, rows:10000, columns:40, batch:100, bodyBytes:256*1024, cellLength:2000};
