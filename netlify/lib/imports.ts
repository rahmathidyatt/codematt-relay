import { createHash } from 'node:crypto';
import type { Database } from './db.ts';
import { InputError,object,uuid,validateDraft } from '../../src/features/contacts/validation.ts';
import { LIMITS, type ImportJob, type RowResult } from '../../src/features/contacts/types.ts';
import { insertContact,audit } from './contacts.ts';
export async function createImport(db:Database,value:unknown,actor:string) {
  const body=object(value),id=uuid(body.id),count=Number(body.row_count);
  if(!Number.isSafeInteger(count)||count<1||count>LIMITS.rows)throw new InputError('Import harus berisi 1–10.000 baris.');
  return db.transaction(async tx=>{
    await tx.query("INSERT INTO import_jobs(id,created_by,row_count,status) VALUES($1,$2,$3,'processing') ON CONFLICT(id) DO NOTHING",[id,actor,count]);
    const result=await tx.query<ImportJob&{created_by:string}>('SELECT * FROM import_jobs WHERE id=$1',[id]);
    const job=result.rows[0];if(job.created_by!==actor)throw new InputError('Import tidak ditemukan.','NOT_FOUND',404);
    if(job.row_count!==count)throw new InputError('ID import sudah dipakai untuk data lain.','IMPORT_CONFLICT',409);
    return job;
  });
}
export async function getImport(db:Database,id:string,actor:string) {
  const result=await db.query<ImportJob>('SELECT * FROM import_jobs WHERE id=$1 AND created_by=$2',[uuid(id),actor]);
  if(!result.rows[0])throw new InputError('Import tidak ditemukan.','NOT_FOUND',404);
  return result.rows[0];
}
export async function importChunk(db:Database,id:string,value:unknown,actor:string) {
  uuid(id);const body=object(value),index=Number(body.index);
  if(!Number.isSafeInteger(index)||index<0||index>=LIMITS.rows/LIMITS.batch||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>LIMITS.batch)throw new InputError('Batch import tidak valid.');
  const rows=body.rows;
  const hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return db.transaction(async tx=>{
    const jobResult=await tx.query<ImportJob&{created_by:string}>('SELECT * FROM import_jobs WHERE id=$1 FOR UPDATE',[id]);
    const job=jobResult.rows[0];if(!job||job.created_by!==actor)throw new InputError('Import tidak ditemukan.','NOT_FOUND',404);
    const prior=await tx.query<{request_hash:string;results:RowResult[]}>('SELECT request_hash,results FROM import_chunks WHERE job_id=$1 AND chunk_index=$2',[id,index]);
    if(prior.rows[0]) {
      if(prior.rows[0].request_hash!==hash)throw new InputError('Isi batch berbeda dari percobaan sebelumnya.','IMPORT_CONFLICT',409);
      return {job,results:prior.rows[0].results};
    }
    const expectedSize=Math.min(LIMITS.batch,job.row_count-index*LIMITS.batch);
    if(job.status!=='processing'||job.processed_count!==index*LIMITS.batch||rows.length!==expectedSize)throw new InputError('Urutan atau jumlah batch import tidak sesuai.','IMPORT_CONFLICT',409);
    const results:RowResult[]=[];
    // Validate input before writing each row. Duplicate existing contacts are NEVER updated.
    for(let i=0;i<rows.length;i++) {
      const item=object(rows[i]); const row=Number(item.row);
      if(!Number.isSafeInteger(row)||row<2||row>LIMITS.rows+1)throw new InputError('Nomor baris tidak valid.');
      try {validateDraft(item.data);}catch(e){if(e instanceof InputError){results.push({row,status:'invalid',reason:e.message});continue;}throw e;}
      const contactId=await insertContact(tx,item.data,actor,true);
      results.push({row,status:contactId?'imported':'duplicate',...(!contactId?{reason:'Nomor sudah tersimpan; data dan consent tidak diubah.'}:{})});
    }
    const imported=results.filter(x=>x.status==='imported').length,invalid=results.filter(x=>x.status==='invalid').length,duplicate=results.length-imported-invalid;
    await tx.query('INSERT INTO import_chunks(job_id,chunk_index,request_hash,results) VALUES($1,$2,$3,$4::jsonb)',[id,index,hash,JSON.stringify(results)]);
    const complete=job.processed_count+results.length===job.row_count;
    const updated=await tx.query<ImportJob>(`UPDATE import_jobs SET processed_count=processed_count+$1,imported_count=imported_count+$2,error_count=error_count+$3,duplicate_count=duplicate_count+$4,status=$5,completed_at=CASE WHEN $6 THEN now() ELSE NULL END WHERE id=$7 RETURNING *`,[results.length,imported,invalid,duplicate,complete?'completed':'processing',complete,id]);
    await audit(tx,actor,complete?'contacts.import_completed':'contacts.import_batch','import',id,{batch:index,imported,invalid,duplicate});
    return {job:updated.rows[0],results};
  });
}
