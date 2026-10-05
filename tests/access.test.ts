import { describe, it, expect, vi, beforeEach } from 'vitest';
import { can } from '../src/lib/permissions';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getDatabase: vi.fn() }));
vi.mock('@netlify/identity', () => ({ getUser: mocks.getUser }));
vi.mock('@netlify/database', () => ({ getDatabase: mocks.getDatabase }));
import handler from '../netlify/functions/api';
beforeEach(() => { vi.resetAllMocks(); });
describe('API trust boundaries', () => {
  it('rejects an unauthenticated user before touching the database', async () => {
    mocks.getUser.mockResolvedValue(null);
    const result = await handler(new Request('https://relay.example/api/dashboard'));
    expect(result.status).toBe(401); expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('does not trust client-supplied role headers', async () => {
    mocks.getUser.mockResolvedValue({id:'viewer',roles:['viewer']});
    const result = await handler(new Request('https://relay.example/api/settings',{headers:{'X-Role':'admin'}}));
    expect(result.status).toBe(403); expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('denies users without recognized roles', async () => {
    mocks.getUser.mockResolvedValue({id:'unknown',roles:[]});
    expect((await handler(new Request('https://relay.example/api/session'))).status).toBe(403);
  });
  it('never includes provider or auth secrets in a session response', async () => {
    mocks.getUser.mockResolvedValue({id:'a',email:'a@example.com',roles:['admin'],token:'secret'});
    const result = await handler(new Request('https://relay.example/api/session'));
    expect(await result.json()).toEqual({ok:true,data:{id:'a',email:'a@example.com',roles:['admin']}});
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('returns safe errors on provider failure', async () => {
    mocks.getUser.mockRejectedValue(new Error('sensitive database secret'));
    const result = await handler(new Request('https://relay.example/api/session'));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain('sensitive');
  });
  it('returns JSON 404 for unimplemented send endpoints', async () => {
    const result = await handler(new Request('https://relay.example/api/campaigns/send',{method:'POST'}));
    expect(result.status).toBe(404); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('blocks viewer contact access before any database request', async () => {
    mocks.getUser.mockResolvedValue({id:'v',roles:['viewer']});
    const response=await handler(new Request('https://relay.example/api/contacts'));
    expect(response.status).toBe(403);expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('blocks cross-origin writes even for an authenticated admin', async () => {
    mocks.getUser.mockResolvedValue({id:'a',roles:['admin']});
    const response=await handler(new Request('https://relay.example/api/contacts',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}));
    expect(response.status).toBe(403);expect(mocks.getDatabase).not.toHaveBeenCalled();
  });
  it('restricts writes and settings by role', () => {
    expect(can(['viewer'],'contacts:write')).toBe(false);
    expect(can(['operator'],'settings:read')).toBe(false);
    expect(can(['operator'],'contacts:write')).toBe(true);
    expect(can(['admin'],'settings:read')).toBe(true);
  });
});
