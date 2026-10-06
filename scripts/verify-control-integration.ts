import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import mysql, { type RowDataPacket } from "mysql2/promise";
import sharp from "sharp";
import type { Role, Scope } from "@/types/platform";

// Standalone repository tests run outside Next's server-only module alias.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, context);
} });

async function main() {
  const database = `nazraa_control_qa_${Date.now()}`;
  const root = await mysql.createConnection({ host: "127.0.0.1", user: "root", multipleStatements: true });
  await root.query("SET time_zone = '+00:00'");
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  global.nazraaPool = mysql.createPool({ host: "127.0.0.1", user: "root", database, connectionLimit: 8, decimalNumbers: true, timezone: "Z" });
  global.nazraaInstrumentedPool = global.nazraaPool;
  const testConnections = await Promise.all(Array.from({ length: 8 }, () => global.nazraaPool!.getConnection()));
  await Promise.all(testConnections.map((connection) => connection.query("SET time_zone = '+00:00'")));
  for (const connection of testConnections) connection.release();
  let passed = 0;
  let keep = false;
  try {
    for (const file of (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
      await root.query(await readFile(`db/migrations/${file}`, "utf8"));
      console.log(`Migration OK: ${file}`);
    }
    const accounts = await import("@/lib/db/repositories/accounts");
    const admin = await import("@/lib/db/repositories/administration");
    const directory = await import("@/lib/db/repositories/directory");
    const ops = await import("@/lib/db/repositories/operations");
    const monitoring = await import("@/lib/db/repositories/monitoring");
    const agencies = await import("@/lib/db/repositories/agency-applications");
    const mobileAdministration = await import("@/lib/db/repositories/mobile-administration");
    const dashboard = await import("@/lib/db/repositories/dashboard");
    const ownerReports = await import("@/lib/db/repositories/owner-reports");
    const reportExports = await import("@/lib/reports/xlsx");
    const catalog = await import("@/lib/db/repositories/catalog");
    const mobileSession = await import("@/lib/auth/mobile-session");
    const liveAccess = await import("@/lib/services/live-access-policy");
    const password = "Local-QA-Only-2026!";
    await accounts.createInitialMaster({ publicId: 100001, fullName: "QA Master", password });
    const [seededHostRules] = await root.query<RowDataPacket[]>(
      "SELECT room_type, coins_per_hour FROM host_reward_rules WHERE enabled = TRUE ORDER BY room_type",
    );
    assert.deepEqual(
      Object.fromEntries(seededHostRules.map((rule) => [String(rule.room_type), Number(rule.coins_per_hour)])),
      { FACE: 3500, LIVE: 3500, PARTY: 0 },
      "freshly provisioned databases must never expose the obsolete 2,000/hour Host reward",
    );
    passed++;
    const masterAccount = await accounts.accountByManagementId("100001");
    assert.ok(masterAccount);
    const master = await accounts.scopeFor(masterAccount);
    // Exercise the deployment-only config alignment on an existing legacy
    // setting, not just an empty newly provisioned database. It must be
    // replay-safe and must never replace unrelated media/economy config.
    const capacityMigration = await readFile("db/migrations/0097_face_guest_capacity_config.sql", "utf8");
    const [beforeCapacityRows] = await root.query<RowDataPacket[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features'",
    );
    const originalFeatures = beforeCapacityRows[0]
      ? (typeof beforeCapacityRows[0].setting_value === "string"
        ? JSON.parse(beforeCapacityRows[0].setting_value)
        : beforeCapacityRows[0].setting_value)
      : {};
    const legacyFeatures = { ...originalFeatures, maxFaceAudioGuests: 4, qaPreserve: { provider: "LIVEKIT", enabled: true } };
    const [initialCapacityAudits] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM audit_logs WHERE action = 'settings.face_guest_capacity_align'",
    );
    await root.execute(
      "INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.room_features', ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [JSON.stringify(legacyFeatures), master.account.id],
    );
    await root.query(capacityMigration);
    await root.query(capacityMigration);
    const [alignedRows] = await root.query<RowDataPacket[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.room_features'",
    );
    const alignedFeatures = typeof alignedRows[0].setting_value === "string"
      ? JSON.parse(alignedRows[0].setting_value) : alignedRows[0].setting_value;
    assert.deepEqual(alignedFeatures, { ...legacyFeatures, maxFaceAudioGuests: 3 });
    const [capacityAudits] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM audit_logs WHERE action = 'settings.face_guest_capacity_align'",
    );
    assert.equal(Number(capacityAudits[0].total), Number(initialCapacityAudits[0].total) + 1, "capacity alignment must audit once, not on replay");
    await root.execute(
      "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'mobile.room_features'",
      [JSON.stringify({ ...originalFeatures, maxFaceAudioGuests: 2 })],
    );
    await root.query(capacityMigration);
    const [lowerCapacityRows] = await root.query<RowDataPacket[]>(
      "SELECT JSON_EXTRACT(setting_value, '$.maxFaceAudioGuests') capacity FROM system_settings WHERE setting_key = 'mobile.room_features'",
    );
    assert.equal(Number(lowerCapacityRows[0].capacity), 2, "preserve a configured lower capacity");
    await root.execute(
      "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'mobile.room_features'",
      [JSON.stringify({ ...originalFeatures, maxFaceAudioGuests: 3 })],
    );
    passed++;
    // Migration 0063 can only seed this setting when a Master already exists.
    // The isolated QA database creates its Master afterward, so seed an
    // always-open test schedule before exercising Live role enforcement.
    await root.execute(
      "INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.live_rules', JSON_OBJECT('timezone', 'Asia/Kolkata', 'startTime', '00:00', 'endTime', '23:59', 'agencyAuthorizationRequired', TRUE), ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)",
      [master.account.id],
    );
    const scopes = new Map<Role, Scope>([["MASTER", master]]);
    async function create(role: Role, parent: Scope, label: string = role, creator = master) {
      const result = await admin.createPlatformAccount({ scope: creator, role, fullName: `QA ${label}`, countryCode: "IN", requestedParentId: parent.account.id, password, documents: [] });
      const account = await accounts.accountByManagementId(String(result.publicId));
      assert.ok(account);
      return accounts.scopeFor(account);
    }
    const cm = await create("COUNTRY_MANAGER", master);
    const sa = await create("SUPER_ADMIN", cm);
    const branchAdmin = await create("ADMIN", sa);
    const bd = await create("BD", sa);
    const agency = await create("AGENCY", branchAdmin);
    const seller = await create("COIN_SELLER", branchAdmin);
    const cs = await create("MONITORING_CS", branchAdmin);
    for (const scope of [cm, sa, branchAdmin, bd, agency, seller, cs]) scopes.set(scope.account.role, scope);
    const cmOther = await create("COUNTRY_MANAGER", master, "Other Country Manager");
    const saOther = await create("SUPER_ADMIN", cmOther, "Other Super Admin");
    const adminOther = await create("ADMIN", saOther, "Other Admin");
    const agencyOther = await create("AGENCY", adminOther, "Other Agency");
    for (const [role, scope] of scopes) scopes.set(role, await accounts.scopeFor(scope.account));
    const refresh = (scope: Scope) => accounts.scopeFor(scope.account);
    async function user(agencyId: string | null, name: string) {
      const id = randomUUID();
      await root.execute("INSERT INTO application_users (id, external_user_id, full_name, agency_account_id, country_code, face_verification_status, onboarding_completed, is_host) VALUES (?, ?, ?, ?, 'IN', 'VERIFIED', TRUE, TRUE)", [id, id, name, agencyId]);
      const [rows] = await root.query<RowDataPacket[]>("SELECT public_id FROM application_users WHERE id = ?", [id]);
      await root.execute("INSERT INTO host_profiles (id, application_user_id, agency_account_id, status, verification_status) VALUES (?, ?, ?, 'ACTIVE', 'VERIFIED')", [randomUUID(), id, agencyId]);
      return { id, publicId: String(rows[0].public_id) };
    }
    const ownUser = await user(agency.account.id, "QA Own Host");
    const otherUser = await user(agencyOther.account.id, "QA Other Host");
    const ownAgencyReport = await ownerReports.agencyHostReport(await refresh(agency));
    assert.equal(ownAgencyReport.items.some((row) => row.hostId === ownUser.publicId), true, "Agency report includes its authorized Host");
    assert.equal(ownAgencyReport.items.some((row) => row.hostId === otherUser.publicId), false, "Agency report never includes a cross-Agency Host");
    assert.equal((await ownerReports.agencyHostReport(await refresh(agency), { q: otherUser.publicId })).total, 0, "edited Host ID filters cannot escape Agency scope");
    assert.equal((await ownerReports.agencyHostReport(master, {}, true)).total, 2, "Master Excel source returns the complete authorized filtered set");
    const ownHierarchyReport = await ownerReports.hierarchyReport(await refresh(agency));
    assert.equal(ownHierarchyReport.items.some((row) => row.id === agency.account.publicId), true);
    assert.equal(ownHierarchyReport.items.some((row) => row.id === agencyOther.account.publicId), false, "hierarchy report remains branch-scoped");
    assert.equal((await ownerReports.hierarchyReport(await refresh(agency), { q: agencyOther.account.publicId })).total, 0, "edited Agency IDs cannot escape hierarchy scope");
    for (const [applicationUserId, gameName, wager, payout, after] of [
      [ownUser.id, "luck77", 100, 180, 1080],
      [otherUser.id, "greedy_king", 100, 0, 900],
    ] as const) {
      await root.execute(
        `INSERT INTO game_round_results
          (id, client_round_id, application_user_id, game_name, bets_json, outcome_json, wager_total, payout_total, balance_after)
         VALUES (?, ?, ?, ?, JSON_OBJECT('qa', 100), JSON_OBJECT('qa', true), ?, ?, ?)`,
        [randomUUID(), randomUUID(), applicationUserId, gameName, wager, payout, after],
      );
    }
    const ownGameReport = await ownerReports.gameManagementReport(await refresh(agency), { q: ownUser.publicId, period: "24h" });
    assert.equal(ownGameReport.total, 1);
    assert.equal(ownGameReport.summary[0].totalGamesWon, 1);
    assert.equal(ownGameReport.items[0].walletBefore, 1000, "wallet before is reconstructed from the canonical result equation");
    assert.equal((await ownerReports.gameManagementReport(await refresh(agency), { q: otherUser.publicId, period: "24h" })).total, 0, "edited User IDs cannot escape Agency game-report scope");
    assert.equal((await ownerReports.gameManagementReport(master, { period: "24h" })).total, 2);
    const qaWorkbook = await reportExports.workbookBuffer("QA report", [{ name: "Rows", headers: ["ID", "Coins"], rows: [["QA-1", 25]] }]);
    assert.equal(String.fromCharCode(...qaWorkbook.slice(0, 2)), "PK", "server exporter produces a real XLSX ZIP workbook");
    for (const [role, scope] of scopes) {
      const rows = await directory.listUsersPage(scope);
      const shouldSeeOwn = !["BD", "COIN_SELLER"].includes(role);
      assert.equal(rows.items.some((row) => row.id === ownUser.id), shouldSeeOwn, `${role}: own branch`);
      assert.equal(rows.items.some((row) => row.id === otherUser.id), role === "MASTER", `${role}: cross branch`);
      await Promise.all([dashboard.getDashboardMetrics(scope), dashboard.getRevenueSeries(scope), ops.listRoomsPage(scope), ops.listAuditPage(scope), ops.listWithdrawalsPage(scope)]);
      passed++;
    }
    assert.equal((await directory.hierarchy(master)).some((node) => node.id === agencyOther.account.id), true);
    const superAdminHierarchy = await directory.hierarchy(await refresh(sa));
    for (const account of [sa, branchAdmin, bd, agency, seller, cs]) {
      assert.equal(superAdminHierarchy.some((node) => node.id === account.account.id), true, `Super Admin must see ${account.account.role} downline`);
    }
    assert.equal(superAdminHierarchy.some((node) => node.id === agencyOther.account.id), false, "Super Admin must not see another branch");
    assert.equal((await admin.getPlatformAccountDetail(await refresh(cm), agencyOther.account.id)), null);
    await assert.rejects(admin.createPlatformAccount({ scope: await refresh(cm), role: "ADMIN", fullName: "Escape branch", countryCode: "IN", requestedParentId: saOther.account.id, password, documents: [] }));
    passed++;

    for (const target of [cm, sa, branchAdmin, bd, agency, seller, cs]) {
      await admin.updateAccountStatus({ scope: master, accountId: target.account.id, expectedStatus: "ACTIVE", nextStatus: "SUSPENDED", reason: "QA suspend management account" });
      assert.equal((await accounts.accountByManagementId(target.account.publicId))?.status, "SUSPENDED");
      await assert.rejects(admin.updateAccountStatus({ scope: master, accountId: target.account.id, expectedStatus: "ACTIVE", nextStatus: "SUSPENDED", reason: "QA stale request must fail" }), /already changed/);
      await admin.updateAccountStatus({ scope: master, accountId: target.account.id, expectedStatus: "SUSPENDED", nextStatus: "ACTIVE", reason: "QA restore management account" });
      assert.equal((await accounts.accountByManagementId(target.account.publicId))?.status, "ACTIVE");
      const [history] = await root.query<RowDataPacket[]>("SELECT from_status, to_status FROM account_status_history WHERE account_id = ? ORDER BY created_at", [target.account.id]);
      assert.deepEqual(history.map((entry) => [entry.from_status, entry.to_status]), [["ACTIVE", "SUSPENDED"], ["SUSPENDED", "ACTIVE"]]);
      const [audit] = await root.query<RowDataPacket[]>("SELECT COUNT(*) total FROM audit_logs WHERE target_id = ? AND action = 'account.status_change'", [target.account.id]);
      assert.equal(audit[0].total, 2);
    }
    await assert.rejects(admin.updateAccountStatus({ scope: await refresh(cm), accountId: adminOther.account.id, nextStatus: "SUSPENDED", reason: "QA cannot suspend other branch" }));
    await assert.rejects(admin.updateAccountStatus({ scope: master, accountId: master.account.id, nextStatus: "SUSPENDED", reason: "QA cannot suspend Master" }));
    await assert.rejects(admin.updateAccountStatus({ scope: await refresh(cm), accountId: cm.account.id, nextStatus: "SUSPENDED", reason: "QA cannot suspend self" }));
    await assert.rejects(admin.updateAccountStatus({ scope: master, accountId: seller.account.id, nextStatus: "SUSPENDED", reason: "no" }));
    await admin.updateAccountStatus({ scope: await refresh(cm), accountId: branchAdmin.account.id, nextStatus: "SUSPENDED", reason: "QA CM manages own branch" });
    await admin.updateAccountStatus({ scope: await refresh(cm), accountId: branchAdmin.account.id, nextStatus: "ACTIVE", reason: "QA CM restores own branch" });
    passed++;

    const hostsRepository = await import("@/lib/db/repositories/hosts");
    const product = await import("@/lib/db/repositories/mobile-product");
    const liveCompletion = await import("@/lib/db/repositories/mobile-completion");
    const monthlyReset = await import("@/lib/db/repositories/monthly-host-reset");
    const [ownHostRows] = await root.query<RowDataPacket[]>("SELECT id FROM host_profiles WHERE application_user_id = ?", [ownUser.id]);
    await hostsRepository.updateHostGender({ scope: await refresh(branchAdmin), hostId: String(ownHostRows[0].id), gender: "FEMALE", reason: "QA authorized identity correction" });
    assert.equal((await hostsRepository.getHostDetail(await refresh(branchAdmin), String(ownHostRows[0].id)))?.gender, "FEMALE");
    await assert.rejects(hostsRepository.updateHostGender({ scope: await refresh(adminOther), hostId: String(ownHostRows[0].id), gender: "MALE", reason: "QA foreign branch correction denied" }));
    const [genderAudit] = await root.query<RowDataPacket[]>("SELECT previous_data, new_data FROM audit_logs WHERE target_id = ? AND action = 'host.gender_change'", [ownUser.id]);
    assert.equal(genderAudit.length, 1, "Host gender corrections must be auditable");
    passed++;
    const resetUser = await user(agency.account.id, "QA Monthly Reset Host");
    await root.execute(
      "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance, reserved_balance) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND', 350, 0)",
      [randomUUID(), resetUser.id],
    );
    const resetResult = await monthlyReset.runMonthlyHostEarningsReset(new Date("2026-09-01T06:00:00.000Z"));
    assert.equal(resetResult.status, "completed");
    assert.equal(resetResult.affectedUsers, 1);
    assert.equal(resetResult.expiredAmount, 350);
    const [resetWallet] = await root.query<RowDataPacket[]>(
      "SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [resetUser.id],
    );
    assert.equal(Number(resetWallet[0].available_balance), 0);
    const [resetLedger] = await root.query<RowDataPacket[]>(
      "SELECT transaction_code FROM ledger_transactions WHERE source_id = ? AND transaction_type = 'HOST_MONTHLY_RESET'",
      [resetUser.id],
    );
    assert.deepEqual(resetLedger.map((row) => String(row.transaction_code)), [`HMR-20260901-${resetUser.publicId}`]);
    const repeatedReset = await monthlyReset.runMonthlyHostEarningsReset(new Date("2026-09-01T12:00:00.000Z"));
    assert.equal(repeatedReset.status, "already_completed");
    assert.equal(repeatedReset.expiredAmount, 350);
    passed++;
    for (const kind of ["LIVE", "PARTY", "FACE"]) await root.execute("INSERT INTO host_reward_rules (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by) VALUES (?, ?, 0, 60, TRUE, '2020-01-01', ?)", [randomUUID(), kind, master.account.id]);
    const [hostRows] = await root.query<RowDataPacket[]>("SELECT id FROM host_profiles WHERE application_user_id = ?", [ownUser.id]);
    const hostId = String(hostRows[0].id);
    const identity = { userId: ownUser.id, publicId: ownUser.publicId, externalUserId: ownUser.id, fullName: "QA Own Host", role: "HOST" as const, accountStatus: "ACTIVE", faceVerificationStatus: "VERIFIED", agencyAccountId: agency.account.id, agencyFaceLiveAuthorized: true, superAdminFaceLiveAuthorized: true, hostAccessOverride: false, hostProfileStatus: "ACTIVE", liveRestricted: false, liveRestrictedUntil: null, liveRestrictionReason: null, temporaryLiveRestricted: false, temporaryLiveRestrictedUntil: null, temporaryLiveRestrictionReason: null, hostingSuspended: false, hostingSuspendedUntil: null, hostingSuspensionReason: null };
    const sharedGame = await product.gameSharedRoundState(identity, "luck77");
    assert.equal(sharedGame.game, "luck77");
    assert.equal(sharedGame.controls.enabled, true);
    assert.deepEqual(Object.keys(sharedGame.targetTotals), ["watermelon", "seven", "plum"]);
    const gameSocial = await product.gameSocialState("jungle_hunt");
    assert.equal(gameSocial.game, "jungle_hunt");
    assert.equal(gameSocial.controls?.enabled, true);
    const roomInput = (kind: string) => ({ roomCode: randomUUID(), kind, title: "QA suspension room", category: "chat", language: "en", privacy: "public" as const, seatCount: 8, themeIndex: 0, themeEnabled: true, countryCode: "IN" });
    const interruptedRoom = await product.createRoom(identity, roomInput("party"));
    await product.createRoom(identity, roomInput("face"));
    const ownLiveReport = await ownerReports.liveRewardReport(await refresh(agency), { q: ownUser.publicId, period: "24h" });
    assert.equal(ownLiveReport.total, 1, "Live report returns one canonical row per Live session");
    assert.equal(ownLiveReport.items[0].sessionId.length > 0, true);
    assert.equal(ownLiveReport.items[0].claimStatus, "NOT_REACHED");
    assert.equal((await ownerReports.liveRewardReport(await refresh(agency), { q: otherUser.publicId, period: "24h" })).total, 0, "edited Host IDs cannot escape Live report scope");
    const otherIdentity = { ...identity, userId: otherUser.id, publicId: otherUser.publicId, externalUserId: otherUser.id, fullName: "QA Other Host", agencyAccountId: agencyOther.account.id };
    await product.createRoom(otherIdentity, roomInput("face"));
    assert.equal((await ownerReports.liveRewardReport(master, { period: "24h" })).total, 2, "Master receives the full authorized Live scope");
    // Unverified hosts must remain moderatable; verification is independent.
    await root.execute("UPDATE host_profiles SET verification_status = 'UNVERIFIED' WHERE id = ?", [hostId]);
    await assert.rejects(hostsRepository.updateHostStatus({ scope: agencyOther, hostId, status: "SUSPENDED", reason: "QA reject foreign host suspension" }));
    await hostsRepository.updateHostStatus({ scope: agency, hostId, status: "SUSPENDED", reason: "QA stop hosting access" });
    const [stopped] = await root.query<RowDataPacket[]>("SELECT status, ended_at FROM live_rooms WHERE id = ?", [interruptedRoom.id]);
    assert.equal(stopped[0].status, "ENDED");
    assert.ok(stopped[0].ended_at);
    for (const kind of ["live", "party", "face"]) await assert.rejects(product.createRoom(identity, roomInput(kind)), /Hosting is suspended/);
    await hostsRepository.updateHostStatus({ scope: agency, hostId, status: "ACTIVE", reason: "QA restore host access" });
    for (const kind of ["live", "party", "face"]) assert.equal((await product.createRoom(identity, roomInput(kind))).status, "ACTIVE");
    await hostsRepository.updateHostStatus({ scope: agency, hostId, status: "INACTIVE", reason: "QA pause host access" });
    await assert.rejects(product.createRoom(identity, roomInput("party")), /Hosting is suspended/);
    await hostsRepository.updateHostStatus({ scope: agency, hostId, status: "ACTIVE", reason: "QA restore paused host" });
    // Finalization after suspension cannot invent media time or rewards when
    // no publishing heartbeat was ever received.
    await root.execute("UPDATE live_session_accounting SET started_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE room_id = ?", [interruptedRoom.id]);
    await root.execute("UPDATE live_rooms SET ended_at = DATE_ADD((SELECT started_at FROM live_session_accounting WHERE room_id = ?), INTERVAL 60 SECOND) WHERE id = ?", [interruptedRoom.id, interruptedRoom.id]);
    assert.equal((await liveCompletion.finalizeLiveSession(identity, interruptedRoom.roomCode)).validSeconds, 0);
    await root.execute("UPDATE host_profiles SET verification_status = 'VERIFIED' WHERE id = ?", [hostId]);
    passed++;

    const promotion = await create("ADMIN", sa, "Promotion target");
    const childAgency = await create("AGENCY", promotion, "Promotion child");
    await admin.changePlatformAccountRole({ scope: await refresh(cm), accountId: promotion.account.id, role: "SUPER_ADMIN", parentAccountId: cm.account.id, childParentId: branchAdmin.account.id, reason: "QA promote Admin to Super Admin" });
    assert.equal((await accounts.accountById(promotion.account.id))?.role, "SUPER_ADMIN");
    assert.equal((await accounts.accountById(childAgency.account.id))?.parentAccountId, branchAdmin.account.id);
    await assert.rejects(admin.changePlatformAccountRole({ scope: await refresh(cm), accountId: adminOther.account.id, role: "SUPER_ADMIN", parentAccountId: cm.account.id, reason: "QA must reject other branch" }));
    await assert.rejects(admin.changePlatformAccountRole({ scope: await refresh(cm), accountId: promotion.account.id, role: "COUNTRY_MANAGER", parentAccountId: master.account.id, reason: "QA cannot grant peer power" }));
    await assert.rejects(admin.changePlatformAccountRole({ scope: master, accountId: promotion.account.id, role: "ADMIN", parentAccountId: promotion.account.id, reason: "QA reject self parent" }));
    await admin.reassignPlatformAccount({ scope: master, accountId: childAgency.account.id, parentAccountId: bd.account.id, reason: "QA agency hierarchy reassignment" });
    assert.equal((await accounts.accountById(childAgency.account.id))?.parentAccountId, bd.account.id);
    passed++;

    // Legacy Admin accounts can contain BDs. Keep their Agencies in that same
    // branch when promoting, rather than rejecting every descendant parent.
    const retainedTarget = await create("ADMIN", sa, "Retained branch promotion");
    const retainedBd = await create("BD", sa, "Retained BD");
    const retainedAgency = await create("AGENCY", retainedTarget, "Retained Agency");
    await root.execute("UPDATE platform_accounts SET parent_account_id = ? WHERE id = ?", [retainedTarget.account.id, retainedBd.account.id]);
    const { roleChangeOptions } = await import("@/lib/auth/role-change-options");
    const options = roleChangeOptions({ id: retainedTarget.account.id, parentId: sa.account.id, country: "IN" }, "SUPER_ADMIN", await admin.listParentOptions(master), await admin.listRoleChangeDescendants(master, retainedTarget.account.id));
    assert.equal(options.suggestedParentId, cm.account.id);
    assert.ok(options.childParents.AGENCY?.some((entry) => entry.id === retainedBd.account.id));
    assert.ok(!options.validParents.some((entry) => entry.id === retainedBd.account.id));
    await admin.changePlatformAccountRole({ scope: await refresh(cm), accountId: retainedTarget.account.id, role: "SUPER_ADMIN", expectedRole: "ADMIN", parentAccountId: cm.account.id, childParentIds: { AGENCY: retainedBd.account.id }, reason: "QA preserve retained BD branch" });
    assert.equal((await accounts.accountById(retainedAgency.account.id))?.parentAccountId, retainedBd.account.id);
    assert.equal((await accounts.accountById(retainedBd.account.id))?.parentAccountId, retainedTarget.account.id);
    passed++;

    // Reproduce older direct-under-Master accounts without a Country Manager.
    // The explicitly requested supporting accounts and promotion are atomic.
    const legacy = await create("ADMIN", sa, "Legacy promotion");
    const legacyAgency = await create("AGENCY", legacy, "Legacy Agency");
    const legacyHost = await user(legacyAgency.account.id, "QA Legacy host");
    await root.execute("UPDATE platform_accounts SET parent_account_id = ? WHERE id = ?", [master.account.id, legacy.account.id]);
    const before = await accounts.accountByManagementId(legacy.account.publicId);
    const form = new FormData();
    for (const [key, value] of Object.entries({ accountId: legacy.account.id, expectedRole: "ADMIN", role: "SUPER_ADMIN", parentAccountId: "NEW_COUNTRY_MANAGER", childParent_AGENCY: "NEW_ADMIN", newCountryManagerName: "QA Inline Country Manager", newCountryManagerPassword: password, newCountryManagerCountry: "IN", newAdminName: "QA Inline Admin", newAdminPassword: password, reason: "QA promote legacy Admin", confirmed: "yes" })) form.set(key, value);
    const { parseRoleChange } = await import("@/lib/auth/role-change-validation");
    const parsed = parseRoleChange(form);
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    const promotionResult = await admin.changePlatformAccountRole({ scope: master, ...parsed.data });
    assert.equal(promotionResult.created.length, 2);
    const newCm = await accounts.accountByManagementId(String(promotionResult.created.find((entry) => entry.role === "COUNTRY_MANAGER")!.publicId));
    const newAdmin = await accounts.accountByManagementId(String(promotionResult.created.find((entry) => entry.role === "ADMIN")!.publicId));
    assert.ok(newCm && newAdmin);
    const after = await accounts.accountByManagementId(legacy.account.publicId);
    assert.equal(after?.role, "SUPER_ADMIN");
    assert.equal(after?.parentAccountId, newCm.id);
    assert.equal(after?.passwordHash, before?.passwordHash);
    assert.equal(after?.publicId, before?.publicId);
    assert.equal(newCm.parentAccountId, master.account.id);
    assert.equal(newAdmin.parentAccountId, legacy.account.id);
    assert.equal((await accounts.accountById(legacyAgency.account.id))?.parentAccountId, newAdmin.id);
    assert.ok((await directory.listUsersPage(await accounts.scopeFor(newCm))).items.some((entry) => entry.id === legacyHost.id));
    await assert.rejects(admin.changePlatformAccountRole({ scope: master, ...parsed.data }), /already changed/);
    await assert.rejects(admin.changePlatformAccountRole({ scope: await refresh(cm), ...parsed.data }), /Only Master/);
    form.delete("confirmed");
    assert.equal(parseRoleChange(form).success, false);
    passed++;

    const rollback = await create("ADMIN", sa, "Rollback promotion");
    await create("AGENCY", rollback, "Rollback Agency");
    const [countBefore] = await root.query<RowDataPacket[]>("SELECT COUNT(*) total FROM platform_accounts");
    const [auditBefore] = await root.query<RowDataPacket[]>("SELECT COUNT(*) total FROM audit_logs");
    await assert.rejects(admin.changePlatformAccountRole({ scope: master, accountId: rollback.account.id, role: "SUPER_ADMIN", parentAccountId: "NEW_COUNTRY_MANAGER", newCountryManager: { fullName: "QA Must roll back", password, countryCode: "IN" }, childParentIds: { AGENCY: cm.account.id }, reason: "QA rollback all partial changes" }), /compatible parent/);
    const [countAfter] = await root.query<RowDataPacket[]>("SELECT COUNT(*) total FROM platform_accounts");
    const [auditAfter] = await root.query<RowDataPacket[]>("SELECT COUNT(*) total FROM audit_logs");
    assert.equal(countAfter[0].total, countBefore[0].total);
    assert.equal(auditAfter[0].total, auditBefore[0].total);
    assert.equal((await accounts.accountById(rollback.account.id))?.role, "ADMIN");
    await assert.rejects(admin.changePlatformAccountRole({ scope: await refresh(cm), accountId: rollback.account.id, role: "SUPER_ADMIN", parentAccountId: cm.account.id, childParentIds: { AGENCY: adminOther.account.id }, reason: "QA reject cross branch child move" }));
    passed++;

    // Independent destinations resolve mixed legacy children; no single parent
    // could previously accept both Super Admin and Agency children.
    const mixed = await create("ADMIN", sa, "Mixed legacy target");
    const mixedAgency = await create("AGENCY", mixed, "Mixed Agency");
    const mixedSa = await create("SUPER_ADMIN", cm, "Mixed legacy Super Admin");
    await root.execute("UPDATE platform_accounts SET parent_account_id = ? WHERE id = ?", [mixed.account.id, mixedSa.account.id]);
    await admin.changePlatformAccountRole({ scope: master, accountId: mixed.account.id, role: "COIN_SELLER", parentAccountId: cm.account.id, childParentIds: { SUPER_ADMIN: cm.account.id, AGENCY: branchAdmin.account.id }, reason: "QA independent downstream assignments" });
    assert.equal((await accounts.accountById(mixedSa.account.id))?.parentAccountId, cm.account.id);
    assert.equal((await accounts.accountById(mixedAgency.account.id))?.parentAccountId, branchAdmin.account.id);
    passed++;

    const { countryName, isPanelCountry, panelCountries } = await import("@/lib/countries");
    assert.equal(panelCountries[0].code, "IN");
    assert.equal(countryName("NP"), "Nepal");
    assert.equal(countryName("IN"), "India");
    assert.equal(isPanelCountry("ZZ"), false);
    await assert.rejects(admin.createPlatformAccount({ scope: master, role: "COUNTRY_MANAGER", fullName: "QA Bad country", countryCode: "ZZ", password, documents: [] }), /country/);
    passed++;

    const applicant = await user(null, "QA Agency applicant");
    const creationId = randomUUID();
    await root.execute("INSERT INTO agency_creation_applications (id, application_user_id, agency_name, country_code, business_whatsapp_e164, parent_account_id) VALUES (?, ?, 'QA Approved Agency', 'IN', '+919999000001', ?)", [creationId, applicant.id, branchAdmin.account.id]);
    await assert.rejects(agencies.reviewAgencyCreation({ scope: await refresh(cmOther), applicationId: creationId, decision: "APPROVED", reason: "QA cannot approve other branch" }));
    await assert.rejects(agencies.reviewAgencyCreation({ scope: await refresh(cm), applicationId: creationId, decision: "APPROVED", reason: "QA non-Master cannot approve Agency" }), /Only Master/);
    await agencies.reviewAgencyCreation({ scope: master, applicationId: creationId, decision: "APPROVED", reason: "QA Master approves verified Agency" });
    const [creation] = await root.query<RowDataPacket[]>("SELECT status, approved_agency_account_id FROM agency_creation_applications WHERE id = ?", [creationId]);
    assert.equal(creation[0].status, "APPROVED");
    const joiner = await user(null, "QA Join applicant");
    const joinId = randomUUID();
    await root.execute("INSERT INTO agency_membership_applications (id, application_user_id, agency_account_id) VALUES (?, ?, ?)", [joinId, joiner.id, agency.account.id]);
    await assert.rejects(agencies.reviewAgencyJoin({ scope: agencyOther, applicationId: joinId, decision: "APPROVED", reason: "QA reject foreign Agency" }));
    await agencies.reviewAgencyJoin({ scope: agency, applicationId: joinId, decision: "APPROVED", reason: "QA accept own host application" });
    assert.equal(liveAccess.LiveAccessPolicyService.for({ ...identity, agencyFaceLiveAuthorized: false, superAdminFaceLiveAuthorized: false }).face.allowed, true, "Legacy secondary authorization flags must not require repeated verification");
    const olderFaceRequest = randomUUID();
    const currentFaceRequest = randomUUID();
    await root.execute("UPDATE application_users SET face_verification_status = 'PENDING' WHERE id = ?", [ownUser.id]);
    await root.execute("INSERT INTO face_verification_requests (id, application_user_id, status, created_at) VALUES (?, ?, 'RETRY', DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE)), (?, ?, 'PENDING', CURRENT_TIMESTAMP(3))", [olderFaceRequest, ownUser.id, currentFaceRequest, ownUser.id]);
    await mobileAdministration.reviewFaceVerification({ scope: await refresh(cm), requestId: currentFaceRequest, decision: "VERIFIED", reason: "QA approve current selfie" });
    await mobileAdministration.reviewFaceVerification({ scope: await refresh(cm), requestId: currentFaceRequest, decision: "VERIFIED", reason: "QA idempotent approval retry" });
    const [faceRows] = await root.query<RowDataPacket[]>("SELECT status FROM face_verification_requests WHERE id IN (?, ?) ORDER BY created_at", [olderFaceRequest, currentFaceRequest]);
    assert.deepEqual(faceRows.map((entry) => entry.status), ["VERIFIED", "VERIFIED"]);
    const visibleFaceRows = await mobileAdministration.listFaceVerificationRequests(await refresh(cm), 1, "verified");
    assert.equal(visibleFaceRows.filter((entry) => entry.userPublicId === ownUser.publicId).length, 1, "Panel shows only the current Face Verification row per user");
    assert.equal(visibleFaceRows.find((entry) => entry.userPublicId === ownUser.publicId)?.status, "VERIFIED");
    assert.equal((await mobileAdministration.listFaceVerificationRequests(await refresh(cm))).some((entry) => entry.userPublicId === ownUser.publicId), false, "Verified users are separated from the review queue");
    const [verifiedFaceRows] = await root.query<RowDataPacket[]>("SELECT user.face_verification_status, user.agency_face_live_authorized, user.super_admin_face_live_authorized, host.verification_status FROM application_users user INNER JOIN host_profiles host ON host.application_user_id = user.id WHERE user.id = ?", [ownUser.id]);
    assert.deepEqual([verifiedFaceRows[0].face_verification_status, Number(verifiedFaceRows[0].agency_face_live_authorized), Number(verifiedFaceRows[0].super_admin_face_live_authorized), verifiedFaceRows[0].verification_status], ["VERIFIED", 1, 1, "VERIFIED"], "One review synchronizes every legacy verification field");
    await assert.rejects(mobileAdministration.reviewFaceVerification({ scope: agency, requestId: currentFaceRequest, decision: "REJECTED", reason: "QA Agency cannot override verification" }), /cannot review/);
    await mobileAdministration.reviewFaceVerification({ scope: master, requestId: currentFaceRequest, decision: "REJECTED", reason: "QA Master rejects incorrect selfie" });
    const [rejectedFaceRows] = await root.query<RowDataPacket[]>("SELECT face_verification_status, agency_face_live_authorized, super_admin_face_live_authorized FROM application_users WHERE id = ?", [ownUser.id]);
    assert.equal(rejectedFaceRows[0].face_verification_status, "REJECTED");
    assert.equal(Number(rejectedFaceRows[0].agency_face_live_authorized), 0);
    assert.equal(Number(rejectedFaceRows[0].super_admin_face_live_authorized), 0);
    const [rejectedHostRows] = await root.query<RowDataPacket[]>("SELECT verification_status FROM host_profiles WHERE application_user_id = ?", [ownUser.id]);
    assert.equal(rejectedHostRows[0].verification_status, "REJECTED");
    assert.equal((await mobileAdministration.listFaceVerificationRequests(master)).find((entry) => entry.userPublicId === ownUser.publicId)?.status, "REJECTED");
    await mobileAdministration.reviewFaceVerification({ scope: master, requestId: currentFaceRequest, decision: "VERIFIED", reason: "QA Master restores corrected selfie" });
    passed++;

    const restrictionToken = randomUUID();
    await root.execute(
      "INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, expires_at) VALUES (?, ?, ?, 'QA restriction policy', DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [randomUUID(), ownUser.id, createHash("sha256").update(restrictionToken).digest("hex")],
    );
    const restrictionRequest = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${restrictionToken}` } });
    assert.equal((await mobileSession.authenticateMobileRequest(restrictionRequest))?.liveRestricted, false);
    const partyBeforeLiveBlock = await product.createRoom(identity, roomInput("party"));
    const faceBeforeLiveBlock = await product.createRoom(identity, roomInput("face"));
    const temp = await ops.createTemporaryLiveRestriction({ scope: master, applicationUserId: ownUser.id, durationMinutes: 1440, reason: "QA exact 24-hour Live restriction" });
    const [restrictionWindow] = await root.query<RowDataPacket[]>("SELECT TIMESTAMPDIFF(SECOND, starts_at, ends_at) duration_seconds FROM moderation_restrictions WHERE id = ?", [temp.restrictionId]);
    assert.equal(Number(restrictionWindow[0].duration_seconds), 86_400, "24-hour Live restriction must have an exact server-authored expiry");
    const [roomsAfterLiveBlock] = await root.query<RowDataPacket[]>("SELECT room_type, COUNT(*) active_count FROM live_rooms WHERE host_application_user_id = ? AND status IN ('ACTIVE','LOCKED') GROUP BY room_type", [ownUser.id]);
    assert.equal(Number(roomsAfterLiveBlock.find((row) => row.room_type === "FACE")?.active_count ?? 0), 0, "applying a Live block ends existing Face/Video Live rooms");
    assert.ok(Number(roomsAfterLiveBlock.find((row) => row.room_type === "PARTY")?.active_count ?? 0) > 0, "a Face/Video Live block must not end an independent Party room");
    const [specificRoomStates] = await root.query<RowDataPacket[]>("SELECT id, status FROM live_rooms WHERE id IN (?, ?)", [partyBeforeLiveBlock.id, faceBeforeLiveBlock.id]);
    assert.equal(specificRoomStates.find((row) => row.id === partyBeforeLiveBlock.id)?.status, "ACTIVE");
    assert.equal(specificRoomStates.find((row) => row.id === faceBeforeLiveBlock.id)?.status, "ENDED");
    const restrictedIdentity = await mobileSession.authenticateMobileRequest(restrictionRequest);
    assert.ok(restrictedIdentity);
    assert.equal(restrictedIdentity.liveRestricted, true);
    assert.equal(restrictedIdentity.temporaryLiveRestricted, true);
    assert.equal(restrictedIdentity.hostingSuspended, false);
    const restrictedPolicy = liveAccess.LiveAccessPolicyService.for(restrictedIdentity);
    assert.equal(restrictedPolicy.party.allowed, true, "a Face/Video Live block must not become a conflicting Party account suspension");
    assert.equal(restrictedPolicy.video.allowed, false);
    assert.equal(restrictedPolicy.face.allowed, false);
    assert.equal(restrictedPolicy.join.allowed, true);
    assert.ok((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId);
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), "Other Host")).some((entry) => entry.id === otherUser.id), true, "CS can find every Nazraa user without hierarchy clutter");
    await assert.rejects(ops.createTemporaryLiveRestriction({ scope: await refresh(cs), applicationUserId: otherUser.id, durationMinutes: 30, reason: "QA CS cannot use generic Live restriction" }), /dedicated 30-minute or 2-hour/);
    const crossBranchRestriction = await ops.createTemporaryLiveRestriction({ scope: master, applicationUserId: otherUser.id, durationMinutes: 30, reason: "QA Master cross-branch restriction" });
    await ops.restoreLiveAccess({ scope: master, restrictionId: crossBranchRestriction.restrictionId, reason: "QA Master restores test restriction" });
    await root.execute("UPDATE moderation_restrictions SET ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?", [temp.restrictionId]);
    assert.equal((await mobileSession.authenticateMobileRequest(restrictionRequest))?.liveRestricted, false);
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId, null);
    assert.equal((await monitoring.listModerationHistory(await refresh(cs), [ownUser.id]))[0].status, "EXPIRED");
    const restored = await ops.createTemporaryLiveRestriction({ scope: master, applicationUserId: ownUser.id, durationMinutes: 60, reason: "QA temporary Live restriction to restore" });
    await ops.restoreLiveAccess({ scope: master, restrictionId: restored.restrictionId, reason: "QA Master restores temporary restriction" });
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId, null);
    assert.equal((await monitoring.listModerationHistory(await refresh(cs), [ownUser.id]))[0].status, "REVOKED");
    assert.equal((await ops.listAuditPage(master)).items.some((entry) => entry.action === "moderation.live_access_restored" && entry.actorRole === "MASTER"), true, "Master audit sees scoped restoration");

    const faceRoomForSuspension = await product.createRoom(identity, roomInput("face"));
    const [faceAccounting] = await root.query<RowDataPacket[]>("SELECT id FROM live_session_accounting WHERE room_id = ?", [faceRoomForSuspension.id]);
    const [faceRule] = await root.query<RowDataPacket[]>("SELECT id FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE ORDER BY effective_from DESC LIMIT 1");
    await root.execute("UPDATE host_reward_rules SET coins_per_hour = 3500, minimum_eligible_seconds = 3600 WHERE id = ?", [faceRule[0].id]);
    await root.execute("UPDATE live_session_accounting SET eligible_duration_seconds = 3600, eligible_seconds_committed = 3600, valid_media_seconds = 3600, reward_rule_id = ? WHERE id = ?", [faceRule[0].id, faceAccounting[0].id]);
    const [diamondBeforeModeration] = await root.query<RowDataPacket[]>("SELECT COALESCE(SUM(available_balance), 0) amount FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND'", [ownUser.id]);
    const faceSuspension30 = await ops.createFaceLiveSuspension({ scope: await refresh(cs), applicationUserId: ownUser.id, durationMinutes: 30, reason: "QA 30-minute Face-only suspension" });
    assert.equal(faceSuspension30.activeRoomCode, faceRoomForSuspension.roomCode, "suspending a live Host closes its current Face room");
    const moderationFinalization = await liveCompletion.finalizeLiveSession(identity, faceRoomForSuspension.roomCode);
    assert.equal(moderationFinalization.eligibleSeconds, 3600, "one already-qualified reward hour is retained when moderation ends Live");
    assert.equal(moderationFinalization.rewardCoins, 3500, "the existing completed-hour reward is settled through the normal claimable reward flow");
    const [diamondAfterModeration] = await root.query<RowDataPacket[]>("SELECT COALESCE(SUM(available_balance), 0) amount FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND'", [ownUser.id]);
    assert.equal(Number(diamondAfterModeration[0].amount), Number(diamondBeforeModeration[0].amount), "Face suspension does not directly alter the Host's Diamond wallet");
    const [face30Window] = await root.query<RowDataPacket[]>("SELECT restriction_type, TIMESTAMPDIFF(SECOND, starts_at, ends_at) duration_seconds FROM moderation_restrictions WHERE id = ?", [faceSuspension30.restrictionId]);
    assert.deepEqual([face30Window[0].restriction_type, Number(face30Window[0].duration_seconds)], ["FACE_LIVE", 1800]);
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionType, "FACE_LIVE");
    assert.equal((await mobileSession.authenticateMobileRequest(restrictionRequest))?.liveRestricted, false, "Face-only suspension never disables account session access");
    await assert.rejects(product.createRoom(identity, roomInput("face")), (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "FACE_LIVE_TEMPORARILY_SUSPENDED");
    const partyDuringFaceSuspension = await product.createRoom(identity, roomInput("party"));
    assert.equal(partyDuringFaceSuspension.status, "ACTIVE", "Face-only suspension does not block Party");
    await assert.rejects(ops.restoreLiveAccess({ scope: await refresh(cs), restrictionId: faceSuspension30.restrictionId, reason: "QA CS cannot early restore Face Live" }), /Only Master/);
    await ops.restoreLiveAccess({ scope: master, restrictionId: faceSuspension30.restrictionId, reason: "QA Master early restore" });
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId, null);

    const faceSuspension120 = await ops.createFaceLiveSuspension({ scope: await refresh(cs), applicationUserId: ownUser.id, durationMinutes: 120, reason: "QA 2-hour Face-only suspension" });
    const [face120Window] = await root.query<RowDataPacket[]>("SELECT restriction_type, TIMESTAMPDIFF(SECOND, starts_at, ends_at) duration_seconds FROM moderation_restrictions WHERE id = ?", [faceSuspension120.restrictionId]);
    assert.deepEqual([face120Window[0].restriction_type, Number(face120Window[0].duration_seconds)], ["FACE_LIVE", 7200]);
    await root.execute("UPDATE moderation_restrictions SET ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?", [faceSuspension120.restrictionId]);
    await assert.rejects(ops.createFaceLiveSuspension({ scope: await refresh(cs), applicationUserId: ownUser.id, durationMinutes: 60 as unknown as 30 | 120, reason: "QA invalid duration" }));
    await assert.rejects(ops.createFaceLiveSuspension({ scope: await refresh(cm), applicationUserId: ownUser.id, durationMinutes: 30, reason: "QA non-CS role denied" }));
    assert.equal((await product.createRoom(identity, roomInput("face"))).status, "ACTIVE", "an expired Face-only restriction needs no manual unban or cron");
    passed++;

    const token = randomUUID();
    const matchingDeviceToken = randomUUID();
    const unrelatedUserToken = randomUUID();
    const sessionId = randomUUID();
    const matchingSessionId = randomUUID();
    const unrelatedSessionId = randomUUID();
    const sharedDeviceId = "android:1234567890abcdef";
    const sharedDeviceHash = createHash("sha256").update(`nazraa-device:${sharedDeviceId}`).digest("hex");
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at) VALUES (?, ?, ?, 'QA device', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [sessionId, ownUser.id, createHash("sha256").update(token).digest("hex"), sharedDeviceHash]);
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at) VALUES (?, ?, ?, 'QA same device', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [matchingSessionId, ownUser.id, createHash("sha256").update(matchingDeviceToken).digest("hex"), sharedDeviceHash]);
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at) VALUES (?, ?, ?, 'QA unrelated account device', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [unrelatedSessionId, otherUser.id, createHash("sha256").update(unrelatedUserToken).digest("hex"), sharedDeviceHash]);
    const request = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${token}` } });
    const matchingDeviceRequest = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${matchingDeviceToken}` } });
    const unrelatedUserRequest = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${unrelatedUserToken}` } });
    assert.ok(await mobileSession.authenticateMobileRequest(request));
    await assert.rejects(monitoring.blockUserDevice({ scope: await refresh(cs), sessionId, reason: "QA CS cannot block devices" }), /Only Master or the assigned Country Manager/);
    await assert.rejects(monitoring.blockUserDevice({ scope: await refresh(cmOther), sessionId, reason: "QA foreign device denied" }));
    await monitoring.blockUserDevice({ scope: await refresh(cm), sessionId, reason: "QA own device blocked" });
    await assert.rejects(mobileSession.authenticateMobileRequest(request), (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "DEVICE_BLOCKED");
    await assert.rejects(mobileSession.authenticateMobileRequest(matchingDeviceRequest), (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "DEVICE_BLOCKED");
    assert.ok(await mobileSession.authenticateMobileRequest(unrelatedUserRequest), "the same device hash on an unrelated user must remain allowed");
    const devices = await monitoring.listUserDevices(await refresh(cm), ownUser.id);
    assert.ok(devices[0].blockId);
    assert.ok(devices[0].blockedAt);
    assert.ok(devices[0].blockedByName);
    const activeBlockId = devices[0].blockId;
    const [activeBlockRows] = await root.query<RowDataPacket[]>("SELECT reason, blocked_by, blocked_at, status FROM mobile_device_blocks WHERE id = ?", [activeBlockId]);
    assert.deepEqual([activeBlockRows[0].reason, activeBlockRows[0].blocked_by, activeBlockRows[0].status], ["QA own device blocked", cm.account.id, "ACTIVE"]);
    assert.ok(activeBlockRows[0].blocked_at);
    await monitoring.unblockUserDevice({ scope: await refresh(cm), blockId: activeBlockId, reason: "QA own device restored" });
    assert.ok(await mobileSession.authenticateMobileRequest(request), "Unblocking a device restores its still-valid session");
    assert.ok(await mobileSession.authenticateMobileRequest(matchingDeviceRequest), "Unblocking restores every session revoked by that exact device block");
    const [revokedBlockRows] = await root.query<RowDataPacket[]>("SELECT status, revoked_by, revoked_at FROM mobile_device_blocks WHERE id = ?", [activeBlockId]);
    assert.deepEqual([revokedBlockRows[0].status, revokedBlockRows[0].revoked_by], ["REVOKED", cm.account.id]);
    assert.ok(revokedBlockRows[0].revoked_at);
    const [deviceAuditRows] = await root.query<RowDataPacket[]>("SELECT action, actor_account_id, reason FROM audit_logs WHERE target_id = ? ORDER BY created_at", [activeBlockId]);
    assert.deepEqual(deviceAuditRows.map((row) => row.action), ["device.block", "device.unblock"]);
    assert.ok(deviceAuditRows.every((row) => row.actor_account_id === cm.account.id && String(row.reason).startsWith("QA own device")));
    await assert.rejects(monitoring.blockUserDevice({ scope: await refresh(cs), sessionId, reason: "QA CS still cannot block" }), /Only Master or the assigned Country Manager/);
    passed++;

    await assert.rejects(
      monitoring.banDeviceAcrossAccounts({ scope: await refresh(cm), sessionId, reason: "QA country manager cannot ban all accounts" }),
      /Only Master/,
    );
    await assert.rejects(
      monitoring.banDeviceAcrossAccounts({ scope: await refresh(cs), sessionId, reason: "QA CS cannot ban all accounts" }),
      /Only Master/,
    );
    const globalBan = await monitoring.banDeviceAcrossAccounts({ scope: master, sessionId, reason: "QA Master protects all accounts on device" });
    assert.equal(globalBan.alreadyBanned, false);
    assert.equal(globalBan.revokedSessions, 3, "all accounts using the same device identifier are revoked");
    for (const affectedRequest of [request, matchingDeviceRequest, unrelatedUserRequest]) {
      await assert.rejects(mobileSession.authenticateMobileRequest(affectedRequest),
        (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "DEVICE_BLOCKED");
    }
    const globalDevices = await monitoring.listUserDevices(master, ownUser.id);
    assert.ok(globalDevices[0].globalBlockId);
    assert.equal(globalDevices[0].globalBlocked, true);
    assert.equal(globalDevices[0].matchingAccounts, 2);
    assert.equal((await monitoring.listUserDevices(await refresh(cm), ownUser.id))[0].globalBlockId, null,
      "only Master sees the global ban control identifier");
    process.env.ALLOW_DEVELOPMENT_MOBILE_AUTH = "true";
    const [usersBeforeDeniedSignIn] = await root.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) count FROM application_users");
    await assert.rejects(
      mobileSession.createDevelopmentMobileSession({ fullName: "QA Banned New Account", countryCode: "IN", deviceId: sharedDeviceId }),
      (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "DEVICE_BLOCKED",
    );
    await assert.rejects(
      mobileSession.createDevelopmentMobileSession({ fullName: "QA Missing Device", countryCode: "IN" }),
      (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "DEVICE_ID_REQUIRED",
    );
    const [usersAfterDeniedSignIn] = await root.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) count FROM application_users");
    assert.equal(usersAfterDeniedSignIn[0].count, usersBeforeDeniedSignIn[0].count,
      "a banned or unidentified device cannot create a new account row");
    const repeatedGlobalBan = await monitoring.banDeviceAcrossAccounts({ scope: master, sessionId, reason: "QA repeated Master device ban" });
    assert.equal(repeatedGlobalBan.alreadyBanned, true);
    assert.equal(repeatedGlobalBan.revokedSessions, 0);
    await assert.rejects(monitoring.unbanDeviceAcrossAccounts({ scope: await refresh(cm), banId: globalDevices[0].globalBlockId!, reason: "QA unauthorized restore" }), /Only Master/);
    await monitoring.unbanDeviceAcrossAccounts({ scope: master, banId: globalDevices[0].globalBlockId!, reason: "QA Master restores device access" });
    assert.equal(await mobileSession.authenticateMobileRequest(request), null,
      "unbanning must not resurrect previously revoked bearer tokens");
    const freshSession = await mobileSession.createDevelopmentMobileSession({ fullName: "QA Fresh Device Sign-In", countryCode: "IN", deviceId: sharedDeviceId });
    assert.ok(freshSession.token);
    const [globalAudit] = await root.query<(RowDataPacket & { action: string })[]>(
      "SELECT action FROM audit_logs WHERE target_id = ? ORDER BY created_at",
      [globalDevices[0].globalBlockId],
    );
    assert.deepEqual(globalAudit.map((row) => row.action), ["device.global_ban", "device.global_unban"]);
    delete process.env.ALLOW_DEVELOPMENT_MOBILE_AUTH;
    passed++;

    await ops.adjustPlatformCoinInventory({ scope: master, accountId: master.account.id, direction: "ADD", amount: 1000, reason: "QA generate inventory", idempotencyKey: randomUUID() });
    await assert.rejects(ops.adjustPlatformCoinInventory({ scope: cm, accountId: cm.account.id, direction: "ADD", amount: 1, reason: "QA prevent non-Master mint", idempotencyKey: randomUUID() }));
    for (const [sender, receiver] of [[master, cm], [cm, sa], [sa, branchAdmin], [branchAdmin, agency]]) await ops.allocatePlatformCoins({ scope: await refresh(sender), accountId: receiver.account.id, amount: 500, reason: "QA inventory distribution", idempotencyKey: randomUUID() });
    await assert.rejects(ops.allocatePlatformCoins({ scope: await refresh(cm), accountId: adminOther.account.id, amount: 1, reason: "QA reject foreign allocation", idempotencyKey: randomUUID() }));
    await ops.allocatePlatformCoins({ scope: master, accountId: seller.account.id, amount: 200, reason: "QA fund Coin Seller inventory", idempotencyKey: randomUUID() });
    assert.equal((await directory.searchCoinTransferRecipients(await refresh(seller), "Other")).some((user) => user.id === otherUser.id), true, "Coin Seller can find any active user by a partial name outside its branch");
    assert.equal((await directory.searchCoinTransferRecipients(await refresh(agency), "QA Other Host")).some((user) => user.id === otherUser.id), true, "Every authorized coin transfer screen can identify a valid platform user");
    await ops.transferCoins({ scope: await refresh(seller), recipientId: otherUser.id, amount: 50, reason: "QA Coin Seller cross-platform sale", idempotencyKey: randomUUID() });
    const sellerB = await create("COIN_SELLER", adminOther, "Isolated Seller B");
    await ops.allocatePlatformCoins({ scope: master, accountId: sellerB.account.id, amount: 20, reason: "QA fund second seller", idempotencyKey: randomUUID() });
    await ops.transferCoins({ scope: await refresh(sellerB), recipientId: otherUser.id, amount: 20, reason: "QA second seller transfer", idempotencyKey: randomUUID() });
    const sellerHistory = await ownerReports.coinTransferHistory(await refresh(seller), { mode: "24h", q: otherUser.publicId });
    assert.equal(sellerHistory.total, 1);
    assert.equal(sellerHistory.summary.totalCoinsTransferred, 50);
    assert.equal((await ownerReports.coinTransferHistory(await refresh(seller), { mode: "24h", q: ownUser.publicId })).total, 0, "seller search sees only transfers actually sent by that seller");
    assert.equal((await ownerReports.coinTransferHistory(master, { mode: "24h", q: otherUser.publicId })).total, 0, "Master view does not widen seller-private transfer history");
    const manipulatedSellerHistory = await ownerReports.coinTransferHistory(await refresh(seller), { mode: "24h", q: otherUser.publicId, sellerId: sellerB.account.id } as Parameters<typeof ownerReports.coinTransferHistory>[1] & { sellerId: string });
    assert.equal(manipulatedSellerHistory.total, 1);
    assert.equal(manipulatedSellerHistory.summary.totalCoinsTransferred, 50, "edited seller identifiers cannot reveal another seller's record");
    const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    assert.equal((await ownerReports.coinTransferHistory(await refresh(seller), { mode: "date", date: istToday, q: otherUser.publicId })).total, 1, "Date Wise uses the IST calendar day");
    const [sellerWallet] = await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'COIN'", [seller.account.id]);
    assert.equal(Number(sellerWallet[0].available_balance), 150);
    const key = randomUUID();
    await ops.transferCoins({ scope: agency, recipientId: ownUser.id, amount: 100, reason: "QA own host coin transfer", idempotencyKey: key });
    await assert.rejects(ops.transferCoins({ scope: agency, recipientId: ownUser.id, amount: 100, reason: "QA repeated transfer denied", idempotencyKey: key }));
    await ops.transferCoins({ scope: agency, recipientId: otherUser.id, amount: 1, reason: "QA authorized cross-platform transfer", idempotencyKey: randomUUID() });
    const [wallet] = await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'COIN'", [agency.account.id]);
    assert.equal(Number(wallet[0].available_balance), 399);
    assert.equal((await dashboard.getDashboardMetrics(master)).coinInventory, 280);
    assert.equal((await dashboard.getRecentLedger(agency)).some((entry) => entry.transactionType === "ACCOUNT_ALLOCATION"), true, "Agency must see inventory received from its Admin");
    passed++;

    const withdrawalId = randomUUID();
    await root.execute("INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance, reserved_balance) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND', 0, 100000)", [randomUUID(), ownUser.id]);
    await root.execute("INSERT INTO withdrawal_requests (id, withdrawal_code, application_user_id, agency_account_id, amount) VALUES (?, ?, ?, ?, 100000)", [withdrawalId, randomUUID(), ownUser.id, agency.account.id]);
    await assert.rejects(ops.transitionWithdrawal({ scope: agency, withdrawalId, nextStatus: "UNDER_REVIEW", reason: "QA Agency cannot approve payout" }));
    await assert.rejects(ops.transitionWithdrawal({ scope: await refresh(cmOther), withdrawalId, nextStatus: "UNDER_REVIEW", reason: "QA cross branch payout" }));
    for (const nextStatus of ["UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED"]) await ops.transitionWithdrawal({ scope: await refresh(cm), withdrawalId, nextStatus, providerReference: "QA-NO-REAL-PAYMENT", reason: "QA payout state transition" });
    passed++;

    const bannerPixels = randomBytes(64 * 64 * 4);
    for (let index = 3; index < bannerPixels.length; index += 4) bannerPixels[index] = 255;
    const png = await sharp(bannerPixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
    const { preparePublicImage } = await import("@/lib/security/public-images");
    const preparedBanner = await preparePublicImage(new File([png], "qa-banner.png", { type: "image/png" }), 2 * 1024 * 1024, "Banner", { maxWidth: 1200, maxHeight: 450 });
    assert.equal(preparedBanner.mimeType, "image/webp");
    const smallPng = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#58739a" } }).png().toBuffer();
    const smallBanner = await preparePublicImage(new File([smallPng], "small-valid.png", { type: "image/png" }), 2 * 1024 * 1024, "Banner", { maxWidth: 1200, maxHeight: 450 });
    assert.ok(smallBanner.byteSize > 0 && smallBanner.byteSize < 1000, "valid optimized artwork reproduces the old database constraint failure");
    const smallCreated = await catalog.createBanner({ scope: master, placement: "HOME", title: "QA small valid upload", image: smallBanner, actionType: "NONE", priority: 999, enabled: false });
    assert.ok((await catalog.listBanners()).some(banner => banner.id === smallCreated.id), "valid sub-1KB optimized artwork is durable");
    await assert.rejects(preparePublicImage(new File([Buffer.from("not an image")], "invalid.png", { type: "image/png" }), 2 * 1024 * 1024, "Banner", { maxWidth: 1200, maxHeight: 450 }), /unmodified JPG, PNG, or WebP/);
    await assert.rejects(preparePublicImage(new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), 2 * 1024 * 1024, "Banner", { maxWidth: 1200, maxHeight: 450 }), /2 MB or smaller/);
    const createdBanner = await catalog.createBanner({ scope: master, placement: "HOME", title: "QA upload", image: preparedBanner, actionType: "NONE", priority: 999, enabled: true });
    assert.match(createdBanner.imageUrl, /^https:\/\/api\.nazraa\.pixtra\.site\/api\/v1\/assets\/banners\/[0-9a-f-]+$/i);
    assert.equal(createdBanner.imageUrl.includes("nazraa.vercel.app"), false);
    assert.equal((await catalog.listBanners()).find((banner) => banner.id === createdBanner.id)?.imageUrl, createdBanner.imageUrl);
    const mobileBannerSnapshot = await product.mobileBootstrap(identity);
    assert.equal(mobileBannerSnapshot.banners.find((banner) => banner.id === createdBanner.id)?.image, createdBanner.imageUrl, "the consumer Home bootstrap uses the working public banner asset URL");
    const bannerAssetRoute = await import("@/app/api/v1/assets/banners/[id]/route");
    const assetResponse = await bannerAssetRoute.GET(new Request(createdBanner.imageUrl), { params: Promise.resolve({ id: createdBanner.assetId }) });
    assert.equal(assetResponse.status, 200, "persisted banner image endpoint should serve the stored asset");
    assert.match(assetResponse.headers.get("content-type") ?? "", /image\/webp/);
    assert.ok((await assetResponse.arrayBuffer()).byteLength > 0);
    await catalog.setBannerActive({ scope: master, id: createdBanner.id, active: false });
    assert.equal((await catalog.listBanners()).find((banner) => banner.id === createdBanner.id)?.active, false, "banner disable persists on reload");
    await catalog.setBannerActive({ scope: master, id: createdBanner.id, active: true });
    assert.equal((await catalog.listBanners()).find((banner) => banner.id === createdBanner.id)?.active, true, "banner re-enable persists on reload");
    await assert.rejects(catalog.createBanner({ scope: await refresh(cs), placement: "HOME", title: "forbidden", image: preparedBanner, actionType: "NONE", priority: 0, enabled: true }));

    const legacyBannerId = randomUUID();
    const legacyAssetId = randomUUID();
    await root.execute("INSERT INTO banner_assets (id, mime_type, image_data, byte_size, original_name, uploaded_by) VALUES (?, ?, ?, ?, 'qa-legacy.webp', ?)", [legacyAssetId, preparedBanner.mimeType, preparedBanner.data, preparedBanner.byteSize, master.account.id]);
    await root.execute("INSERT INTO banners (id, placement, title, image_url, action_type, active, created_by) VALUES (?, 'HOME', 'QA legacy URL', ?, 'NONE', TRUE, ?)", [legacyBannerId, `https://nazraa.vercel.app/api/v1/assets/banners/${legacyAssetId}`, master.account.id]);
    assert.equal((await catalog.listBanners()).find((banner) => banner.id === legacyBannerId)?.imageUrl, `https://api.nazraa.pixtra.site/api/v1/assets/banners/${legacyAssetId}`, "legacy Vercel banner records are served on the stable API host");
    const legacyConsumerBanner = (await product.mobileBootstrap(identity)).banners.find((banner) => banner.id === legacyBannerId);
    assert.equal(legacyConsumerBanner?.image, `https://api.nazraa.pixtra.site/api/v1/assets/banners/${legacyAssetId}`, "consumer bootstrap never emits a stale Vercel banner link");
    await root.execute("DELETE FROM banners WHERE id = ?", [legacyBannerId]);
    await root.execute("DELETE FROM banner_assets WHERE id = ?", [legacyAssetId]);
    const bannerId = randomUUID();
    await root.execute("INSERT INTO banners (id, placement, title, image_url, action_type, active, created_by) VALUES (?, 'HOME', 'QA unused banner', '/qa-image.webp', 'NONE', FALSE, ?)", [bannerId, master.account.id]);
    await assert.rejects(catalog.deleteBanner({ scope: cm, id: bannerId, reason: "QA reject unauthorized deletion", confirmed: true }));
    await assert.rejects(catalog.deleteBanner({ scope: master, id: bannerId, reason: "QA confirmation required", confirmed: false }));
    await catalog.deleteBanner({ scope: master, id: bannerId, reason: "QA unused banner cleanup", confirmed: true });
    const [audit] = await root.query<RowDataPacket[]>("SELECT previous_data FROM audit_logs WHERE target_id = ? AND action = 'banner.delete'", [bannerId]);
    assert.equal(audit.length, 1);
    assert.equal((await catalog.listBanners()).some((banner) => banner.id === bannerId), false);
    for (const [role, nonMasterScope] of scopes) {
      if (role === "MASTER") continue;
      await assert.rejects(
        ops.permanentlyBanUser({ scope: await refresh(nonMasterScope), applicationUserId: ownUser.id, reason: `QA ${role} cannot permanently ban`, confirmed: true }),
        (error: unknown) => error instanceof Error,
        `${role} must be rejected by the repository-level Master-only guard`,
      );
    }
    const accountBanToken = randomUUID();
    const accountBanSessionId = randomUUID();
    const explicitLogoutSessionId = randomUUID();
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, expires_at) VALUES (?, ?, ?, 'QA account ban session', DATE_ADD(NOW(), INTERVAL 1 DAY))", [accountBanSessionId, otherUser.id, createHash("sha256").update(accountBanToken).digest("hex")]);
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, expires_at, revoked_at, revoked_reason) VALUES (?, ?, ?, 'QA explicit logout session', DATE_ADD(NOW(), INTERVAL 1 DAY), CURRENT_TIMESTAMP(3), 'USER_LOGOUT')", [explicitLogoutSessionId, otherUser.id, createHash("sha256").update(randomUUID()).digest("hex")]);
    const accountBanRequest = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${accountBanToken}` } });
    await ops.permanentlyBanUser({ scope: master, applicationUserId: otherUser.id, reason: "QA Master permanent ban", confirmed: true });
    assert.equal((await monitoring.searchMonitoring(master, otherUser.publicId))[0].status, "BANNED");
    await assert.rejects(mobileSession.authenticateMobileRequest(accountBanRequest), (error: unknown) => error instanceof mobileSession.MobileAccessDeniedError && error.accessCode === "ACCOUNT_BANNED");
    await assert.rejects(ops.permanentlyUnbanUser({ scope: cm, applicationUserId: otherUser.id, reason: "QA deny non-Master unban", confirmed: true }));
    await ops.permanentlyUnbanUser({ scope: master, applicationUserId: otherUser.id, reason: "QA reviewed permanent ban and restored access", confirmed: true });
    assert.equal((await monitoring.searchMonitoring(master, otherUser.publicId))[0].status, "ACTIVE");
    assert.ok(await mobileSession.authenticateMobileRequest(accountBanRequest), "unban restores a still-valid session revoked by that account ban");
    const [sessionRevocations] = await root.query<RowDataPacket[]>("SELECT id, revoked_at, revoked_reason FROM mobile_sessions WHERE id IN (?, ?) ORDER BY id", [accountBanSessionId, explicitLogoutSessionId]);
    const accountBanSession = sessionRevocations.find((row) => row.id === accountBanSessionId);
    const explicitLogoutSession = sessionRevocations.find((row) => row.id === explicitLogoutSessionId);
    assert.equal(accountBanSession?.revoked_at, null);
    assert.equal(accountBanSession?.revoked_reason, null);
    assert.ok(explicitLogoutSession?.revoked_at, "unban must never resurrect a session explicitly logged out before the ban");
    assert.equal(explicitLogoutSession?.revoked_reason, "USER_LOGOUT");
    assert.equal((await monitoring.listModerationHistory(master, [otherUser.id]))[0].type, "ACCOUNT_BAN");
    assert.equal((await monitoring.listModerationHistory(master, [otherUser.id]))[0].status, "REVOKED");
    assert.equal((await ops.listAuditPage(master)).items.some((entry) => entry.action === "user.permanent_unban"), true);
    await assert.rejects(ops.permanentlyUnbanUser({ scope: master, applicationUserId: otherUser.id, reason: "QA stale duplicate unban", confirmed: true }), /no longer banned/);
    const removable = await create("COIN_SELLER", branchAdmin, "Unused team account");
    await assert.rejects(admin.permanentlyRemovePlatformAccount({ scope: cm, accountId: removable.account.id, reason: "QA deny non-Master removal", confirmed: true }));
    await admin.permanentlyRemovePlatformAccount({ scope: master, accountId: removable.account.id, reason: "QA remove unused account", confirmed: true });
    await assert.rejects(admin.updateAccountStatus({ scope: await refresh(cm), accountId: removable.account.id, nextStatus: "ACTIVE", reason: "QA permanent removal cannot reactivate" }));
    passed++;

    await root.execute("DELETE FROM administrative_balance_resets WHERE reset_key = 'LAUNCH_BALANCE_RESET_2026_09_03'");
    await root.execute("DELETE FROM audit_logs WHERE action = 'LAUNCH_BALANCE_RESET'");
    await root.execute("UPDATE wallet_balances SET available_balance = 123 WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'", [ownUser.id]);
    await root.execute("UPDATE wallet_balances SET available_balance = 456, reserved_balance = 100000 WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND'", [ownUser.id]);
    const launchResetSql = await readFile("db/migrations/0035_face_live_reward_and_launch_balance_reset.sql", "utf8");
    await root.query(launchResetSql);
    const [resetBalances] = await root.query<RowDataPacket[]>("SELECT asset_type, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? ORDER BY asset_type", [ownUser.id]);
    assert.deepEqual(resetBalances.map((row) => [row.asset_type, Number(row.available_balance), Number(row.reserved_balance)]), [["COIN", 0, 0], ["DIAMOND", 0, 100000]], "launch reset clears only spendable balances and preserves reserved funds");
    const [resetLedgerBeforeRetry] = await root.query<RowDataPacket[]>("SELECT COUNT(*) count FROM ledger_transactions WHERE transaction_type = 'LAUNCH_BALANCE_RESET'");
    await root.query(launchResetSql);
    const [resetLedgerAfterRetry] = await root.query<RowDataPacket[]>("SELECT COUNT(*) count FROM ledger_transactions WHERE transaction_type = 'LAUNCH_BALANCE_RESET'");
    assert.equal(Number(resetLedgerAfterRetry[0].count), Number(resetLedgerBeforeRetry[0].count), "launch reset retry must never create duplicate ledger entries");
    const [resetAudit] = await root.query<RowDataPacket[]>("SELECT COUNT(*) count FROM audit_logs WHERE action = 'LAUNCH_BALANCE_RESET'");
    assert.equal(Number(resetAudit[0].count), 1);
    passed++;
    console.log(`PASS: ${passed} integration groups; 8 roles, hierarchy/promotion, Agency approvals, authorization, 24-hour Live expiry, isolated device blocks, ban/unban, coins, payouts, deletion, SQL queries.`);
    if (process.env.NAZRAA_QA_KEEP === "1") {
      keep = true;
      console.log(`QA_DATABASE=${database}`);
      console.log(JSON.stringify([...scopes].map(([role, scope]) => ({ role, publicId: scope.account.publicId, id: scope.account.id }))));
    }
  } finally {
    await global.nazraaPool.end();
    global.nazraaPool = undefined;
    if (!keep) await root.query(`DROP DATABASE \`${database}\``);
    await root.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
