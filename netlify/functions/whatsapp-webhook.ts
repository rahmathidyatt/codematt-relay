import {getDatabase} from '@netlify/database';
import {fromPool} from '../lib/db.ts';
import {webhookConfig,readWebhookBody,validSignature,verifyChallenge,processWebhook} from '../lib/webhooks.ts';
import {InputError} from '../../src/features/contacts/validation.ts';
import {failure,success} from '../lib/http.ts';
export default async function handler(request:Request) {
 const config=webhookConfig();if(!config)return failure(503,'WEBHOOK_NOT_CONFIGURED','Webhook belum dikonfigurasi.');
 try {
  if(request.method==='GET')return new Response(verifyChallenge(new URL(request.url),config),{headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
  if(request.method!=='POST')return failure(405,'METHOD_NOT_ALLOWED','Metode tidak didukung.');
  const body=await readWebhookBody(request);if(!validSignature(body,request.headers.get('x-hub-signature-256'),config.secret))return failure(401,'BAD_SIGNATURE','Signature ditolak.');
  let payload:unknown;try{payload=JSON.parse(body.toString('utf8'));}catch{throw new InputError('JSON tidak valid.');}
  return success(await processWebhook(fromPool(getDatabase().pool),payload,config));
 }catch(e){return e instanceof InputError?failure(e.status,e.code,e.message):failure(503,'WEBHOOK_RETRY','Event belum tersimpan. Coba lagi.');}
}
