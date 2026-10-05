import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { can } from '../../src/lib/permissions.ts';
import { success, failure } from '../lib/http.ts';
import { fromPool } from '../lib/db.ts';
import { contactRoute, handleContacts, rateLimit, sameOrigin } from '../lib/contact-api.ts';
import { InputError } from '../../src/features/contacts/validation.ts';
export default async function handler(request: Request): Promise<Response> {
  const url=new URL(request.url);url.pathname=url.pathname.replace(/^\/\.netlify\/functions\/api/,'/api');
  const path=url.pathname;const isContacts=contactRoute(path);
  if(!isContacts&&!['/api/session','/api/dashboard','/api/settings'].includes(path))return failure(404,'NOT_FOUND','Endpoint tidak ditemukan.');
  if(!isContacts&&request.method!=='GET')return failure(405,'METHOD_NOT_ALLOWED','Metode tidak didukung.');
  try {
    const user=await getUser();if(!user)return failure(401,'UNAUTHENTICATED','Silakan masuk terlebih dahulu.');
    const permission=isContacts?'contacts:write':path==='/api/settings'?'settings:read':'reports:read';
    if(!can(user.roles??[],permission))return failure(403,'FORBIDDEN','Akun Anda belum memiliki akses untuk halaman ini.');
    if(request.method!=='GET')sameOrigin(request);
    if(path==='/api/session')return success({id:user.id,email:user.email,roles:user.roles??[]});
    const {pool}=getDatabase();
    if(isContacts) {
      const db=fromPool(pool);await rateLimit(db,user.id);
      return await handleContacts(new Request(url,request),db,user.id);
    }
    if(path==='/api/settings') {
      const result=await pool.query('SELECT workspace_name,timezone,opt_out_keywords FROM app_settings WHERE id=true');
      return success({...result.rows[0],sendingAvailable:false,integration:'not_configured'});
    }
    const result=await pool.query(`SELECT (SELECT count(*)::int FROM contacts WHERE archived_at IS NULL) AS contacts,(SELECT count(*)::int FROM campaigns) AS campaigns,(SELECT count(*)::int FROM templates) AS templates`);
    return success(result.rows[0]);
  } catch(e) {
    if(e instanceof InputError)return failure(e.status,e.code,e.message);
    if(e&&typeof e==='object'&&'code' in e&&e.code==='23505')return failure(409,'DUPLICATE_PHONE','Nomor sudah tersimpan. Cari nomor tersebut; data lama tidak diubah.');
    return failure(503,'SERVICE_UNAVAILABLE','Layanan belum siap. Periksa konfigurasi Identity, Database, dan migrasi di Netlify.');
  }
}
