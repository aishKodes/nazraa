/** One table failure cannot silence healthy phase updates; local disposable SQL only. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
registerHooks({ resolve(s,c,n) { return n(s === "server-only" ? "next/dist/compiled/server-only/empty.js" : s,c); } });
async function main() {
  const fixture = JSON.parse(await readFile("/tmp/nazraa-owner-staging-fixtures.json", "utf8"));
  assert.match(fixture.database, /^nazraa_mobile_qa_\d+$/);
  const pool = mysql.createPool({host:"127.0.0.1",user:"root",database:fixture.database,timezone:"Z",decimalNumbers:true,connectionLimit:4});
  pool.on("connection", c => { void c.query("SET time_zone='+00:00'"); });
  let inject = true;
  const wrapped = new Proxy(pool, {get(target, prop) {
    if (prop === "getConnection") return async () => {
      const connection = await target.getConnection();
      return new Proxy(connection, {get(c,p) {
        if (p === "query") return async (sql: string, values?: unknown[]) => {
          if (inject && sql.includes("FROM game_shared_bets bet") && values?.[0] === "lion_vs_tiger") {
            throw Object.assign(new Error("Isolated synthetic unavailable table"), {code:"QA_TABLE_FAILURE"});
          }
          return c.query(sql, values);
        };
        const v = Reflect.get(c,p); return typeof v === "function" ? v.bind(c) : v;
      }});
    };
    const v = Reflect.get(target,prop); return typeof v === "function" ? v.bind(target) : v;
  }});
  global.nazraaPool = wrapped; global.nazraaInstrumentedPool = wrapped;
  process.env.REDIS_URL = "redis://127.0.0.1:56379";
  try {
    const {maintainSharedGameRounds} = await import("../lib/db/repositories/mobile-product");
    const degraded = await maintainSharedGameRounds();
    assert.deepEqual(degraded.failures, [{game:"lion_vs_tiger",stage:"settlement",code:"QA_TABLE_FAILURE"}]);
    assert(degraded.realtime.some(s => s.game === "teen_patti_pro"));
    assert(degraded.realtime.some(s => s.game === "teen_patti"));
    assert.equal(degraded.realtime.length, 6);
    inject = false;
    const recovered = await maintainSharedGameRounds();
    assert.deepEqual(recovered.failures, []);
    assert.equal(recovered.realtime.length, 7);
    console.log("PASS injected table rollback, six healthy phase states, recovery to all seven; no duplicate financial command replay.");
  } finally { await pool.end(); }
}
main().then(() => process.exit(0)).catch(e => {console.error(e);process.exit(1);});
