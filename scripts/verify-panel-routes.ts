import assert from "node:assert/strict";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { SignJWT } from "jose";
import { can, type Permission } from "@/lib/auth/permissions";
import { roles, type Role } from "@/types/platform";

async function main() {
  const database = process.env.NAZRAA_QA_DATABASE ?? "";
  if (!/^nazraa_control_qa_\d+$/.test(database)) throw new Error("Use only a retained local integration-test database.");
  const base = "http://localhost:3100";
  const connection = await mysql.createConnection({ host: "127.0.0.1", user: "root", database });
  const routes: [string, Permission][] = [
    ["", "dashboard.read"], ["accounts", "accounts.read"], ["hierarchy", "hierarchy.read"],
    ["agencies", "agencies.read"], ["users", "users.read"], ["hosts", "hosts.read"],
    ["monitoring", "monitoring.read"], ["wallet", "wallet.read"], ["transactions", "transactions.read"],
    ["withdrawals", "withdrawals.read"], ["rooms", "rooms.read"], ["commerce", "coin_orders.read"],
    ["face-verification", "face_verification.read"], ["support", "support.read"], ["risk", "risk.read"],
    ["audit", "audit.read"], ["banners", "banners.read"], ["gifts", "gifts.read"],
    ["notifications", "notifications.read"], ["settings", "settings.manage"], ["reports", "reports.export"],
  ];
  let checked = 0;
  try {
    for (const role of roles) {
      const [rows] = await connection.query<(RowDataPacket & { id: string; public_id: number; full_name: string; role: Role })[]>("SELECT id, public_id, full_name, role FROM platform_accounts WHERE full_name = ?", [role === "MASTER" ? "QA Master" : `QA ${role}`]);
      assert.ok(rows[0]);
      const token = await new SignJWT({ id: rows[0].id, role, publicId: String(rows[0].public_id), fullName: rows[0].full_name }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(new TextEncoder().encode("nazraa-local-only-qa-session-secret-20260830"));
      const timings: number[] = [];
      for (const [route, permission] of routes) {
        const start = performance.now();
        const response = await fetch(`${base}/dashboard${route ? `/${route}` : ""}`, { headers: { cookie: `nazraa_control_session=${token}` }, redirect: "manual" });
        const html = await response.text();
        const denied = response.headers.get("location")?.includes("error=forbidden") || html.includes("/dashboard?error=forbidden");
        if (can(role, permission)) {
          assert.equal(response.status, 200, `${role} ${route} must load`);
          assert.ok(!denied, `${role} ${route} incorrectly denied`);
          assert.ok(!html.includes("Application error: a server-side exception"), `${role} ${route} server exception`);
          timings.push(Math.round(performance.now() - start));
        } else assert.ok(denied, `${role} ${route} must deny direct URL access`);
        checked++;
      }
      const [agencies] = await connection.query<RowDataPacket[]>("SELECT id, full_name FROM platform_accounts WHERE full_name IN ('QA AGENCY','QA Other Agency')");
      for (const agency of agencies) {
        const response = await fetch(`${base}/api/hierarchy/${agency.id}/hosts`, { headers: { cookie: `nazraa_control_session=${token}` } });
        const expected = !can(role, "hierarchy.read") ? 403 : agency.full_name === "QA Other Agency" && role !== "MASTER" ? 404 : role === "BD" ? 404 : 200;
        assert.equal(response.status, expected, `${role} lazy hierarchy branch access`);
        checked++;
      }
      // A token issued before suspension must stop working on the next request.
      // These writes are restricted above to the isolated, generated QA database.
      if (role !== "MASTER") {
        try {
          await connection.execute("UPDATE platform_accounts SET status = 'SUSPENDED' WHERE id = ?", [rows[0].id]);
          const suspended = await fetch(`${base}/dashboard`, { headers: { cookie: `nazraa_control_session=${token}` }, redirect: "manual" });
          const html = await suspended.text();
          assert.ok(suspended.headers.get("location")?.includes("/login") || html.includes('/login'), `${role}: existing session must be blocked during suspension`);
          checked++;
        } finally {
          await connection.execute("UPDATE platform_accounts SET status = 'ACTIVE' WHERE id = ?", [rows[0].id]);
        }
        const restored = await fetch(`${base}/dashboard`, { headers: { cookie: `nazraa_control_session=${token}` }, redirect: "manual" });
        assert.equal(restored.status, 200, `${role}: restored account must regain access`);
        assert.ok(!(await restored.text()).includes('Application error: a server-side exception'));
        checked++;
      }
      console.log(`${role}: ${routes.length} allowed/denied route checks passed; median ${timings.sort((a,b) => a-b)[Math.floor(timings.length / 2)]}ms (local development)`);
    }
    console.log(`PASS: ${checked} role-specific HTTP route checks.`);
  } finally { await connection.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
