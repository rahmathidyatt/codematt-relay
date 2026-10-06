import type {Config} from '@netlify/functions';
import {getDatabase} from '@netlify/database';
import {fromPool} from '../lib/db.ts';
import {deliveryConfig} from '../lib/delivery-config.ts';
import {schedulerTick,publishOutbox} from '../lib/queue.ts';
import {publishEvent} from '../lib/async-publisher.ts';
export default async function handler() {
 const cfg=deliveryConfig();if(!cfg)return new Response(null,{status:204});
 const db=fromPool(getDatabase().pool);await schedulerTick(db,cfg);await publishOutbox(db,publishEvent,cfg);return new Response(null,{status:204});
}
export const config:Config={schedule:'* * * * *'};
