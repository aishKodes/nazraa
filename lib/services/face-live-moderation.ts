import "server-only";
import { randomUUID } from "node:crypto";
import { createFaceLiveSuspension } from "@/lib/db/repositories/operations";
import { finalizeLiveSession } from "@/lib/db/repositories/mobile-completion";
import { withTransaction } from "@/lib/db/transaction";
import { LiveKitRoomAdmin } from "@/lib/services/livekit-room-admin";
import { publishRoomRealtimeEvent } from "@/lib/services/room-realtime-events";

/** One workflow shared by Control forms and the authenticated moderation API. */
export async function suspendFaceLiveAndStopMedia(input: Parameters<typeof createFaceLiveSuspension>[0]) {
  const result = await createFaceLiveSuspension(input);
  let mediaEnded = true;
  let accountingFinalized = true;
  const admin = new LiveKitRoomAdmin();
  if (result.activeRoomCode) {
    await publishRoomRealtimeEvent(result.activeRoomCode, "room-ended");
    try { await admin.endRoom(result.activeRoomCode); } catch { mediaEnded = false; }
    try { await finalizeLiveSession({ userId: result.userId }, result.activeRoomCode); }
    catch { accountingFinalized = false; }
  }
  for (const roomCode of result.activeGuestRoomCodes) {
    await publishRoomRealtimeEvent(roomCode, "seat");
    try { await admin.disconnectParticipant(roomCode, result.publicId); } catch { mediaEnded = false; }
  }
  await withTransaction(async connection => {
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, new_data, reason)
       VALUES (?, ?, ?, 'moderation.face_live_shutdown', 'moderation', 'application_user', ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, result.userId,
        JSON.stringify({ restrictionId: result.restrictionId, roomCode: result.activeRoomCode,
          mediaEnded, accountingFinalized, pushDelivery: result.pushDelivery }), input.reason],
    );
  }).catch(() => undefined); // The moderation decision audit is already committed.
  return { result, mediaEnded, accountingFinalized };
}
