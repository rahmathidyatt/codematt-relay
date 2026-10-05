import {createServer,type ViteDevServer} from 'vite';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {demoPlugin} from '../dev/demo-plugin';
let server:ViteDevServer,base:string;
beforeAll(async()=>{
  process.env.RELAY_DEMO_DIR=await mkdtemp(join(tmpdir(),'relay-demo-test-'));
  server=await createServer({configFile:false,plugins:[demoPlugin()],server:{host:'127.0.0.1',port:0}});await server.listen();
  const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('No test server');base=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{await server?.close();delete process.env.RELAY_DEMO_DIR;});
it('serves the real local API, persists edits, and rejects foreign-origin writes',async()=>{
  const response=await fetch(base+'/__demo/api/contacts',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Local Demo',phone:'081234567890'})});
  expect(response.status).toBe(200);const result=await response.json();expect(result.data.phone_e164).toBe('+6281234567890');
  const list=await(await fetch(base+'/__demo/api/contacts')).json();expect(list.data.total).toBe(1);
  const summary=await(await fetch(base+'/__demo/api/dashboard')).json();expect(summary.data.contacts).toBe(1);
  const rejected=await fetch(base+'/__demo/api/reset',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{"confirmed":true}'});expect(rejected.status).toBe(403);
},30000);
