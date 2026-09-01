import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { verifyGoogleIdentity } from "@/lib/auth/google-identity";

export type MobileRole =
  | "NORMAL_USER"
  | "HOST"
  | "AGENCY_OWNER"
  | "AGENCY_MANAGER"
  | "COIN_SELLER"
  | "MONITORING_CS"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "MASTER";

export type MobileIdentity = {
  userId: string;
  publicId: string;
  externalUserId: string;
  fullName: string;
  role: MobileRole;
  accountStatus: string;
  faceVerificationStatus: string;
  agencyAccountId: string | null;
  agencyFaceLiveAuthorized: boolean;
  superAdminFaceLiveAuthorized: boolean;
};

const rolePermissions: Record<MobileRole, string[]> = {
  NORMAL_USER: ["rooms.read", "party.join", "gifts.send", "wallet.read", "coin_orders.create", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  HOST: ["rooms.read", "rooms.create.party", "rooms.create.live", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  AGENCY_OWNER: ["rooms.read", "rooms.create.party", "rooms.create.live", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "agency.performance.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  AGENCY_MANAGER: ["rooms.read", "rooms.create.party", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "agency.read", "agency.performance.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  COIN_SELLER: ["rooms.read", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "coin_orders.fulfill", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  MONITORING_CS: ["rooms.read", "party.join", "wallet.read", "moderation.read"],
  ADMIN: ["rooms.read", "rooms.create.party", "rooms.create.live", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  SUPER_ADMIN: ["rooms.read", "rooms.create.party", "rooms.create.live", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
  MASTER: ["rooms.read", "rooms.create.party", "rooms.create.live", "rooms.manage.own", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit", "profile.update", "daily_rewards.claim", "diamonds.exchange"],
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function deviceHash(deviceId?: string) {
  return deviceId ? createHash("sha256").update(`nazraa-device:${deviceId}`).digest("hex") : null;
}

function mapPlatformRole(role: string | null, isHost: number): MobileRole {
  if (role === "AGENCY") return "AGENCY_OWNER";
  if (role === "COIN_SELLER") return "COIN_SELLER";
  if (role === "MONITORING_CS") return "MONITORING_CS";
  if (role === "ADMIN" || role === "BD" || role === "COUNTRY_MANAGER") return "ADMIN";
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "MASTER") return "MASTER";
  return isHost ? "HOST" : "NORMAL_USER";
}

export function permissionsForMobileRole(role: MobileRole) {
  return rolePermissions[role];
}

export function mobileCan(identity: MobileIdentity, permission: string) {
  return rolePermissions[identity.role].includes(permission);
}

type RegistrationProfile = {
  fullName: string;
  countryCode: string;
  dateOfBirth: string;
  gender: "FEMALE" | "MALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY";
  whatsappE164: string;
  languageCode?: string;
  avatarUrl?: string;
  deviceLabel?: string;
};

export async function createGoogleMobileSession(input: {
  idToken: string;
  profile?: RegistrationProfile;
  deviceLabel?: string;
  deviceId?: string;
}) {
  const google = await verifyGoogleIdentity(input.idToken);
  const [existingRows] = await db().query<(RowDataPacket & { id: string; public_id: number; onboarding_completed: number; whatsapp_e164: string | null })[]>(
    "SELECT id, public_id, onboarding_completed, whatsapp_e164 FROM application_users WHERE google_subject = ? LIMIT 1",
    [google.subject],
  );
  const existing = existingRows[0];
  const profileRequired = !existing || !existing.onboarding_completed || !/^\+[1-9]\d{7,14}$/.test(existing.whatsapp_e164 ?? "");
  if (profileRequired && !input.profile) {
    return { requiresProfile: true, prefill: { fullName: google.name, email: google.email, avatarUrl: google.picture ?? null } };
  }

  const token = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const hashedDeviceId = deviceHash(input.deviceId);

  const result = await withTransaction(async (connection) => {
    let userId = existing?.id;
    let publicId = existing ? String(existing.public_id) : "";
    if (!userId) {
      userId = randomUUID();
      const placeholderExternalId = `pending-${randomUUID()}`;
      const profile = input.profile!;
      await connection.execute(
        `INSERT INTO application_users
          (id, external_user_id, google_subject, email, full_name, avatar_url, country_code,
           date_of_birth, gender, language_code, whatsapp_e164, onboarding_completed, is_host, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, CURRENT_TIMESTAMP(3))`,
        [userId, placeholderExternalId, google.subject, google.email, profile.fullName,
          profile.avatarUrl || google.picture || null, profile.countryCode, profile.dateOfBirth,
          profile.gender, profile.languageCode || "en", profile.whatsappE164],
      );
      const [users] = await connection.query<(RowDataPacket & { public_id: number })[]>(
        "SELECT public_id FROM application_users WHERE id = ? LIMIT 1",
        [userId],
      );
      publicId = String(users[0].public_id);
      await connection.execute("UPDATE application_users SET external_user_id = ? WHERE id = ?", [publicId, userId]);
    } else {
      if (hashedDeviceId) {
        const [blocks] = await connection.query<RowDataPacket[]>(
          "SELECT id FROM mobile_device_blocks WHERE application_user_id = ? AND device_id_hash = ? AND status = 'ACTIVE' LIMIT 1",
          [userId, hashedDeviceId],
        );
        if (blocks[0]) throw new Error("This device is blocked. Contact Nazraa support.");
      }
      await connection.execute(
        "UPDATE application_users SET email = ?, avatar_url = COALESCE(avatar_url, ?), last_active_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [google.email, google.picture ?? null, userId],
      );
      if (input.profile && profileRequired) {
        await connection.execute(
          `UPDATE application_users SET full_name = ?, avatar_url = COALESCE(?, avatar_url), country_code = ?,
             date_of_birth = ?, gender = ?, language_code = ?, whatsapp_e164 = ?, onboarding_completed = TRUE, is_host = TRUE
           WHERE id = ?`,
          [input.profile.fullName, input.profile.avatarUrl || google.picture || null, input.profile.countryCode,
            input.profile.dateOfBirth, input.profile.gender, input.profile.languageCode || "en",
            input.profile.whatsappE164, userId],
        );
      }
    }
    for (const assetType of ["COIN", "DIAMOND"] as const) {
      await connection.execute(
        "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance, reserved_balance) VALUES (?, 'APPLICATION_USER', ?, ?, 0, 0)",
        [randomUUID(), userId, assetType],
      );
    }
    await connection.execute(
      `INSERT IGNORE INTO host_profiles
        (id, application_user_id, agency_account_id, status, verification_status)
       SELECT ?, id, agency_account_id, 'ACTIVE', 'UNVERIFIED' FROM application_users WHERE id = ?`,
      [randomUUID(), userId],
    );
    await connection.execute(
      `INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 180 DAY))`,
      [sessionId, userId, tokenHash(token), input.deviceLabel || null, hashedDeviceId],
    );
    return publicId;
  });

  return { token, userId: result, requiresProfile: false };
}

export async function createDevelopmentMobileSession(input: { fullName: string; countryCode: string; deviceLabel?: string; deviceId?: string }) {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEVELOPMENT_MOBILE_AUTH !== "true") {
    throw new Error("Development mobile authentication is disabled.");
  }
  const userId = randomUUID();
  const placeholderExternalId = `pending-${randomUUID()}`;
  const sessionId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const publicId = await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO application_users
        (id, external_user_id, full_name, country_code, onboarding_completed, is_host, last_active_at)
       VALUES (?, ?, ?, ?, TRUE, TRUE, CURRENT_TIMESTAMP(3))`,
      [userId, placeholderExternalId, input.fullName, input.countryCode],
    );
    const [users] = await connection.query<(RowDataPacket & { public_id: number })[]>("SELECT public_id FROM application_users WHERE id = ?", [userId]);
    const id = String(users[0].public_id);
    await connection.execute("UPDATE application_users SET external_user_id = ? WHERE id = ?", [id, userId]);
    for (const assetType of ["COIN", "DIAMOND"] as const) {
      await connection.execute("INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, ?)", [randomUUID(), userId, assetType]);
    }
    await connection.execute("INSERT INTO host_profiles (id, application_user_id, status, verification_status) VALUES (?, ?, 'ACTIVE', 'UNVERIFIED')", [randomUUID(), userId]);
    await connection.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, device_id_hash, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 180 DAY))", [sessionId, userId, tokenHash(token), input.deviceLabel || null, deviceHash(input.deviceId)]);
    return id;
  });
  return { token, userId: publicId, requiresProfile: false };
}

export async function revokeMobileSession(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return;
  await db().execute("UPDATE mobile_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE token_hash = ?", [tokenHash(token)]);
}

export async function authenticateMobileRequest(request: Request): Promise<MobileIdentity | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const [rows] = await db().query<(RowDataPacket & {
    session_id: string;
    user_id: string;
    public_id: number;
    external_user_id: string;
    full_name: string;
    account_status: string;
    face_verification_status: string;
    agency_account_id: string | null;
    agency_face_live_authorized: number;
    super_admin_face_live_authorized: number;
    is_host: number;
    platform_role: string | null;
  })[]>(
    `SELECT session.id session_id, user.id user_id, user.public_id, user.external_user_id,
            user.full_name, user.account_status, user.face_verification_status, user.is_host,
            user.agency_account_id, user.agency_face_live_authorized, user.super_admin_face_live_authorized,
            account.role platform_role
     FROM mobile_sessions session
     INNER JOIN application_users user ON user.id = session.application_user_id
     LEFT JOIN platform_accounts account
       ON account.status = 'ACTIVE'
      AND (account.application_user_id = user.id OR account.application_user_id = user.external_user_id OR account.application_user_id = CAST(user.public_id AS CHAR))
     WHERE session.token_hash = ? AND session.revoked_at IS NULL
       AND session.expires_at > CURRENT_TIMESTAMP(3) AND user.account_status = 'ACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM mobile_device_blocks block
         WHERE block.status = 'ACTIVE' AND block.application_user_id = user.id
           AND (block.mobile_session_id = session.id OR (session.device_id_hash IS NOT NULL AND block.device_id_hash = session.device_id_hash))
       )
     ORDER BY account.created_at ASC LIMIT 1`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  await db().execute(
    "UPDATE mobile_sessions SET last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND last_used_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE)",
    [row.session_id],
  );
  return {
    userId: row.user_id,
    publicId: String(row.public_id),
    externalUserId: row.external_user_id,
    fullName: row.full_name,
    role: mapPlatformRole(row.platform_role, row.is_host),
    accountStatus: row.account_status,
    faceVerificationStatus: row.face_verification_status,
    agencyAccountId: row.agency_account_id,
    agencyFaceLiveAuthorized: Boolean(row.agency_face_live_authorized),
    superAdminFaceLiveAuthorized: Boolean(row.super_admin_face_live_authorized),
  };
}
