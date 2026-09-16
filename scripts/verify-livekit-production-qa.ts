/**
 * Safe production smoke test for the reviewer-only LiveKit rollout.
 *
 * This uses only the durable Play reviewer accounts and creates uniquely named
 * disposable QA rooms which it closes in a finally block. It creates two
 * short-lived, database-backed reviewer sessions locally so production secrets
 * and reviewer passwords never need to leave their protected stores. It
 * intentionally prints no token, API key, secret, password, response payload,
 * reviewer identity, or room id.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { decodeJwt } from "jose";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

process.loadEnvFile(process.env.LIVEKIT_QA_ENV_FILE ?? ".env.production.local");

const base = "https://nazraa.vercel.app/api/v1/mobile";

function required<T>(value: T | null | undefined, code: string): T {
  if (!value) throw new Error(code);
  return value;
}

async function api(path: string, input: { token?: string; body?: unknown; method?: string } = {}) {
  const response = await fetch(`${base}/${path}`, {
    method: input.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  if (!response.ok) throw new Error(`${path}:HTTP_${response.status}`);
  return response.status === 204 ? {} : await response.json() as Record<string, unknown>;
}

async function requestStatus(path: string, token: string, body: unknown) {
  return fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function tokenClaims(token: string) {
  // The token is returned by the authenticated production endpoint over TLS.
  // We inspect its public role claims here; LiveKit itself verifies the HS256
  // signature during the companion device/media QA without exposing the
  // server-side signing secret to this script.
  return decodeJwt(token) as Record<string, unknown>;
}

function videoClaims(claims: Record<string, unknown>) {
  return required(claims.video as Record<string, unknown> | undefined, "VIDEO_GRANT_MISSING");
}

function memberId(state: Record<string, unknown>, name: string) {
  const participants = Array.isArray(state.participants) ? state.participants as Array<Record<string, unknown>> : [];
  const member = participants.find((candidate) => candidate.user && typeof candidate.user === "object" && (candidate.user as Record<string, unknown>).name === name);
  const user = member?.user as Record<string, unknown> | undefined;
  return required(user?.id, "REVIEWER_MEMBER_MISSING") as string;
}

type ReviewerRole = "HOST" | "VIEWER";

type QaSession = {
  id: string;
  token: string;
};

function productionPool(): Pool {
  return mysql.createPool({
    host: required(process.env.DB_HOST, "DB_HOST_MISSING") as string,
    port: Number(process.env.DB_PORT ?? 3306),
    database: required(process.env.DB_NAME, "DB_NAME_MISSING") as string,
    user: required(process.env.DB_USER, "DB_USER_MISSING") as string,
    password: required(process.env.DB_PASSWORD, "DB_PASSWORD_MISSING") as string,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    connectionLimit: 1,
  });
}

async function createQaSession(pool: Pool, role: ReviewerRole): Promise<QaSession> {
  const [reviewers] = await pool.query<(RowDataPacket & { application_user_id: string })[]>(
    `SELECT credential.application_user_id
       FROM play_reviewer_credentials credential
       INNER JOIN application_users user ON user.id = credential.application_user_id
       INNER JOIN mobile_access_overrides access_override ON access_override.application_user_id = user.id
      WHERE credential.reviewer_role = ?
        AND credential.active = TRUE
        AND user.account_status = 'ACTIVE'
        AND access_override.play_reviewer_access_override = TRUE
      ORDER BY credential.created_at
      LIMIT 1`,
    [role],
  );
  const reviewer = reviewers[0];
  if (!reviewer) throw new Error(`REVIEWER_${role}_MISSING`);
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await pool.execute(
    `INSERT INTO mobile_sessions
       (id, application_user_id, token_hash, device_label, expires_at)
     VALUES (?, ?, ?, 'LiveKit production API QA', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 20 MINUTE))`,
    [id, reviewer.application_user_id, createHash("sha256").update(token).digest("hex")],
  );
  return { id, token };
}

async function revokeQaSessions(pool: Pool, sessions: QaSession[]) {
  if (!sessions.length) return;
  await pool.query(
    `UPDATE mobile_sessions
        SET revoked_at = CURRENT_TIMESTAMP(3), revoked_reason = 'LIVEKIT_QA_COMPLETE'
      WHERE id IN (${sessions.map(() => "?").join(", ")})
        AND revoked_at IS NULL`,
    sessions.map((session) => session.id),
  );
}

async function main() {
  if (process.env.LIVEKIT_PRODUCTION_QA !== "true") {
    throw new Error("LIVEKIT_PRODUCTION_QA_CONFIRMATION_REQUIRED");
  }
  const pool = productionPool();
  const qaSessions: QaSession[] = [];
  let host = "";
  let viewer = "";
  let faceRoom = "";
  let partyRoom = "";
  let faceOpen = false;
  let partyOpen = false;

  try {
    const hostSession = await createQaSession(pool, "HOST");
    qaSessions.push(hostSession);
    const viewerSession = await createQaSession(pool, "VIEWER");
    qaSessions.push(viewerSession);
    host = hostSession.token;
    viewer = viewerSession.token;
    const suffix = Date.now().toString(36).toUpperCase();
    faceRoom = `LKF${suffix}`.slice(0, 24);
    partyRoom = `LKP${suffix}`.slice(0, 24);
    await api("rooms", { token: host, body: { roomCode: faceRoom, kind: "face", title: "LiveKit Face QA", category: "QA", language: "en", privacy: "public", seatCount: 0, themeIndex: 0, themeEnabled: false } });
    faceOpen = true;
    const presence = await api("room-presence", { token: host, body: { roomCode: faceRoom, mediaPublishing: true } });
    const media = required(presence.mediaDelivery as Record<string, unknown> | undefined, "FACE_MEDIA_DELIVERY_MISSING");
    required(media.provider === "LIVEKIT" && media.mode === "liveKit", "FACE_NOT_LIVEKIT");
    required(presence.liveRewardProgress, "LIVE_REWARD_LEDGER_MISSING");

    const hostToken = await api("livekit-token", { token: host, body: { roomId: faceRoom, publish: true } });
    const hostVideo = videoClaims(tokenClaims(required(hostToken.participantToken, "HOST_TOKEN_MISSING") as string));
    required(hostVideo.canPublish === true && Array.isArray(hostVideo.canPublishSources) && hostVideo.canPublishSources.includes("camera") && hostVideo.canPublishSources.includes("microphone"), "HOST_SCOPE_INVALID");

    const join = await api("room-join", { token: viewer, body: { roomCode: faceRoom, includeMediaBootstrap: true } });
    const bootstrap = required(join.mediaBootstrap as Record<string, unknown> | undefined, "VIEWER_BOOTSTRAP_MISSING");
    const viewerMedia = required(bootstrap.mediaDelivery as Record<string, unknown> | undefined, "VIEWER_MEDIA_MISSING");
    required(viewerMedia.provider === "LIVEKIT", "VIEWER_NOT_LIVEKIT");
    const viewerToken = await api("livekit-token", { token: viewer, body: { roomId: faceRoom, publish: false } });
    const viewerVideo = videoClaims(tokenClaims(required(viewerToken.participantToken, "VIEWER_TOKEN_MISSING") as string));
    required(viewerVideo.canPublish === false && Array.isArray(viewerVideo.canPublishSources) && viewerVideo.canPublishSources.length === 0, "VIEWER_SCOPE_INVALID");

    const members = await api("room-presence", { token: host, body: { roomCode: faceRoom, mediaPublishing: true } });
    const viewerId = memberId(members, "Google Play Reviewer Viewer");
    await api("room-chat", { token: viewer, body: { roomCode: faceRoom, body: "LiveKit reviewer QA chat", clientMessageId: crypto.randomUUID() } });
    await api("live-cohost-request", { token: viewer, body: { roomCode: faceRoom } });
    await api("live-cohost-response", { token: host, body: { roomCode: faceRoom, targetPublicId: viewerId, accept: true } });
    const guestToken = await api("livekit-token", { token: viewer, body: { roomId: faceRoom, publish: true } });
    const guestVideo = videoClaims(tokenClaims(required(guestToken.participantToken, "GUEST_TOKEN_MISSING") as string));
    required(guestVideo.canPublish === true && Array.isArray(guestVideo.canPublishSources) && guestVideo.canPublishSources.length === 1 && guestVideo.canPublishSources[0] === "microphone", "AUDIO_GUEST_SCOPE_INVALID");
    const recovered = await api("room-presence", { token: host, body: { roomCode: faceRoom, mediaPublishing: false, runtimeDiagnostics: { connectionPhase: "reconnecting", reconnectCount: 1, publishing: false, playbackActive: false, lastTerminalErrorCategory: null, activeSpeakers: 1, passiveViewers: 0, animationQueueLength: 0, messageDeliveryLatencyMs: 0 } } });
    const resumed = await api("room-presence", { token: host, body: { roomCode: faceRoom, mediaPublishing: true, runtimeDiagnostics: { connectionPhase: "connected", reconnectCount: 1, publishing: true, playbackActive: false, lastTerminalErrorCategory: null, activeSpeakers: 1, passiveViewers: 0, animationQueueLength: 0, messageDeliveryLatencyMs: 0 } } });
    required(recovered.liveRewardProgress && resumed.liveRewardProgress, "RECONNECT_LEDGER_INVALID");
    await api("live-end", { token: host, body: { roomCode: faceRoom } });
    faceOpen = false;

    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWNQMIz4TwlmGDXg/2gYRIyGgeGwCAMAFHSoEDJSeRoAAAAASUVORK5CYII=";
    await api("rooms", { token: host, body: { roomCode: partyRoom, kind: "party", title: "LiveKit Party QA", category: "QA", language: "en", privacy: "public", seatCount: 6, themeIndex: 0, themeEnabled: true, photoDataUrl: pixel } });
    partyOpen = true;
    await api("room-presence", { token: host, body: { roomCode: partyRoom, mediaPublishing: true } });
    const partyHostToken = await api("livekit-token", { token: host, body: { roomId: partyRoom, publish: true } });
    const partyHostVideo = videoClaims(tokenClaims(required(partyHostToken.participantToken, "PARTY_HOST_TOKEN_MISSING") as string));
    required(Array.isArray(partyHostVideo.canPublishSources) && partyHostVideo.canPublishSources.length === 1 && partyHostVideo.canPublishSources[0] === "microphone", "PARTY_HOST_SCOPE_INVALID");
    await api("room-join", { token: viewer, body: { roomCode: partyRoom, includeMediaBootstrap: true } });
    const passiveToken = await api("livekit-token", { token: viewer, body: { roomId: partyRoom, publish: false } });
    required(videoClaims(tokenClaims(required(passiveToken.participantToken, "PARTY_VIEWER_TOKEN_MISSING") as string)).canPublish === false, "PARTY_LISTENER_SCOPE_INVALID");
    const partyMembers = await api("room-presence", { token: host, body: { roomCode: partyRoom, mediaPublishing: true } });
    const partyViewerId = memberId(partyMembers, "Google Play Reviewer Viewer");
    await api("room-seat", { token: viewer, body: { roomCode: partyRoom, action: "request", seatIndex: 0 } });
    await api("room-seat", { token: host, body: { roomCode: partyRoom, action: "accept", targetPublicId: partyViewerId } });
    const speakerToken = await api("livekit-token", { token: viewer, body: { roomId: partyRoom, publish: true } });
    const speakerVideo = videoClaims(tokenClaims(required(speakerToken.participantToken, "SPEAKER_TOKEN_MISSING") as string));
    required(Array.isArray(speakerVideo.canPublishSources) && speakerVideo.canPublishSources.length === 1 && speakerVideo.canPublishSources[0] === "microphone", "SPEAKER_SCOPE_INVALID");
    await api("room-seat", { token: viewer, body: { roomCode: partyRoom, action: "leave" } });
    required(!(await requestStatus("livekit-token", viewer, { roomId: partyRoom, publish: true })).ok, "SPEAKER_DEMOTION_FAILED");
    await api("room-kick", { token: host, body: { roomCode: partyRoom, targetPublicId: partyViewerId, reason: "LiveKit QA kick/unblock" } });
    required(!(await requestStatus("room-join", viewer, { roomCode: partyRoom })).ok, "KICK_BLOCK_FAILED");
    await api("room-blocks", { token: host, body: { roomCode: partyRoom, targetPublicId: partyViewerId } });
    const rejoined = await api("room-join", { token: viewer, body: { roomCode: partyRoom } });
    required(rejoined.mediaRole === "passive_listener", "UNBLOCK_REJOIN_FAILED");
    console.log("FACE_API_PASS VIEWER_SCOPE_PASS AUDIO_GUEST_SCOPE_PASS CHAT_PASS RECONNECT_LEDGER_PASS PARTY_API_PASS SPEAKER_PROMOTION_PASS SPEAKER_DEMOTION_PASS KICK_UNBLOCK_PASS");
  } finally {
    try {
      if (faceOpen && host) await api("live-end", { token: host, body: { roomCode: faceRoom } }).catch(() => undefined);
      if (partyOpen && host) await api("live-end", { token: host, body: { roomCode: partyRoom } }).catch(() => undefined);
    } finally {
      await revokeQaSessions(pool, qaSessions).catch(() => undefined);
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LIVEKIT_PRODUCTION_QA_FAILED");
  process.exitCode = 1;
});
