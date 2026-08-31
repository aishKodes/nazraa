import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import mysql, { type RowDataPacket } from "mysql2/promise";
import type { Role, Scope } from "@/types/platform";

// Standalone repository tests run outside Next's server-only module alias.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, context);
} });

async function main() {
  const database = `nazraa_control_qa_${Date.now()}`;
  const root = await mysql.createConnection({ host: "127.0.0.1", user: "root", multipleStatements: true });
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  global.nazraaPool = mysql.createPool({ host: "127.0.0.1", user: "root", database, connectionLimit: 8, decimalNumbers: true, timezone: "Z" });
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
    const dashboard = await import("@/lib/db/repositories/dashboard");
    const catalog = await import("@/lib/db/repositories/catalog");
    const completion = await import("@/lib/db/repositories/completion-administration");
    const mobileSession = await import("@/lib/auth/mobile-session");
    const password = "Local-QA-Only-2026!";
    await accounts.createInitialMaster({ publicId: 100001, fullName: "QA Master", password });
    const masterAccount = await accounts.accountByManagementId("100001");
    assert.ok(masterAccount);
    const master = await accounts.scopeFor(masterAccount);
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
    for (const [role, scope] of scopes) {
      const rows = await directory.listUsersPage(scope);
      const shouldSeeOwn = !["BD", "COIN_SELLER"].includes(role);
      assert.equal(rows.items.some((row) => row.id === ownUser.id), shouldSeeOwn, `${role}: own branch`);
      assert.equal(rows.items.some((row) => row.id === otherUser.id), role === "MASTER", `${role}: cross branch`);
      await Promise.all([dashboard.getDashboardMetrics(scope), dashboard.getRevenueSeries(scope), ops.listRoomsPage(scope), ops.listAuditPage(scope), ops.listWithdrawalsPage(scope)]);
      passed++;
    }
    assert.equal((await directory.hierarchy(master)).some((node) => node.id === agencyOther.account.id), true);
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
    for (const kind of ["LIVE", "PARTY", "FACE"]) await root.execute("INSERT INTO host_reward_rules (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by) VALUES (?, ?, 0, 60, TRUE, '2020-01-01', ?)", [randomUUID(), kind, master.account.id]);
    const [hostRows] = await root.query<RowDataPacket[]>("SELECT id FROM host_profiles WHERE application_user_id = ?", [ownUser.id]);
    const hostId = String(hostRows[0].id);
    const identity = { userId: ownUser.id, publicId: ownUser.publicId, externalUserId: ownUser.id, fullName: "QA Own Host", role: "HOST" as const, accountStatus: "ACTIVE", faceVerificationStatus: "VERIFIED", agencyAccountId: agency.account.id, agencyFaceLiveAuthorized: true, superAdminFaceLiveAuthorized: true };
    const roomInput = (kind: string) => ({ roomCode: randomUUID(), kind, title: "QA suspension room", category: "chat", language: "en", privacy: "public" as const, seatCount: 8, themeIndex: 0, themeEnabled: true, countryCode: "IN" });
    const interruptedRoom = await product.createRoom(identity, roomInput("party"));
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
    // Finalization after suspension cannot continue accruing time/rewards.
    await root.execute("UPDATE live_session_accounting SET started_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE room_id = ?", [interruptedRoom.id]);
    await root.execute("UPDATE live_rooms SET ended_at = DATE_ADD((SELECT started_at FROM live_session_accounting WHERE room_id = ?), INTERVAL 60 SECOND) WHERE id = ?", [interruptedRoom.id, interruptedRoom.id]);
    assert.equal((await liveCompletion.finalizeLiveSession(identity, interruptedRoom.roomCode)).validSeconds, 60);
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
    await completion.setFaceLiveAuthorization({ scope: agency, userPublicId: ownUser.publicId, authorizationType: "AGENCY_FACE_LIVE", approved: true, reason: "QA own host authorization" });
    await completion.setFaceLiveAuthorization({ scope: await refresh(cm), userPublicId: ownUser.publicId, authorizationType: "SUPER_ADMIN_FACE_LIVE", approved: true, reason: "QA team Live authorization" });
    await assert.rejects(completion.setFaceLiveAuthorization({ scope: await refresh(cm), userPublicId: otherUser.publicId, authorizationType: "SUPER_ADMIN_FACE_LIVE", approved: true, reason: "QA cannot authorize other branch" }));
    passed++;

    const temp = await ops.createTemporaryLiveRestriction({ scope: await refresh(cs), applicationUserId: ownUser.id, durationMinutes: 30, reason: "QA temporary Live restriction" });
    assert.ok((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId);
    await assert.rejects(ops.createTemporaryLiveRestriction({ scope: await refresh(cs), applicationUserId: otherUser.id, durationMinutes: 30, reason: "QA reject other branch" }));
    await root.execute("UPDATE moderation_restrictions SET ends_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?", [temp.restrictionId]);
    assert.equal((await monitoring.searchMonitoring(await refresh(cs), ownUser.publicId))[0]?.restrictionId, null);
    assert.equal((await monitoring.listModerationHistory(await refresh(cs), [ownUser.id]))[0].status, "EXPIRED");
    passed++;

    const token = randomUUID();
    const sessionId = randomUUID();
    await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at) VALUES (?, ?, ?, 'QA device', ?, DATE_ADD(NOW(), INTERVAL 1 DAY))", [sessionId, ownUser.id, createHash("sha256").update(token).digest("hex"), createHash("sha256").update("qa-device").digest("hex")]);
    const request = new Request("http://localhost/api/test", { headers: { authorization: `Bearer ${token}` } });
    assert.ok(await mobileSession.authenticateMobileRequest(request));
    await assert.rejects(monitoring.blockUserDevice({ scope: await refresh(cmOther), sessionId, reason: "QA foreign device denied" }));
    await monitoring.blockUserDevice({ scope: await refresh(cm), sessionId, reason: "QA own device blocked" });
    assert.equal(await mobileSession.authenticateMobileRequest(request), null);
    const devices = await monitoring.listUserDevices(await refresh(cm), ownUser.id);
    assert.ok(devices[0].blockId);
    await monitoring.unblockUserDevice({ scope: await refresh(cm), blockId: devices[0].blockId, reason: "QA own device restored" });
    passed++;

    await ops.adjustPlatformCoinInventory({ scope: master, accountId: master.account.id, direction: "ADD", amount: 1000, reason: "QA generate inventory", idempotencyKey: randomUUID() });
    await assert.rejects(ops.adjustPlatformCoinInventory({ scope: cm, accountId: cm.account.id, direction: "ADD", amount: 1, reason: "QA prevent non-Master mint", idempotencyKey: randomUUID() }));
    for (const [sender, receiver] of [[master, cm], [cm, sa], [sa, branchAdmin], [branchAdmin, agency]]) await ops.allocatePlatformCoins({ scope: await refresh(sender), accountId: receiver.account.id, amount: 500, reason: "QA inventory distribution", idempotencyKey: randomUUID() });
    await assert.rejects(ops.allocatePlatformCoins({ scope: await refresh(cm), accountId: adminOther.account.id, amount: 1, reason: "QA reject foreign allocation", idempotencyKey: randomUUID() }));
    const key = randomUUID();
    await ops.transferCoins({ scope: agency, recipientId: ownUser.id, amount: 100, reason: "QA own host coin transfer", idempotencyKey: key });
    await assert.rejects(ops.transferCoins({ scope: agency, recipientId: ownUser.id, amount: 100, reason: "QA repeated transfer denied", idempotencyKey: key }));
    await assert.rejects(ops.transferCoins({ scope: agency, recipientId: otherUser.id, amount: 1, reason: "QA foreign transfer denied", idempotencyKey: randomUUID() }));
    const [wallet] = await root.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'COIN'", [agency.account.id]);
    assert.equal(Number(wallet[0].available_balance), 400);
    assert.equal((await dashboard.getDashboardMetrics(master)).coinInventory, 500);
    assert.equal((await dashboard.getRecentLedger(agency)).some((entry) => entry.transactionType === "ACCOUNT_ALLOCATION"), true, "Agency must see inventory received from its Admin");
    passed++;

    const withdrawalId = randomUUID();
    await root.execute("INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance, reserved_balance) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND', 0, 100)", [randomUUID(), ownUser.id]);
    await root.execute("INSERT INTO withdrawal_requests (id, withdrawal_code, application_user_id, agency_account_id, amount) VALUES (?, ?, ?, ?, 100)", [withdrawalId, randomUUID(), ownUser.id, agency.account.id]);
    await assert.rejects(ops.transitionWithdrawal({ scope: agency, withdrawalId, nextStatus: "UNDER_REVIEW", reason: "QA Agency cannot approve payout" }));
    await assert.rejects(ops.transitionWithdrawal({ scope: await refresh(cmOther), withdrawalId, nextStatus: "UNDER_REVIEW", reason: "QA cross branch payout" }));
    for (const nextStatus of ["UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED"]) await ops.transitionWithdrawal({ scope: await refresh(cm), withdrawalId, nextStatus, providerReference: "QA-NO-REAL-PAYMENT", reason: "QA payout state transition" });
    passed++;

    const bannerId = randomUUID();
    await root.execute("INSERT INTO banners (id, placement, title, image_url, action_type, active, created_by) VALUES (?, 'HOME', 'QA unused banner', '/qa-image.webp', 'NONE', FALSE, ?)", [bannerId, master.account.id]);
    await assert.rejects(catalog.deleteBanner({ scope: cm, id: bannerId, reason: "QA reject unauthorized deletion", confirmed: true }));
    await assert.rejects(catalog.deleteBanner({ scope: master, id: bannerId, reason: "QA confirmation required", confirmed: false }));
    await catalog.deleteBanner({ scope: master, id: bannerId, reason: "QA unused banner cleanup", confirmed: true });
    const [audit] = await root.query<RowDataPacket[]>("SELECT previous_data FROM audit_logs WHERE target_id = ? AND action = 'banner.delete'", [bannerId]);
    assert.equal(audit.length, 1);
    assert.equal((await catalog.listBanners()).some((banner) => banner.id === bannerId), false);
    await assert.rejects(ops.permanentlyBanUser({ scope: cm, applicationUserId: ownUser.id, reason: "QA deny non-Master ban", confirmed: true }));
    await ops.permanentlyBanUser({ scope: master, applicationUserId: otherUser.id, reason: "QA Master permanent ban", confirmed: true });
    assert.equal((await monitoring.searchMonitoring(master, otherUser.publicId))[0].status, "BANNED");
    const removable = await create("COIN_SELLER", branchAdmin, "Unused team account");
    await assert.rejects(admin.permanentlyRemovePlatformAccount({ scope: cm, accountId: removable.account.id, reason: "QA deny non-Master removal", confirmed: true }));
    await admin.permanentlyRemovePlatformAccount({ scope: master, accountId: removable.account.id, reason: "QA remove unused account", confirmed: true });
    await assert.rejects(admin.updateAccountStatus({ scope: await refresh(cm), accountId: removable.account.id, nextStatus: "ACTIVE", reason: "QA permanent removal cannot reactivate" }));
    passed++;
    console.log(`PASS: ${passed} integration groups; 8 roles, hierarchy/promotion, Agency approvals, authorization, restrictions/expiry, devices, coins, payouts, bans, deletion, SQL queries.`);
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
