import type {Database} from './db.ts';
import {jsonBody,sameOrigin} from './contact-api.ts';
import {success} from './http.ts';
import {metaConfig} from './templates.ts';
import {deliveryConfig,requireDelivery} from './delivery-config.ts';
import {reviewDelivery,launchCampaign,controlCampaign,deliveryDetail} from './delivery.ts';
import {InputError} from '../../src/features/contacts/validation.ts';
export function deliveryRoute(path:string) {return /^\/api\/campaigns\/[0-9a-f-]{36}\/(review|launch|test|pause|resume|cancel|delivery)$/i.test(path);}
export async function handleDelivery(request:Request,db:Database,actor:string,demo=false) {
 const url=new URL(request.url);const [,id,action]=url.pathname.match(/^\/api\/campaigns\/([0-9a-f-]{36})\/(\w+)$/i)!;
 const cfg=deliveryConfig(demo),waba=demo?'local-demo':metaConfig()?.waba??null;
 if(request.method==='GET'&&action==='review')return success(await reviewDelivery(db,id,waba,!!cfg,demo));
 if(request.method==='GET'&&action==='delivery')return success(await deliveryDetail(db,id,Number(url.searchParams.get('page')??1),!!cfg,demo));
 if(request.method!=='POST')throw new InputError('Metode tidak didukung.','METHOD_NOT_ALLOWED',405);sameOrigin(request);
 const body=await jsonBody(request);
 if(action==='launch'||action==='test')return success(await launchCampaign(db,id,body,actor,requireDelivery(demo),action==='test'));
 if(action==='pause'||action==='resume'||action==='cancel')return success(await controlCampaign(db,id,body,action,actor,cfg));
 throw new InputError('Endpoint tidak ditemukan.','NOT_FOUND',404);
}
