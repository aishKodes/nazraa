import "dotenv/config";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";

const hostUsername = process.env.PLAY_REVIEW_HOST_USERNAME?.trim().toLowerCase() || "nazraa-play-host";
const viewerUsername = process.env.PLAY_REVIEW_VIEWER_USERNAME?.trim().toLowerCase() || "nazraa-play-viewer";
const hostPassword = process.env.PLAY_REVIEW_HOST_PASSWORD;
const viewerPassword = process.env.PLAY_REVIEW_VIEWER_PASSWORD;

async function reviewerAgencyPublicId(connection: PoolConnection) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = randomInt(100000, 1000000);
    const [rows] = await connection.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE public_id = ? LIMIT 1", [candidate]);
    if (!rows.length) return candidate;
  }
  throw new Error("A unique six-digit reviewer Agency ID could not be allocated.");
}

async function ensureReviewer(connection: PoolConnection, input: { username: string; password: string; role: "HOST" | "VIEWER"; agencyId: string }) {
  const [existing] = await connection.query<(RowDataPacket & { application_user_id: string })[]>(
    "SELECT application_user_id FROM play_reviewer_credentials WHERE username = ? LIMIT 1 FOR UPDATE",
    [input.username],
  );
  let userId = existing[0]?.application_user_id;
  if (!userId) {
    userId = randomUUID();
    const placeholder = `play-review-${randomUUID()}`;
    await connection.execute(
      `INSERT INTO application_users
        (id, external_user_id, full_name, country_code, date_of_birth, gender,
         language_code, onboarding_completed, agency_account_id, is_host,
         face_verification_status, agency_face_live_authorized,
         super_admin_face_live_authorized, account_status)
       VALUES (?, ?, ?, 'IN', '1995-01-01', ?, 'en', TRUE, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [userId, placeholder, input.role === "HOST" ? "Google Play Reviewer Host" : "Google Play Reviewer Viewer",
        input.role === "HOST" ? "FEMALE" : "MALE", input.role === "HOST" ? input.agencyId : null,
        input.role === "HOST", input.role === "HOST" ? "VERIFIED" : "NOT_SUBMITTED",
        input.role === "HOST", input.role === "HOST"],
    );
    const [users] = await connection.query<(RowDataPacket & { public_id: number })[]>("SELECT public_id FROM application_users WHERE id = ? LIMIT 1", [userId]);
    await connection.execute("UPDATE application_users SET external_user_id = ? WHERE id = ?", [String(users[0].public_id), userId]);
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  await connection.execute(
    `INSERT INTO play_reviewer_credentials
      (id, application_user_id, username, password_hash, reviewer_role, active)
     VALUES (?, ?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), reviewer_role = VALUES(reviewer_role), active = TRUE`,
    [randomUUID(), userId, input.username, passwordHash, input.role],
  );
  await connection.execute(
    `INSERT INTO mobile_access_overrides
      (application_user_id, host_access_override, play_reviewer_access_override, note)
     VALUES (?, ?, TRUE, 'Google Play reviewer account')
     ON DUPLICATE KEY UPDATE host_access_override = VALUES(host_access_override), play_reviewer_access_override = TRUE, note = VALUES(note)`,
    [userId, input.role === "HOST"],
  );
  if (input.role === "HOST") {
    await connection.execute(
      `INSERT INTO host_profiles (id, application_user_id, agency_account_id, status, verification_status)
       VALUES (?, ?, ?, 'ACTIVE', 'VERIFIED')
       ON DUPLICATE KEY UPDATE agency_account_id = VALUES(agency_account_id), status = 'ACTIVE', verification_status = 'VERIFIED'`,
      [randomUUID(), userId, input.agencyId],
    );
  }
  for (const asset of ["COIN", "DIAMOND"] as const) {
    await connection.execute(
      `INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance)
       VALUES (?, 'APPLICATION_USER', ?, ?, ?)`,
      [randomUUID(), userId, asset, asset === "COIN" ? 100000 : 0],
    );
  }
  return userId;
}

async function ensureReviewerCosmetics(connection: PoolConnection, userId: string) {
  const itemKeys = [
    "mall_celestial_empress_frame",
    "entry_underworld_emperor",
    "profile_shadow_king",
    "chat_regal_crystal_wings",
    "badge_legend_vip_royal_crest",
    "medal_shadow_king_crown",
  ];
  for (const itemKey of itemKeys) {
    const [catalogRows] = await connection.query<(RowDataPacket & { id: string; catalog_type: string })[]>(
      "SELECT id, catalog_type FROM gift_catalog WHERE gift_key = ? AND active = TRUE LIMIT 1 FOR UPDATE",
      [itemKey],
    );
    const catalog = catalogRows[0];
    if (!catalog) throw new Error(`The reviewer cosmetic ${itemKey} is unavailable.`);
    const grantReference = `play-review:${itemKey}`;
    await connection.execute(
      `INSERT INTO user_cosmetic_entitlements
        (id, application_user_id, gift_catalog_id, source, expires_at,
         equipped_at, grant_reference)
       SELECT UUID(), ?, ?, 'MALL', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 3650 DAY),
              NULL, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM user_cosmetic_entitlements
         WHERE application_user_id = ? AND grant_reference = ?
           AND revoked_at IS NULL
       )`,
      [userId, catalog.id, grantReference, userId, grantReference],
    );
    const slot = catalog.catalog_type === "ENTRY_FRAME" ? "ENTRY_EFFECT" : catalog.catalog_type;
    await connection.execute(
      `UPDATE user_cosmetic_entitlements entitlement
       INNER JOIN gift_catalog catalog ON catalog.id = entitlement.gift_catalog_id
       SET entitlement.equipped_at = NULL
       WHERE entitlement.application_user_id = ?
         AND entitlement.equipped_at IS NOT NULL
         AND (CASE WHEN catalog.catalog_type = 'ENTRY_FRAME' THEN 'ENTRY_EFFECT' ELSE catalog.catalog_type END) = ?`,
      [userId, slot],
    );
    await connection.execute(
      `UPDATE user_cosmetic_entitlements
       SET expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 3650 DAY),
           equipped_at = CURRENT_TIMESTAMP(3), manually_unequipped_at = NULL,
           revoked_at = NULL
       WHERE application_user_id = ? AND grant_reference = ?`,
      [userId, grantReference],
    );
  }
}

async function main() {
  if (!hostPassword || !viewerPassword || hostPassword.length < 16 || viewerPassword.length < 16) {
    if (process.env.PLAY_REVIEW_PROVISION_OPTIONAL === "true" && !hostPassword && !viewerPassword) {
      console.log("Play reviewer provisioning skipped: reviewer password secrets are not configured.");
      return;
    }
    throw new Error("PLAY_REVIEW_HOST_PASSWORD and PLAY_REVIEW_VIEWER_PASSWORD must each contain at least 16 characters.");
  }
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined, connectionLimit: 1,
  });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [masterRows] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM platform_accounts WHERE role = 'MASTER' AND status = 'ACTIVE' ORDER BY created_at LIMIT 1 FOR UPDATE");
    if (!masterRows[0]) throw new Error("An active Master account is required before provisioning Play reviewers.");
    const [agencyRows] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM platform_accounts WHERE role_code = 'AGY-PLAY-REVIEW' LIMIT 1 FOR UPDATE");
    let agencyId = agencyRows[0]?.id;
    if (!agencyId) {
      agencyId = randomUUID();
      const publicId = await reviewerAgencyPublicId(connection);
      await connection.execute(
        `INSERT INTO platform_accounts
          (id, public_id, role, role_code, full_name, password_hash, status, created_by, country_code)
         VALUES (?, ?, 'AGENCY', 'AGY-PLAY-REVIEW', 'Nazraa Play Review Agency', ?, 'ACTIVE', ?, 'IN')`,
        [agencyId, publicId, await bcrypt.hash(randomUUID(), 12), masterRows[0].id],
      );
    }
    const [policyRows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>("SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.policy_config' LIMIT 1");
    const rawPolicy = typeof policyRows[0]?.setting_value === "string" ? JSON.parse(policyRows[0].setting_value) : (policyRows[0]?.setting_value ?? {});
    const termsVersion = String((rawPolicy as Record<string, unknown>).termsVersion ?? "2026-09-06");
    const guidelinesVersion = String((rawPolicy as Record<string, unknown>).communityGuidelinesVersion ?? "2026-09-06");
    const hostId = await ensureReviewer(connection, { username: hostUsername, password: hostPassword, role: "HOST", agencyId });
    const viewerId = await ensureReviewer(connection, { username: viewerUsername, password: viewerPassword, role: "VIEWER", agencyId });
    await ensureReviewerCosmetics(connection, hostId);
    await connection.execute(
      "UPDATE platform_accounts SET application_user_id = ? WHERE id = ? AND role = 'AGENCY'",
      [hostId, agencyId],
    );
    await connection.execute("DELETE FROM policy_acceptances WHERE application_user_id IN (?, ?) AND policy_key IN ('terms','community-guidelines')", [hostId, viewerId]);
    await connection.execute(
      `INSERT INTO policy_acceptances (application_user_id, policy_key, policy_version, source)
       VALUES (?, 'terms', ?, 'PLAY_REVIEWER'), (?, 'community-guidelines', ?, 'PLAY_REVIEWER'),
              (?, 'terms', ?, 'PLAY_REVIEWER'), (?, 'community-guidelines', ?, 'PLAY_REVIEWER')`,
      [hostId, termsVersion, hostId, guidelinesVersion, viewerId, termsVersion, viewerId, guidelinesVersion],
    );
    await connection.commit();
    console.log(`Play reviewer accounts provisioned: ${hostUsername}, ${viewerUsername}`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
