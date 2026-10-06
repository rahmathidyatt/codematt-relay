import {asyncWorkloadFn,type AsyncWorkloadConfig} from '@netlify/async-workloads';
import {getDatabase} from '@netlify/database';
import {fromPool} from '../lib/db.ts';
import {deliveryConfig} from '../lib/delivery-config.ts';
import {dispatchBatch} from '../lib/worker.ts';
import {publishOutbox} from '../lib/queue.ts';
import {publishEvent} from '../lib/async-publisher.ts';
export default asyncWorkloadFn(async ({eventData})=>{
 const cfg=deliveryConfig();if(!cfg)return;
 if(!eventData||typeof eventData.campaignId!=='string'||!/^[0-9a-f-]{36}$/i.test(eventData.campaignId))return;
 const db=fromPool(getDatabase().pool);
 await dispatchBatch(db,eventData.campaignId,cfg);
 await publishOutbox(db,publishEvent,cfg);
});
export const asyncWorkloadConfig:AsyncWorkloadConfig={events:['relay.dispatch'],maxRetries:2,backoffSchedule:()=> '2 minutes'};
