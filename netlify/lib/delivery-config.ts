import {metaConfig,type MetaConfig} from './templates.ts';
import {InputError} from '../../src/features/contacts/validation.ts';
export type DeliveryConfig=MetaConfig&{phoneId:string;demo:boolean;minInterval:number;batchSize:number};
export function deliveryConfig(demo=false,env:Record<string,string|undefined>=process.env):DeliveryConfig|null {
 if(demo)return {waba:'local-demo',phoneId:'local-demo',token:'',version:'demo',demo:true,minInterval:0,batchSize:5};
 const meta=metaConfig(env);const phoneId=env.WHATSAPP_PHONE_NUMBER_ID??'';
 if(env.WHATSAPP_SEND_ENABLED!=='true'||env.RELAY_ASYNC_READY!=='true'||env.CONTEXT!=='production'||!meta||!/^\d{5,30}$/.test(phoneId)||!env.META_APP_SECRET||!env.WHATSAPP_VERIFY_TOKEN)return null;
 const interval=Number(env.RELAY_SEND_INTERVAL_MS??2000),batch=Number(env.RELAY_BATCH_SIZE??5);
 if(!Number.isInteger(interval)||interval<1000||interval>30000||!Number.isInteger(batch)||batch<1||batch>10)return null;
 return {...meta,phoneId,demo:false,minInterval:interval,batchSize:batch};
}
export function requireDelivery(demo=false) {const c=deliveryConfig(demo);if(!c)throw new InputError('Pengiriman nonaktif. Admin perlu menyelesaikan konfigurasi Meta, webhook, Async Workloads, dan flag produksi.','SENDING_DISABLED',503);return c;}
