import type {Plugin} from 'vite';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {Database} from '../netlify/lib/db.ts';
import {handleContacts,contactRoute,jsonBody} from '../netlify/lib/contact-api.ts';
import {failure,success} from '../netlify/lib/http.ts';
import {InputError} from '../src/features/contacts/validation.ts';
let pending:Promise<Database>|undefined;
async function database():Promise<Database> {
  if(!pending)pending=(async()=>{
    const directory=process.env.RELAY_DEMO_DIR??'.demo-data';await mkdir(directory,{recursive:true});const db=new PGlite(directory);
    await db.exec('CREATE TABLE IF NOT EXISTS demo_migrations(name text PRIMARY KEY)');
    for(const name of (await readdir('netlify/database/migrations')).filter(x=>x.endsWith('.sql')).sort()) {
      const applied=await db.query('SELECT 1 FROM demo_migrations WHERE name=$1',[name]);
      if(!applied.rows.length)await db.transaction(async tx=>{await tx.exec(await readFile('netlify/database/migrations/'+name,'utf8'));await tx.query('INSERT INTO demo_migrations(name) VALUES($1)',[name]);});
    }
    return db as unknown as Database;
  })();
  return pending;
}
export function demoPlugin():Plugin {
  return {name:'relay-local-demo',apply:'serve',configureServer(server){
    server.middlewares.use('/__demo/api',async(req,res)=>{
      // Only explicit loopback requests can access synthetic development data. Never mounted in a build.
      const host=req.headers.host??'';
      if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)){res.statusCode=403;res.end();return;}
      try {
        const origin=`http://${host}`;const method=req.method??'GET';
        if(req.headers.origin&&req.headers.origin!==origin){res.statusCode=403;res.end();return;}
        if(req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;res.end();return;}
        const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(typeof value==='string')headers.set(key,value);
        let body:string|undefined;
        if(method!=='GET') {
          let bytes=0;const chunks:Buffer[]=[];
          for await(const part of req){bytes+=part.length;if(bytes>256*1024)throw new InputError('Ukuran permintaan terlalu besar.','PAYLOAD_TOO_LARGE',413);chunks.push(part);}
          body=Buffer.concat(chunks).toString();
        }
        const request=new Request(origin+'/api'+(req.url??''),{method,headers,body});
        const path=new URL(request.url).pathname;
        let response:Response;
        if(contactRoute(path))response=await handleContacts(request,await database(),'local-demo');
        else if(path==='/api/dashboard'&&method==='GET') {
          const result=await(await database()).query<{contacts:number}>('SELECT count(*)::int AS contacts FROM contacts WHERE archived_at IS NULL');
          response=success({contacts:result.rows[0].contacts,campaigns:0,templates:0});
        } else if(path==='/api/reset'&&method==='POST') {
          if(headers.get('origin')!==origin)throw new InputError('Asal permintaan tidak valid.');
          const value=await jsonBody(request) as {confirmed?:boolean};if(value.confirmed!==true)throw new InputError('Konfirmasi terlebih dahulu.');
          await(await database()).query('TRUNCATE import_chunks,import_jobs,consent_events,contact_tags,contacts,tags,audit_logs CASCADE');response=success({cleared:true});
        } else response=failure(404,'NOT_FOUND','Endpoint demo tidak ditemukan.');
        res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());
      }catch(e){const response=e instanceof InputError?failure(e.status,e.code,e.message):e&&typeof e==='object'&&'code'in e&&e.code==='23505'?failure(409,'DUPLICATE_PHONE','Nomor sudah tersimpan. Data lama tidak diubah.'):failure(503,'DEMO_ERROR','Demo belum siap. Hentikan server lain yang memakai folder proyek ini, lalu coba lagi.');res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text());}
    });
  }};
}
