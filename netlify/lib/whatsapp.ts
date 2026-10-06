import {InputError,normalizePhone} from '../../src/features/contacts/validation.ts';
import {mappingIssues,renderMessage,type Template,type Mapping} from '../../src/features/campaigns/model.ts';
import type {DeliveryConfig} from './delivery-config.ts';
export type MessagePart={type:string;parameters:{type:'text';text:string;parameter_name?:string}[]};
export function messageParameters(t:Template,m:Mapping,c:{name:string;phone_e164:string}):MessagePart[] {
 const errors=mappingIssues(t,m);if(errors.length)throw new InputError(errors[0]);normalizePhone(c.phone_e164);
 const parts:MessagePart[]=[];
 for(const type of ['HEADER','BODY']) {
  const variables=t.variables.filter(v=>v.startsWith(type+':'));if(t.parameter_format==='POSITIONAL')variables.sort((a,b)=>Number(a.split(':')[1])-Number(b.split(':')[1]));
  if(!variables.length)continue;
  const parameters=variables.map(key=>{const rule=m[key];const value=rule.source==='literal'?rule.value??'':c[rule.source];
   if(!value.trim()||value.length>1024||/[\r\n\t]| {5}/.test(value))throw new InputError(`Nilai ${key} kosong, terlalu panjang, atau mengandung baris/tab/spasi berlebih.`);
   return {type:'text' as const,text:value,...(t.parameter_format==='NAMED'?{parameter_name:key.split(':')[1]}:{})};});
  parts.push({type:type.toLowerCase(),parameters});
 }
 for(const part of renderMessage(t,m,c))if((part.type==='HEADER'&&part.text.length>60)||(part.type==='BODY'&&part.text.length>1024))throw new InputError('Pesan hasil personalisasi melebihi batas header 60 / body 1.024 karakter.');
 return parts;
}
export type SendResult={kind:'accepted';id:string}|{kind:'retry';code:string;after:number}|{kind:'failed'|'uncertain'|'pause';code:string};
async function responseJson(r:Response) {
 const reader=r.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let n=0;
 try{while(true){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>65536){await reader.cancel();throw new Error();}chunks.push(p.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(n);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
export async function sendWhatsApp(config:DeliveryConfig,to:string,t:Template,components:MessagePart[],attempt:number,transport:typeof fetch=fetch):Promise<SendResult> {
 if(config.demo)throw new Error('Real adapter cannot run in demo');
 try {
  const response=await transport(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:to.replace(/^\+/,''),type:'template',template:{name:t.name,language:{code:t.language},...(components.length?{components}:{})}}),signal:AbortSignal.timeout(10000),redirect:'error'});
  const data=await responseJson(response);const code=Number(data?.error?.code);
  if(response.ok&&typeof data?.messages?.[0]?.id==='string'&&data.messages[0].id.length<=300)return {kind:'accepted',id:data.messages[0].id};
  // A transport error, malformed success or 5xx may occur AFTER acceptance. Never blindly retry.
  if(response.status>=500||response.ok)return {kind:'uncertain',code:'AMBIGUOUS_RESPONSE'};
  if([131048,131049,132015,132016,368,190,10,200].includes(code)||response.status===401||response.status===403)return {kind:'pause',code:String(Number.isFinite(code)?code:response.status)};
  if(data?.error&&(response.status===429||[4,80007,130429,131056].includes(code))) {
   const raw=response.headers.get('retry-after');let delay=raw&&/^\d+$/.test(raw)?Number(raw)*1000:raw?Date.parse(raw)-Date.now():0;
   if(!Number.isFinite(delay)||delay<0)delay=0;
   const after=Math.max(delay,60000*2**Math.min(attempt-1,5));
   if(after>365*86400000)return {kind:'pause',code:'RETRY_AFTER_TOO_LONG'};
   return {kind:'retry',code:String(Number.isFinite(code)?code:429),after};
  }
  if(response.status>=400&&response.status<500&&data?.error)return {kind:'failed',code:String(Number.isFinite(code)?code:response.status)};
  return {kind:'uncertain',code:'UNRECOGNIZED_RESPONSE'};
 }catch{return {kind:'uncertain',code:'NETWORK_OR_TIMEOUT'};}
}
