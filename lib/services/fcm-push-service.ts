import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { GoogleAuth } from "google-auth-library";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import {
  decryptPrivateText,
  encryptPrivateText,
} from "@/lib/security/documents";
import type { Scope } from "@/types/platform";

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging";
const maxAttempts = 4;

type PushJobRow = RowDataPacket & {
  id: string;
  campaign_id: string;
  device_id: string;
  token_encrypted: Buffer;
  token_iv: Buffer;
  token_tag: Buffer;
  title: string;
  message: string;
  action_target: string | null;
  payload: unknown;
};

type FcmSendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; invalid?: boolean; code: string };

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanActionTarget(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return /^[a-z0-9][a-z0-9_\-/:]{0,160}$/i.test(normalized) ? normalized : null;
}

function asData(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => /^[A-Za-z0-9_]{1,64}$/.test(key) && item != null)
      .map(([key, item]) => [key, String(item).slice(0, 512)]),
  );
}

function assertMaster(scope: Scope) {
  if (scope.account.role !== "MASTER") {
    throw new Error("Only Master can send mobile push notifications.");
  }
}

export async function registerMobilePushDevice(
  identity: MobileIdentity,
  input: { token: string; installationId: string; appVersion?: string },
) {
  const token = input.token.trim();
  const installationId = input.installationId.trim().slice(0, 160);
  if (!/^[A-Za-z0-9_:\-]{20,4096}$/.test(token) || installationId.length < 8) {
    throw new Error("This device notification registration is invalid.");
  }
  const hash = tokenHash(token);
  const encrypted = encryptPrivateText(token);
  await withTransaction(async (connection) => {
    // A Firebase installation can belong to only the currently signed-in
    // Nazraa user. This prevents a previous account on a shared device from
    // receiving a later account's personal notification.
    await connection.execute(
      `UPDATE mobile_push_devices
       SET active = FALSE, invalidated_at = CURRENT_TIMESTAMP(3), invalid_reason = 'REASSIGNED'
       WHERE application_user_id = ? AND installation_id = ? AND token_hash <> ? AND active = TRUE`,
      [identity.userId, installationId, hash],
    );
    await connection.execute(
      `INSERT INTO mobile_push_devices
        (id, application_user_id, installation_id, platform, app_version, token_hash,
         token_encrypted, token_iv, token_tag, active, last_seen_at, invalidated_at, invalid_reason)
       VALUES (?, ?, ?, 'ANDROID', ?, ?, ?, ?, ?, TRUE, CURRENT_TIMESTAMP(3), NULL, NULL)
       ON DUPLICATE KEY UPDATE
         application_user_id = VALUES(application_user_id), installation_id = VALUES(installation_id),
         app_version = VALUES(app_version), token_encrypted = VALUES(token_encrypted),
         token_iv = VALUES(token_iv), token_tag = VALUES(token_tag), active = TRUE,
         last_seen_at = CURRENT_TIMESTAMP(3), invalidated_at = NULL, invalid_reason = NULL`,
      [
        randomUUID(),
        identity.userId,
        installationId,
        input.appVersion?.trim().slice(0, 64) || null,
        hash,
        encrypted.encryptedData,
        encrypted.iv,
        encrypted.tag,
      ],
    );
  });
  return { registered: true };
}

export async function unregisterMobilePushDevice(
  identity: MobileIdentity,
  input: { installationId: string; token?: string },
) {
  const installationId = input.installationId.trim().slice(0, 160);
  const hash = input.token?.trim() ? tokenHash(input.token.trim()) : null;
  const [result] = await db().execute(
    `UPDATE mobile_push_devices
     SET active = FALSE, invalidated_at = CURRENT_TIMESTAMP(3), invalid_reason = 'LOGOUT'
     WHERE application_user_id = ? AND installation_id = ?
       AND (? IS NULL OR token_hash = ?) AND active = TRUE`,
    [identity.userId, installationId, hash, hash],
  );
  return {
    unregistered: (result as { affectedRows?: number }).affectedRows ?? 0,
  };
}

async function auditQueued(connection: PoolConnection, jobId: string) {
  await connection.execute(
    "INSERT INTO mobile_push_delivery_audits (id, job_id, event_type) VALUES (?, ?, 'QUEUED')",
    [randomUUID(), jobId],
  );
}

async function queueCampaignJobs(
  connection: PoolConnection,
  input: { campaignId: string; recipientUserId?: string },
) {
  const [devices] = await connection.query<
    (RowDataPacket & { id: string; application_user_id: string })[]
  >(
    `SELECT id, application_user_id FROM mobile_push_devices
     WHERE active = TRUE ${input.recipientUserId ? "AND application_user_id = ?" : ""}`,
    input.recipientUserId ? [input.recipientUserId] : [],
  );
  for (const device of devices) {
    const jobId = randomUUID();
    const [insert] = await connection.execute(
      `INSERT IGNORE INTO mobile_push_jobs
        (id, campaign_id, application_user_id, device_id)
       VALUES (?, ?, ?, ?)`,
      [jobId, input.campaignId, device.application_user_id, device.id],
    );
    if ((insert as { affectedRows?: number }).affectedRows)
      await auditQueued(connection, jobId);
  }
  return devices.length;
}

