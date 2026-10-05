export async function api<T>(path:string,options:RequestInit={},demo=false):Promise<T> {
  const prefix=demo&&import.meta.env.DEV?'/__demo/api/':'/api/';
  const response=await fetch(prefix+path,{...options,credentials:'same-origin',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Gunakan netlify dev untuk login dan database. npm run dev menyediakan mode demo lokal.');
  const body=await response.json();if(!response.ok||!body.ok)throw new Error(body.error?.message||'Layanan tidak dapat diakses. Coba kembali.');
  return body.data;
}
export type Session={id:string;email:string;roles:string[]};
export type Summary={contacts:number;campaigns:number;templates:number};
