import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile,writeFile,mkdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { spawn } from "node:child_process";
import ExcelJS from 'exceljs';
import mysql, { type RowDataPacket } from "mysql2/promise";
import { SignJWT } from "jose";
import type { Scope, Role } from "@/types/platform";

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, context);
} });

async function main() {
  // Deliberately local only: never test bans against real production users.
  const database = `nazraa_http_qa_${Date.now()}`;
  const dbUser = `qa_${randomBytes(6).toString("hex")}`;
  const dbPassword = randomBytes(24).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const root = await mysql.createConnection({ host: "127.0.0.1", user: "root", multipleStatements: true });
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await root.query(`USE \`${database}\``);
    for (const file of (await readdir("db/migrations")).filter(f => f.endsWith(".sql")).sort())
      await root.query(await readFile(`db/migrations/${file}`, "utf8"));
    await root.query(`CREATE USER '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'`);
    await root.query(`GRANT ALL ON \`${database}\`.* TO '${dbUser}'@'localhost'`);
    global.nazraaPool = mysql.createPool({ host: "127.0.0.1", user: "root", database, connectionLimit: 4, timezone: "Z" });
    global.nazraaInstrumentedPool = global.nazraaPool;
    const accounts = await import("@/lib/db/repositories/accounts");
    const admin = await import("@/lib/db/repositories/administration");
    await accounts.createInitialMaster({ publicId: 100001, fullName: "HTTP QA Master", password: randomBytes(20).toString("hex") });
    const master = await accounts.scopeFor((await accounts.accountByManagementId("100001"))!);
    const scopes = new Map<Role, Scope>([["MASTER", master]]);
    async function create(role: Role, parent: Scope) {
      const added = await admin.createPlatformAccount({ scope: master, role, fullName: `HTTP QA ${role}`,
        countryCode: "IN", requestedParentId: parent.account.id, password: randomBytes(20).toString("hex"), documents: [] });
      const scope = await accounts.scopeFor((await accounts.accountByManagementId(String(added.publicId)))!);
      scopes.set(role, scope); return scope;
    }
    const cm = await create("COUNTRY_MANAGER", master);
    const sa = await create("SUPER_ADMIN", cm);
    const manager = await create("ADMIN", sa);
    await create("BD", sa); await create("AGENCY", manager);
    await create("COIN_SELLER", manager); await create("MONITORING_CS", manager);
    const target = randomUUID();
    await root.execute("INSERT INTO application_users (id, external_user_id, full_name) VALUES (?, ?, 'HTTP QA Target')", [target, target]);
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3998"], {
      env: { ...process.env, NODE_ENV: "production", DB_HOST: "127.0.0.1", DB_NAME: database, DB_USER: dbUser,
        DB_PASSWORD: dbPassword, DB_PORT: "3306", SESSION_SECRET: secret, DB_SSL: "false", REDIS_URL: "",
        LIVEKIT_API_KEY: "", LIVEKIT_API_SECRET: "", NAZRAA_CUTOVER_FREEZE: "0" },
      stdio: "ignore",
    });
    const url = "http://127.0.0.1:3998";
    for (let i = 0; i < 80; i++) {
      if ((await fetch(url + "/api/internal/health").catch(() => null))?.ok) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    async function cookie(scope?: Scope) {
      if (!scope) return "";
      const token = await new SignJWT(scope.account as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m")
        .sign(new TextEncoder().encode(secret));
      return "nazraa_control_session=" + token;
    }
    async function post(scope: Scope | undefined, extra: Record<string, unknown>, origin = "https://nazralive.in") {
      return fetch(url + "/api/control/moderation", { method: "POST", headers: {
        "content-type": "application/json", cookie: await cookie(scope), origin },
        body: JSON.stringify({ applicationUserId: target, reason: "Isolated HTTP QA moderation", confirmed: true, ...extra }) });
    }
    assert.equal((await post(undefined, { action: "BAN" })).status, 401);
    for (const [role, scope] of scopes) {
      if (role === "MASTER") continue;
      assert.equal((await post(scope, { action: "BAN" })).status, 403, role);
    }
    assert.equal((await post(master, { action: "BAN" }, "https://untrusted.example")).status, 403);
    assert.equal((await post(master, { action: "BAN" })).status, 200);
    assert.equal((await post(master, { action: "UNBAN" })).status, 200);
    const cs = scopes.get("MONITORING_CS")!;
    assert.equal((await post(cs, { action: "SUSPEND_FACE", durationMinutes: 999999999, permanent: true })).status, 400);
    assert.equal((await post(manager, { action: "SUSPEND_FACE", durationMinutes: 30 })).status, 403);
    for (const minutes of [30, 120]) {
      const response = await post(cs, { action: "SUSPEND_FACE", durationMinutes: minutes });
      assert.equal(response.status, 200, await response.clone().text());
      const [rows] = await root.query<RowDataPacket[]>("SELECT id, TIMESTAMPDIFF(SECOND, starts_at, ends_at) seconds FROM moderation_restrictions WHERE application_user_id = ? AND restriction_type = 'FACE_LIVE' AND status = 'ACTIVE'", [target]);
      assert.equal(Number(rows[0].seconds), minutes * 60);
      assert.equal((await post(cs, { action: "SUSPEND_FACE", durationMinutes: minutes })).status, 400, "no overlapping restrictions");
      await root.execute("UPDATE moderation_restrictions SET ends_at = CURRENT_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [rows[0].id]);
    }
    async function get(scope:Scope,route:string){return fetch(url+route,{headers:{cookie:await cookie(scope)},redirect:'manual'});}
    for(const [role,scope] of scopes){
      assert.equal((await get(scope,'/api/reports/games')).status,['MASTER','COUNTRY_MANAGER','SUPER_ADMIN','ADMIN','BD','MONITORING_CS'].includes(role)?200:403,`${role} game direct API`);
      assert.equal((await get(scope,'/api/reports/live-rewards')).status,role==='COIN_SELLER'?403:200,`${role} Live report direct API`);
      for(const restrictedPage of ['monitoring','face-verification'])if(['SUPER_ADMIN','ADMIN','AGENCY'].includes(role)){
        const denied=await get(scope,`/dashboard/${restrictedPage}`);
        const html=await denied.text();
        assert.ok(denied.headers.get('location')?.includes('forbidden')||html.includes('/dashboard?error=forbidden'),`${role} direct ${restrictedPage} must deny (including Next streamed redirects)`);
      }
      if(role!=='MASTER')assert.equal((await get(scope,'/api/reports/withdrawal-summary?kind=detail&format=csv')).status,403,`${role} Master withdrawal export`);
    }
    assert.equal((await get(cs,'/api/reports/games?format=xlsx')).status,403,'CS read access does not grant a new export permission');
    // More than one UI page proves exports are record-level, not just the
    // current page or summary. These are isolated local test requests only.
    for(let i=0;i<31;i++)await root.execute("INSERT INTO withdrawal_requests (id,withdrawal_code,application_user_id,amount,status) VALUES (?,?,?,?,'PENDING')",[randomUUID(),`QA-EXPORT-${i}`,target,100000+i]);
    const query='period=custom&from=2020-01-01&to=2030-12-31';
    const detailXlsx=await get(master,`/api/reports/withdrawal-summary?kind=detail&format=xlsx&${query}`);
    assert.equal(detailXlsx.status,200);
    const detailBytes=await detailXlsx.arrayBuffer();
    if(process.env.NAZRAA_QA_EXPORT_FIXTURE==='1'){
      await mkdir('docs/qa/20261012',{recursive:true});
      await writeFile('docs/qa/20261012/withdrawal-detail-fixture.xlsx',new Uint8Array(detailBytes));
    }
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(detailBytes);
    assert.equal(workbook.getWorksheet('Withdrawal Details')?.rowCount,32,'all 31 actual records plus header');
    assert.equal(new Set(workbook.getWorksheet('Withdrawal Details')!.getColumn(1).values.slice(2)).size,31,'no duplicate rows');
    const csv=await get(master,`/api/reports/withdrawal-summary?kind=detail&format=csv&${query}`);
    assert.equal(csv.status,200);assert.equal((await csv.text()).split('\r\n').length,32);
    assert.equal((await get(master,`/api/reports/withdrawal-summary?kind=country&format=xlsx&${query}`)).status,200);
    assert.equal((await get(master,'/api/reports/withdrawal-summary?kind=detail&format=csv&period=custom&from=2026-02-31&to=2026-03-01')).status,400);
    for(let offset=0;offset<10005;offset+=500){
      const count=Math.min(500,10005-offset);
      await root.query(`INSERT INTO ledger_transactions(id,transaction_code,asset_type,transaction_type,source_type,destination_type,destination_id,amount,actor_account_id)
        VALUES ${Array.from({length:count},()=>"(?,?,'COIN','QA_RECORD','SYSTEM','APPLICATION_USER',?,1,?)").join(',')}`,
        Array.from({length:count},(_,index)=>[randomUUID(),`QA-STREAM-${offset+index}`,target,manager.account.id]).flat());
    }
    for(const role of ['MASTER','ADMIN','SUPER_ADMIN'] as const){
      const ledgerCsv=await get(scopes.get(role)!,'/api/reports/transactions');
      assert.equal(ledgerCsv.status,200);
      const lines=(await ledgerCsv.text()).split('\r\n').filter(Boolean);
      assert.equal(lines.length,10006,`${role} exports all 10,005 records beyond the old 10,000 cap`);
      assert.equal(new Set(lines.slice(1).map(line=>line.split(',')[0])).size,10005,'keyset pagination no duplicates');
    }
    assert.equal((await get(cs,'/api/reports/transactions')).status,403);
    console.log('PASS complete ledger streaming: Master/Admin/Super Admin 10,005 actual isolated records each, no truncation/duplicates; CS denied.');
    console.log('PASS owner direct HTTP: role-scoped game/Live read, removed Monitor/Verification, Master-only withdrawal exports, CS export boundary, complete 31-row XLSX/CSV and invalid IST date rejection.');
    console.log("PASS actual HTTP: anonymous 401; all 7 non-Master roles permanent-ban 403; Master ban/unban 200; CS 30m/2h 200; invalid duration 400; Admin suspension 403; repeat blocked; cross-origin 403.");
  } finally {
    if (server) { server.kill("SIGTERM"); await new Promise<void>(resolve => server!.once("exit", () => resolve())); }
    await global.nazraaPool?.end(); global.nazraaPool = undefined; global.nazraaInstrumentedPool = undefined;
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await root.query(`DROP USER IF EXISTS '${dbUser}'@'localhost'`); await root.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