/** Called only after the authenticated host video track is actually published. */
export async function enqueueFollowerLivePush(
  connection: PoolConnection,
  input: {
    liveSessionId: string;
    roomCode: string;
    hostUserId: string;
    hostName: string;
  },
) {
  const campaignId = randomUUID();
  const [insert] = await connection.execute(
    `INSERT IGNORE INTO mobile_push_campaigns
      (id, campaign_type, reference_key, title, message, action_target, payload)
     VALUES (?, 'LIVE_FOLLOWER', ?, ?, ?, ?, JSON_OBJECT('roomCode', ?, 'kind', 'live_follower'))`,
    [
      campaignId,
      `LIVE_SESSION:${input.liveSessionId}`,
      `${input.hostName.slice(0, 72)} is Live`,
      "Join the Face Live now.",
      `room/${input.roomCode}`,
      input.roomCode,
    ],
  );
  if (!(insert as { affectedRows?: number }).affectedRows)
    return { queued: 0, duplicate: true };
  const [followers] = await connection.query<
    (RowDataPacket & { id: string })[]
  >(
    `SELECT follower_application_user_id id FROM user_follows
     WHERE followed_application_user_id = ?`,
    [input.hostUserId],
  );
  let queued = 0;
  for (const follower of followers) {
    queued += await queueCampaignJobs(connection, {
      campaignId,
      recipientUserId: follower.id,
    });
  }
  return { queued, duplicate: false };
}

export async function queueMasterPush(
  scope: Scope,
  input: {
    title: string;
    message: string;
    actionTarget?: string;
    targetPublicId?: string;
  },
) {
  assertMaster(scope);
  const title = input.title.trim().slice(0, 120);
  const message = input.message.trim().slice(0, 500);
  if (title.length < 2 || message.length < 3)
    throw new Error("Add a concise title and message.");
  const actionTarget = cleanActionTarget(input.actionTarget);
  return withTransaction(async (connection) => {
    let recipientUserId: string | undefined;
    let targetKey = "ALL";
    if (input.targetPublicId?.trim()) {
      const [users] = await connection.query<
        (RowDataPacket & { id: string })[]
      >(
        "SELECT id FROM application_users WHERE public_id = ? AND account_status = 'ACTIVE' LIMIT 1 FOR UPDATE",
        [input.targetPublicId.trim()],
      );
      if (!users[0]) throw new Error("That Nazraa user is unavailable.");
      recipientUserId = users[0].id;
      targetKey = `USER:${input.targetPublicId.trim()}`;
    }
    const campaignId = randomUUID();
    await connection.execute(
      `INSERT INTO mobile_push_campaigns
        (id, campaign_type, reference_key, title, message, action_target, payload, created_by_platform_account_id)
       VALUES (?, ?, ?, ?, ?, ?, JSON_OBJECT('kind', 'master'), ?)`,
      [
        campaignId,
        recipientUserId ? "MASTER_DIRECT" : "MASTER_BROADCAST",
        `MASTER:${scope.account.id}:${Date.now()}:${targetKey}`,
        title,
        message,
        actionTarget,
        scope.account.id,
      ],
    );
    const queued = await queueCampaignJobs(connection, {
      campaignId,
      recipientUserId,
    });
    return { campaignId, queued };
  });
}

function fcmConfiguration() {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const keyFilename = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  return projectId && keyFilename ? { projectId, keyFilename } : null;
}

async function sendFcm(job: PushJobRow): Promise<FcmSendResult> {
  const configuration = fcmConfiguration();
  if (!configuration)
    return { ok: false, retryable: false, code: "FCM_NOT_CONFIGURED" };
  try {
    const accessToken = await new GoogleAuth({
      keyFilename: configuration.keyFilename,
      scopes: [fcmScope],
    }).getAccessToken();
    if (!accessToken)
      return { ok: false, retryable: true, code: "FCM_AUTH_UNAVAILABLE" };
    const token = decryptPrivateText({
      encryptedData: job.token_encrypted,
      iv: job.token_iv,
      tag: job.token_tag,
    });
    const actionTarget = cleanActionTarget(job.action_target);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(configuration.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: job.title, body: job.message },
            data: {
              ...asData(job.payload),
              ...(actionTarget ? { actionTarget } : {}),
            },
            android: {
              priority: "high",
              notification: { channel_id: "nazraa_live", sound: "default" },
            },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      name?: string;
      error?: { status?: string; code?: number };
    } | null;
    if (response.ok && body?.name) return { ok: true, messageId: body.name };
    const code = String(
      body?.error?.status ?? body?.error?.code ?? `HTTP_${response.status}`,
    ).slice(0, 96);
    const invalid = code === "UNREGISTERED" || code === "INVALID_ARGUMENT";
    return {
      ok: false,
      retryable: !invalid && response.status >= 500,
      invalid,
      code,
    };
  } catch {
    return { ok: false, retryable: true, code: "FCM_TRANSPORT" };
  }
}

