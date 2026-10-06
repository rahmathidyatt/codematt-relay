import type {Campaign,Counts} from '../campaigns/model.ts';
export const zones={'Asia/Jakarta':'+07:00','Asia/Makassar':'+08:00','Asia/Jayapura':'+09:00','UTC':'Z'} as const;
export type DeliveryCampaign=Campaign&{delivery_mode:'live'|'demo'|null;scheduled_at:string|null;timezone:string;pause_reason:string|null;is_test:boolean;parent_id:string|null;source_waba:string|null;sender_id:string|null;consent_confirmed_by:string|null};
export type Recipient={id:string;name:string;phone_snapshot:string;status:string;attempt_count:number;failure_code:string|null;failure_reason:string|null;provider_message_id:string|null;next_attempt_at:string|null};
export type DeliveryDetail={campaign:DeliveryCampaign;counts:Record<string,number>;items:Recipient[];total:number;page:number;outbox:{available_at:string;published_at:string|null;attempts:number}|null;enabled:boolean;demo:boolean;last_scheduler_at:string|null;last_worker_at:string|null;last_webhook_at:string|null};
export type Review={version:number;hash:string;counts:Counts;name:string;template:string;language:string;enabled:boolean;demo:boolean;samples:{id:string;name:string}[]};
export const recipientLabels:Record<string,string>={queued:'Dalam antrean',dispatching:'Sedang diproses',accepted:'Diterima Meta',sent:'Terkirim',delivered:'Diterima penerima',read:'Dibaca',failed:'Gagal',skipped:'Dilewati',uncertain:'Hasil belum pasti'};
