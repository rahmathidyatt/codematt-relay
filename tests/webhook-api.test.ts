import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const mocks=vi.hoisted(()=>({getDatabase:vi.fn()}));vi.mock('@netlify/database',()=>({getDatabase:mocks.getDatabase}));
import handler from '../netlify/functions/whatsapp-webhook';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('WHATSAPP_BUSINESS_ACCOUNT_ID','123456');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','654321');vi.stubEnv('META_APP_SECRET','secret');vi.stubEnv('WHATSAPP_VERIFY_TOKEN','verify');});
afterEach(()=>vi.unstubAllEnvs());
it('rejects an unsigned or forged webhook before accessing the database',async()=>{
 const r=await handler(new Request('https://relay.example/api/webhooks/whatsapp',{method:'POST',headers:{'x-hub-signature-256':'sha256='+'0'.repeat(64)},body:'{}'}));expect(r.status).toBe(401);expect(mocks.getDatabase).not.toHaveBeenCalled();expect(await r.text()).not.toContain('secret');
});
it('accepts the configured verification challenge without exposing its token',async()=>{
 const r=await handler(new Request('https://relay.example/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=123'));expect(r.status).toBe(200);expect(await r.text()).toBe('123');expect(mocks.getDatabase).not.toHaveBeenCalled();
});
it('the Async Workloads wrapper rejects direct unauthenticated calls',async()=>{
 const {default:dispatch}=await import('../netlify/functions/relay-dispatch');
 const response=await dispatch(new Request('https://relay.example/.netlify/functions/relay-dispatch',{method:'POST',body:'[]'}),{} as Parameters<typeof dispatch>[1]);expect(response?.status).toBe(400);expect(mocks.getDatabase).not.toHaveBeenCalled();
});
