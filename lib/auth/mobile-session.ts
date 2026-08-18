import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";

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
};

const rolePermissions: Record<MobileRole, string[]> = {
  NORMAL_USER: ["rooms.read", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "face.submit"],
  HOST: ["rooms.read", "rooms.create.party", "rooms.create.live", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "face.submit"],
  AGENCY_OWNER: ["rooms.read", "rooms.create.party", "rooms.create.live", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "agency.performance.read", "face.submit"],
  AGENCY_MANAGER: ["rooms.read", "rooms.create.party", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "agency.read", "agency.performance.read", "face.submit"],
  COIN_SELLER: ["rooms.read", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "coin_orders.fulfill", "face.submit"],
  MONITORING_CS: ["rooms.read", "party.join", "wallet.read", "moderation.read"],
  ADMIN: ["rooms.read", "rooms.create.party", "rooms.create.live", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit"],
  SUPER_ADMIN: ["rooms.read", "rooms.create.party", "rooms.create.live", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit"],
  MASTER: ["rooms.read", "rooms.create.party", "rooms.create.live", "party.join", "party.take_seat", "gifts.send", "wallet.read", "coin_orders.create", "withdrawals.create", "host.read", "agency.read", "face.submit"],
};

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mapPlatformRole(role: string | null, isHost: number): MobileRole {
  if (role === "AGENCY") return "AGENCY_OWNER";
  if (role === "COIN_SELLER") return "COIN_SELLER";
  if (role === "MONITORING_CS") return "MONITORING_CS";
  if (role === "ADMIN") return "ADMIN";
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

export async function createMobileSession(input: {
  fullName: string;
  countryCode: string;
  avatarUrl?: string;
  deviceLabel?: string;
}) {
  const userId = randomUUID();
  const placeholderExternalId = `pending-${randomUUID()}`;
  const sessionId = randomUUID();
  const token = randomBytes(32).toString("base64url");

  const result = await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO application_users (id, external_user_id, full_name, avatar_url, country_code, last_active_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [userId, placeholderExternalId, input.fullName, input.avatarUrl || null, input.countryCode],
    );
    const [users] = await connection.query<(RowDataPacket & { public_id: number })[]>(
      "SELECT public_id FROM application_users WHERE id = ? LIMIT 1",
      [userId],
    );
    const publicId = String(users[0].public_id);
    await connection.execute("UPDATE application_users SET external_user_id = ? WHERE id = ?", [publicId, userId]);
    for (const assetType of ["COIN", "DIAMOND"] as const) {
      await connection.execute(
        "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance, reserved_balance) VALUES (?, 'APPLICATION_USER', ?, ?, 0, 0)",
        [randomUUID(), userId, assetType],
      );
    }
    await connection.execute(
      `INSERT INTO mobile_sessions (id, application_user_id, token_hash, device_label, expires_at)
       VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 180 DAY))`,
      [sessionId, userId, tokenHash(token), input.deviceLabel || null],
    );
    return publicId;
  });

  return { token, userId: result };
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
    is_host: number;
    platform_role: string | null;
  })[]>(
    `SELECT session.id session_id, user.id user_id, user.public_id, user.external_user_id,
            user.full_name, user.account_status, user.face_verification_status, user.is_host, account.role platform_role
     FROM mobile_sessions session
     INNER JOIN application_users user ON user.id = session.application_user_id
     LEFT JOIN platform_accounts account
       ON account.status = 'ACTIVE'
      AND (account.application_user_id = user.id OR account.application_user_id = user.external_user_id OR account.application_user_id = CAST(user.public_id AS CHAR))
     WHERE session.token_hash = ? AND session.revoked_at IS NULL
       AND session.expires_at > CURRENT_TIMESTAMP(3) AND user.account_status = 'ACTIVE'
     ORDER BY account.created_at ASC LIMIT 1`,
    [tokenHash(token)],
  );
  const row = rows[0];
  if (!row) return null;
  await db().execute("UPDATE mobile_sessions SET last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ?", [row.session_id]);
  return {
    userId: row.user_id,
    publicId: String(row.public_id),
    externalUserId: row.external_user_id,
    fullName: row.full_name,
    role: mapPlatformRole(row.platform_role, row.is_host),
    accountStatus: row.account_status,
    faceVerificationStatus: row.face_verification_status,
  };
}
