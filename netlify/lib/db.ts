export type Row = Record<string,unknown>;
export interface Query { query<T=Row>(sql:string,params?:unknown[]):Promise<{rows:T[]}> }
export interface Database extends Query { transaction<T>(run:(tx:Query)=>Promise<T>):Promise<T> }
export function fromPool(pool: {query:(sql:string,params?:unknown[])=>Promise<{rows:Row[]}>;connect:()=>Promise<{query:(sql:string,params?:unknown[])=>Promise<{rows:Row[]}>;release:()=>void}>}):Database {
  return {
    query: (sql,params)=>pool.query(sql,params) as ReturnType<Query['query']>,
    async transaction(run) {
      const client=await pool.connect();
      try { await client.query('BEGIN'); const result=await run(client as Query);await client.query('COMMIT');return result; }
      catch(e) { await client.query('ROLLBACK');throw e; }
      finally { client.release(); }
    },
  } as Database;
}
