import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import mysql,{type RowDataPacket} from 'mysql2/promise';
registerHooks({resolve(specifier,context,next){return next(specifier==='server-only'?'next/dist/compiled/server-only/empty.js':specifier,context);}});
async function main(){
  const database=`nazraa_tx_qa_${Date.now()}`;
  const root=await mysql.createConnection({host:'127.0.0.1',user:'root'});
  await root.query(`CREATE DATABASE \`${database}\``);
  global.nazraaPool=mysql.createPool({host:'127.0.0.1',user:'root',database,connectionLimit:2});
  global.nazraaInstrumentedPool=global.nazraaPool;
  try{
    await root.query(`CREATE TABLE \`${database}\`.qa_effects (id CHAR(36) PRIMARY KEY) ENGINE=InnoDB`);
    const transactions=await import('@/lib/db/transaction');
    const marker=randomUUID();let attempts=0;
    await transactions.withIdempotentTransaction(async connection=>{
      attempts++;await connection.execute('INSERT INTO qa_effects(id) VALUES (?)',[marker]);
      if(attempts===1)throw Object.assign(new Error('Isolated concurrent-read conflict'),{code:'ER_CHECKREAD'});
    });
    assert.equal(attempts,2);
    const [rows]=await root.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM \`${database}\`.qa_effects`);
    assert.equal(Number(rows[0].total),1,'retry rolls back the first write, no duplicate commit');
    let unkeyedAttempts=0;
    await assert.rejects(transactions.withTransaction(async()=>{unkeyedAttempts++;throw Object.assign(new Error('Unkeyed must not replay'),{code:'ER_CHECKREAD'});}));
    assert.equal(unkeyedAttempts,1);
    let ambiguousAttempts=0;
    await assert.rejects(transactions.withIdempotentTransaction(async()=>{ambiguousAttempts++;throw Object.assign(new Error('Connection loss is not a confirmed conflict'),{code:'ECONNRESET'});}));
    assert.equal(ambiguousAttempts,1);
    console.log('PASS ER_CHECKREAD: confirmed rollback then one commit; unkeyed and ambiguous-connection writes never replay.');
  }finally{
    await global.nazraaPool.end();global.nazraaPool=undefined;global.nazraaInstrumentedPool=undefined;
    await root.query(`DROP DATABASE \`${database}\``);await root.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
