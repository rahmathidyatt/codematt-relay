import {api} from '../../lib/api.ts';
import type {ContactList,Contact,ContactDraft,ConsentEvent,ImportJob,ImportRow,RowResult} from './types.ts';
export function contactsClient(demo:boolean) {
  const request=<T>(path:string,method='GET',body?:unknown)=>api<T>(path,{method,body:body===undefined?undefined:JSON.stringify(body)},demo);
  return {
    list:(params:URLSearchParams)=>request<ContactList>('contacts?'+params),
    tags:(q='')=>request<{name:string}[]>('tags?q='+encodeURIComponent(q)),
    create:(data:ContactDraft)=>request<Contact>('contacts','POST',data),
    update:(id:string,data:unknown)=>request<Contact>(`contacts/${id}`,'PATCH',data),
    consent:(id:string,data:unknown)=>request<Contact>(`contacts/${id}/consent`,'POST',data),
    history:(id:string,page=1)=>request<{items:ConsentEvent[];hasMore:boolean}>(`contacts/${id}/history?page=${page}`),
    bulk:(contacts:{id:string;version:number}[],action:string,tags?:string[])=>request<{count:number}>('contacts/bulk','POST',{contacts,action,tags}),
    export:(params:URLSearchParams)=>request<{items:Contact[];next:string|null;until:string}>('contacts/export?'+params),
    startImport:(id:string,row_count:number)=>request<ImportJob>('imports','POST',{id,row_count}),
    importChunk:(id:string,index:number,rows:ImportRow[])=>request<{job:ImportJob;results:RowResult[]}>(`imports/${id}/chunks`,'POST',{index,rows}),
    getImport:(id:string)=>request<ImportJob>(`imports/${id}`),
    reset:()=>request('reset','POST',{confirmed:true}),
  };
}
export type ContactsClient=ReturnType<typeof contactsClient>;
