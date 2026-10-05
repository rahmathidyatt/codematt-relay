import type {Database} from './db.ts';
import {InputError} from '../../src/features/contacts/validation.ts';
import {jsonBody,sameOrigin} from './contact-api.ts';
import {success} from './http.ts';
import {metaConfig,templateList,syncTemplates,fetchTemplates,type ProviderTemplate} from './templates.ts';
import {campaignList,getCampaign,previewDraft,saveDraft} from './campaigns.ts';
export function campaignRoute(path:string){return /^\/api\/(templates(?:\/sync)?|campaigns(?:\/(?:preview|[0-9a-f-]{36}))?)$/i.test(path);}
export async function handleCampaigns(request:Request,db:Database,actor:string,demo=false) {
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(method!=='GET')sameOrigin(request);
 const config=demo?null:metaConfig();const waba=demo?'local-demo':config?.waba??null;
 if(path==='/api/templates'&&method==='GET') {
  const state=(await db.query<{synced_at:string|null;source_waba:string|null}>('SELECT synced_at,source_waba FROM template_sync_state WHERE id=true')).rows[0];
  return success({items:await templateList(db,waba),configured:demo||!!config,demo,last_sync:state?.source_waba===waba?state.synced_at:null});
 }
 if(path==='/api/templates/sync'&&method==='POST') {
  if(!demo&&!config)throw new InputError('Admin perlu mengisi WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, dan WHATSAPP_API_VERSION di server.','META_NOT_CONFIGURED',503);
  return success(await syncTemplates(db,actor,waba!,demo?async()=>demoTemplates:()=>fetchTemplates(config!)));
 }
 if(path==='/api/campaigns'&&method==='GET')return success(await campaignList(db,Number(url.searchParams.get('page')??1),url.searchParams.get('q')??''));
 if(path==='/api/campaigns'&&method==='POST')return success(await saveDraft(db,await jsonBody(request),actor,waba));
 if(path==='/api/campaigns/preview'&&method==='POST')return success(await previewDraft(db,await jsonBody(request),waba,Number(url.searchParams.get('page')??1)));
 const id=path.match(/^\/api\/campaigns\/([0-9a-f-]{36})$/i)?.[1];
 if(id&&method==='GET')return success(await getCampaign(db,id));
 throw new InputError('Metode tidak didukung.','METHOD_NOT_ALLOWED',405);
}
const demoTemplates:ProviderTemplate[]=[
 {provider_id:'demo-welcome',name:'contoh_sapaan',language:'id',category:'UTILITY',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'HEADER',format:'TEXT',text:'Informasi untuk pelanggan'},{type:'BODY',text:'Halo {{1}}, terima kasih sudah berlangganan informasi {{2}}.'},{type:'FOOTER',text:'Balas BERHENTI untuk berhenti menerima pesan.'},{type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Terima kasih'}]}]},
 {provider_id:'demo-named',name:'contoh_update',language:'id',category:'UTILITY',status:'APPROVED',parameter_format:'NAMED',components:[{type:'BODY',text:'Halo {{nama}}, berikut informasi yang Anda minta: {{informasi}}.'}]},
 {provider_id:'demo-pending',name:'contoh_menunggu_review',language:'id',category:'MARKETING',status:'PENDING',parameter_format:'POSITIONAL',components:[{type:'BODY',text:'Informasi penawaran bulan ini.'}]},
 {provider_id:'demo-media',name:'contoh_header_gambar',language:'id',category:'MARKETING',status:'APPROVED',parameter_format:'POSITIONAL',components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'Halo {{1}}, berikut katalog kami.'}]},
];
