import {AsyncWorkloadsClient} from '@netlify/async-workloads';
import type {Publish} from './queue.ts';
export const publishEvent:Publish=async data=>{const result=await new AsyncWorkloadsClient().send('relay.dispatch',{data});if(result.sendStatus!=='succeeded')throw new Error('Workload publication failed');};
