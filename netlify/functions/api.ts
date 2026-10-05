import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { can } from '../../src/lib/permissions';
import { success, failure } from '../lib/http';

export default async function handler(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/\.netlify\/functions\/api/, '/api');
  if (!['/api/session', '/api/dashboard', '/api/settings'].includes(path)) {
    return failure(404, 'NOT_FOUND', 'Endpoint tidak ditemukan.');
  }
  if (request.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED', 'Metode tidak didukung.');
  try {
    const user = await getUser();
    if (!user) return failure(401, 'UNAUTHENTICATED', 'Silakan masuk terlebih dahulu.');
    if (!can(user.roles ?? [], path === '/api/settings' ? 'settings:read' : 'reports:read')) {
      return failure(403, 'FORBIDDEN', 'Akun Anda belum memiliki akses untuk halaman ini.');
    }
    if (path === '/api/session') return success({ id: user.id, email: user.email, roles: user.roles ?? [] });
    const { pool } = getDatabase();
    if (path === '/api/settings') {
      const result = await pool.query('SELECT workspace_name, timezone, opt_out_keywords FROM app_settings WHERE id = true');
      return success({ ...result.rows[0], sendingAvailable: false, integration: 'not_configured' });
    }
    const result = await pool.query(`SELECT
      (SELECT count(*)::int FROM contacts WHERE archived_at IS NULL) AS contacts,
      (SELECT count(*)::int FROM campaigns) AS campaigns,
      (SELECT count(*)::int FROM templates) AS templates`);
    return success(result.rows[0]);
  } catch {
    return failure(503, 'SERVICE_UNAVAILABLE', 'Layanan belum siap. Periksa konfigurasi Identity dan Database di Netlify.');
  }
}
