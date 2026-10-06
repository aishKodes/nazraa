import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { spawn } from "node:child_process";
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
    console.log("PASS actual HTTP: anonymous 401; all 7 non-Master roles permanent-ban 403; Master ban/unban 200; CS 30m/2h 200; invalid duration 400; Admin suspension 403; repeat blocked; cross-origin 403.");
  } finally {
    if (server) { server.kill("SIGTERM"); await new Promise<void>(resolve => server!.once("exit", () => resolve())); }
    await global.nazraaPool?.end(); global.nazraaPool = undefined; global.nazraaInstrumentedPool = undefined;
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await root.query(`DROP USER IF EXISTS '${dbUser}'@'localhost'`); await root.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
