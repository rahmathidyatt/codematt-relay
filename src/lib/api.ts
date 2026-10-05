export async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Gunakan netlify dev untuk login dan database. npm run dev hanya menyediakan preview tampilan.');
  }
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body.error?.message || 'Layanan tidak dapat diakses. Coba kembali.');
  return body.data;
}
export type Session = { id: string; email: string; roles: string[] };
export type Summary = { contacts: number; campaigns: number; templates: number };