async function claimPushJob() {
  return withTransaction(async (connection) => {
    // Tokens can be invalidated between campaign enqueue and the worker
    // claim.  Retire their pending jobs so they never sit indefinitely in
    // the queue or become a misleading delivery failure.
    await connection.execute(
      `UPDATE mobile_push_jobs job
       INNER JOIN mobile_push_devices device ON device.id = job.device_id
       SET job.status = 'SKIPPED', job.failure_code = 'DEVICE_INACTIVE'
       WHERE job.status = 'PENDING' AND device.active = FALSE`,
    );
    const [rows] = await connection.query<PushJobRow[]>(
      `SELECT job.id, job.campaign_id, job.device_id,
              device.token_encrypted, device.token_iv, device.token_tag,
              campaign.title, campaign.message, campaign.action_target, campaign.payload
       FROM mobile_push_jobs job
       INNER JOIN mobile_push_devices device ON device.id = job.device_id AND device.active = TRUE
       INNER JOIN mobile_push_campaigns campaign ON campaign.id = job.campaign_id
       WHERE job.status = 'PENDING' AND job.available_at <= CURRENT_TIMESTAMP(3)
       ORDER BY job.created_at LIMIT 1 FOR UPDATE`,
    );
    const job = rows[0];
    if (!job) return null;
    await connection.execute(
      "UPDATE mobile_push_jobs SET status = 'PROCESSING', attempts = attempts + 1, claimed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [job.id],
    );
    return job;
  });
}

export async function processPendingPushNotifications(limit = 30) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (let count = 0; count < Math.max(1, Math.min(limit, 100)); count += 1) {
    const job = await claimPushJob();
    if (!job) break;
    const result = await sendFcm(job);
    await withTransaction(async (connection) => {
      if (result.ok) {
        await connection.execute(
          "UPDATE mobile_push_jobs SET status = 'SENT', sent_at = CURRENT_TIMESTAMP(3), fcm_message_id = ?, failure_code = NULL WHERE id = ?",
          [result.messageId, job.id],
        );
        await connection.execute(
          "INSERT INTO mobile_push_delivery_audits (id, job_id, event_type, provider_message_id) VALUES (?, ?, 'SENT', ?)",
          [randomUUID(), job.id, result.messageId],
        );
        sent += 1;
        return;
      }
      const failureCode = result.code;
      if (result.invalid) {
        await connection.execute(
          "UPDATE mobile_push_devices SET active = FALSE, invalidated_at = CURRENT_TIMESTAMP(3), invalid_reason = ? WHERE id = ?",
          [failureCode, job.device_id],
        );
        await connection.execute(
          "UPDATE mobile_push_jobs SET status = 'SKIPPED', failure_code = ? WHERE id = ?",
          [failureCode, job.id],
        );
        await connection.execute(
          "INSERT INTO mobile_push_delivery_audits (id, job_id, event_type, failure_code) VALUES (?, ?, 'INVALID_TOKEN', ?)",
          [randomUUID(), job.id, failureCode],
        );
        skipped += 1;
        return;
      }
      const [attemptRows] = await connection.query<
        (RowDataPacket & { attempts: number })[]
      >("SELECT attempts FROM mobile_push_jobs WHERE id = ? LIMIT 1", [job.id]);
      const retry =
        result.retryable &&
        (attemptRows[0]?.attempts ?? maxAttempts) < maxAttempts;
      if (retry) {
        await connection.execute(
          "UPDATE mobile_push_jobs SET status = 'PENDING', available_at = TIMESTAMPADD(SECOND, 20, CURRENT_TIMESTAMP(3)), failure_code = ? WHERE id = ?",
          [failureCode, job.id],
        );
        await connection.execute(
          "INSERT INTO mobile_push_delivery_audits (id, job_id, event_type, failure_code) VALUES (?, ?, 'RETRY', ?)",
          [randomUUID(), job.id, failureCode],
        );
      } else {
        await connection.execute(
          "UPDATE mobile_push_jobs SET status = 'FAILED', failure_code = ? WHERE id = ?",
          [failureCode, job.id],
        );
        await connection.execute(
          "INSERT INTO mobile_push_delivery_audits (id, job_id, event_type, failure_code) VALUES (?, ?, 'FAILED', ?)",
          [randomUUID(), job.id, failureCode],
        );
        failed += 1;
      }
    });
  }
  return { sent, failed, skipped, configured: fcmConfiguration() != null };
}
