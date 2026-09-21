import "server-only";
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { withTransaction } from "@/lib/db/transaction";

type SeatMember = RowDataPacket & {
  application_user_id?: string;
  seat_index: number | null;
  seat_session_id: string | null;
  seat_version: number;
  muted?: boolean;
  room_role?: string;
};

function seatState(member: SeatMember | undefined) {
  return member?.seat_index == null ? "UNSEATED" : "SEATED";
}

async function recordSeatTransition(
  connection: PoolConnection,
  input: {
    roomId: string;
    userId: string;
    seatIndex: number | null;
    seatSessionId: string | null;
    seatVersion: number;
    previousState: string;
    nextState: string;
    desiredMicState: string;
    eventSource: string;
    terminationReason?: string | null;
  },
) {
  await connection.execute(
    `INSERT INTO live_room_seat_transitions
      (id, room_id, application_user_id, seat_index, seat_session_id, seat_version,
       previous_state, next_state, desired_mic_state, event_source, termination_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.roomId,
      input.userId,
      input.seatIndex,
      input.seatSessionId,
      input.seatVersion,
      input.previousState,
      input.nextState,
      input.desiredMicState,
      input.eventSource,
      input.terminationReason ?? null,
    ],
  );
}

function expectedSeatMatches(
  member: SeatMember,
  expectedSessionId?: string,
  expectedVersion?: number,
) {
  if (expectedSessionId && member.seat_session_id !== expectedSessionId) {
    return false;
  }
  return expectedVersion == null || Number(member.seat_version) === expectedVersion;
}

async function assignSeat(
  connection: PoolConnection,
  input: {
    roomId: string;
    userId: string;
    seatIndex: number;
    eventSource: string;
    member: SeatMember;
  },
) {
  const previousState = seatState(input.member);
  const previousSeat = input.member.seat_index;
  const previousVersion = Number(input.member.seat_version ?? 0);
  const seatSessionId = randomUUID();
  const seatVersion = previousVersion + 1;
  await connection.execute(
    `UPDATE live_room_members
        SET room_role = IF(room_role = 'AUDIENCE', 'SPEAKER', room_role),
            media_role = IF(room_role = 'OWNER', 'PARTY_OWNER', 'RTC_SPEAKER'),
            seat_index = ?, seat_session_id = ?, seat_version = ?, muted = FALSE,
            media_publishing = FALSE
      WHERE room_id = ? AND application_user_id = ?`,
    [input.seatIndex, seatSessionId, seatVersion, input.roomId, input.userId],
  );
  if (previousSeat != null && previousSeat !== input.seatIndex) {
    await recordSeatTransition(connection, {
      roomId: input.roomId,
      userId: input.userId,
      seatIndex: previousSeat,
      seatSessionId: input.member.seat_session_id,
      seatVersion: previousVersion,
      previousState,
      nextState: "UNSEATED",
      desiredMicState: "MUTED",
      eventSource: input.eventSource,
      terminationReason: "SEAT_REASSIGNED_BY_SERVER",
    });
  }
  await recordSeatTransition(connection, {
    roomId: input.roomId,
    userId: input.userId,
    seatIndex: input.seatIndex,
    seatSessionId,
    seatVersion,
    previousState,
    nextState: "SEATED",
    desiredMicState: "MIC_ON",
    eventSource: input.eventSource,
  });
  return { seatSessionId, seatVersion };
}

export async function actOnRoomSeat(identity: MobileIdentity, input: {
  roomCode: string; action: "request" | "accept" | "reject" | "assign" | "leave" | "lock" | "unlock";
  seatIndex?: number; targetPublicId?: string; seatSessionId?: string; seatVersion?: number;
}) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<RowDataPacket[]>(
      `SELECT room.id, room.seat_count, member.room_role, member.seat_index,
              member.seat_session_id, member.seat_version, member.muted
       FROM live_rooms room INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.room_type = 'PARTY' AND room.status IN ('ACTIVE','LOCKED') FOR UPDATE`,
      [identity.userId, input.roomCode]);
    const room = rooms[0];
    if (!room) throw new Error("Join this active Party room first.");
    // A seat ends only through an authoritative terminal room action.  A
    // momentary heartbeat/socket/LiveKit loss is recovery state, not absence.
    await connection.execute(
      `UPDATE live_room_members SET seat_index = NULL, seat_session_id = NULL,
         seat_version = seat_version + 1, muted = TRUE, media_publishing = FALSE,
         room_role = IF(room_role = 'SPEAKER', 'AUDIENCE', room_role),
         media_role = CASE WHEN room_role = 'OWNER' THEN 'PARTY_OWNER' ELSE 'PASSIVE_LISTENER' END
       WHERE room_id = ? AND left_at IS NOT NULL AND seat_index IS NOT NULL`,
      [room.id],
    );
    if (input.action === "leave") {
      if (!expectedSeatMatches(room as SeatMember, input.seatSessionId, input.seatVersion)) {
        return { status: "stale_ignored", seatIndex: room.seat_index, seatSessionId: room.seat_session_id, seatVersion: Number(room.seat_version) };
      }
      const prior = room as SeatMember;
      const nextVersion = Number(prior.seat_version ?? 0) + 1;
      await connection.execute("UPDATE live_room_members SET seat_index = NULL, seat_session_id = NULL, seat_version = ?, muted = TRUE, media_publishing = FALSE, room_role = IF(room_role = 'SPEAKER', 'AUDIENCE', room_role), media_role = IF(room_role = 'OWNER', 'PARTY_OWNER', 'PASSIVE_LISTENER') WHERE room_id = ? AND application_user_id = ?", [nextVersion, room.id, identity.userId]);
      await connection.execute("UPDATE live_seat_requests SET status = 'EXPIRED' WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      await connection.execute("UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ? AND can_publish = TRUE", [room.id, identity.userId]);
      await connection.execute("UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE room_id = ? AND application_user_id = ? AND usage_type = 'PARTY_SPEAKER_RTC'", [room.id, identity.userId]);
      await recordSeatTransition(connection, {
        roomId: String(room.id), userId: identity.userId, seatIndex: prior.seat_index,
        seatSessionId: prior.seat_session_id, seatVersion: nextVersion,
        previousState: seatState(prior), nextState: "UNSEATED", desiredMicState: "MUTED",
        eventSource: "ROOM_SEAT_LEAVE", terminationReason: "USER_LEFT_SEAT",
      });
      return { status: "left", seatVersion: nextVersion };
    }
    if (input.action === "lock" || input.action === "unlock") {
      if (!["OWNER", "ADMIN"].includes(room.room_role)) throw new Error("Only the Room Owner or a Room Admin can lock seats.");
      const index = input.seatIndex;
      if (index == null || !Number.isInteger(index) || index < 0 || index >= Number(room.seat_count)) throw new Error("Choose a valid seat.");
      if (input.action === "lock") {
        const [occupied] = await connection.query<RowDataPacket[]>(
          "SELECT application_user_id FROM live_room_members WHERE room_id = ? AND seat_index = ? AND left_at IS NULL LIMIT 1",
          [room.id, index],
        );
        if (occupied.length) throw new Error("Remove the speaker before locking this seat.");
        await connection.execute(
          `INSERT INTO live_room_seat_locks (room_id, seat_index, locked_by_application_user_id)
           VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE locked_by_application_user_id = VALUES(locked_by_application_user_id), created_at = CURRENT_TIMESTAMP(3)`,
          [room.id, index, identity.userId],
        );
        await connection.execute("UPDATE live_seat_requests SET status = 'REJECTED' WHERE room_id = ? AND seat_index = ? AND status = 'PENDING'", [room.id, index]);
        await connection.execute("UPDATE live_room_members member INNER JOIN live_seat_requests request ON request.room_id = member.room_id AND request.application_user_id = member.application_user_id SET member.media_role = 'PASSIVE_LISTENER' WHERE request.room_id = ? AND request.seat_index = ? AND request.status = 'REJECTED' AND member.room_role = 'AUDIENCE'", [room.id, index]);
      } else {
        await connection.execute("DELETE FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ?", [room.id, index]);
      }
      return { status: input.action === "lock" ? "locked" : "unlocked", seatIndex: index };
    }
    if (input.action === "request") {
      const index = input.seatIndex;
      if (index == null || !Number.isInteger(index) || index < 0 || index >= Number(room.seat_count)) throw new Error("Choose an available seat.");
      const [locked] = await connection.query<RowDataPacket[]>("SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ? LIMIT 1", [room.id, index]);
      if (locked.length) throw new Error("That seat is locked by room staff.");
      const [occupied] = await connection.query<RowDataPacket[]>("SELECT application_user_id FROM live_room_members WHERE room_id = ? AND seat_index = ? AND application_user_id != ? AND left_at IS NULL", [room.id, index, identity.userId]);
      if (occupied.length) throw new Error("That seat is already reserved. Choose another seat.");
      if (["OWNER", "ADMIN"].includes(room.room_role)) {
        const assignment = await assignSeat(connection, {
          roomId: String(room.id), userId: identity.userId, seatIndex: index,
          eventSource: "ROOM_SEAT_SELF_ASSIGN", member: room as SeatMember,
        });
        return { status: "accepted", seatIndex: index, ...assignment };
      }
      await connection.execute("INSERT INTO live_seat_requests (room_id, application_user_id, seat_index) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seat_index = VALUES(seat_index), status = 'PENDING', requested_at = CURRENT_TIMESTAMP(3)", [room.id, identity.userId, index]);
      await connection.execute("UPDATE live_room_members SET media_role = 'MIC_REQUESTED', media_publishing = FALSE WHERE room_id = ? AND application_user_id = ? AND room_role = 'AUDIENCE'", [room.id, identity.userId]);
      return { status: "pending", seatIndex: index };
    }
    if (!["OWNER", "ADMIN"].includes(room.room_role)) throw new Error("Only the room owner or a room admin can decide mic requests.");
    if (input.action === "assign") {
      const index = input.seatIndex;
      if (index == null || !Number.isInteger(index) || index < 0 || index >= Number(room.seat_count)) throw new Error("Choose an available seat.");
      const [locked] = await connection.query<RowDataPacket[]>("SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ? LIMIT 1", [room.id, index]);
      if (locked.length) throw new Error("Unlock this seat before assigning a member.");
      const [targets] = await connection.query<RowDataPacket[]>(
        `SELECT user.id, member.room_role, member.seat_index, member.seat_session_id, member.seat_version, member.muted FROM live_room_members member
         INNER JOIN application_users user ON user.id = member.application_user_id
         WHERE member.room_id = ? AND member.left_at IS NULL
           AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
           AND user.account_status = 'ACTIVE' AND user.public_id = ? LIMIT 1 FOR UPDATE`,
        [room.id, input.targetPublicId ?? ""],
      );
      const target = targets[0];
      if (!target) throw new Error("Choose a member who is currently in this room.");
      const [occupied] = await connection.query<RowDataPacket[]>(
        "SELECT application_user_id FROM live_room_members WHERE room_id = ? AND seat_index = ? AND application_user_id != ? AND left_at IS NULL",
        [room.id, index, target.id],
      );
      if (occupied.length) throw new Error("That seat is already reserved. Choose another seat.");
      const assignment = await assignSeat(connection, {
        roomId: String(room.id), userId: String(target.id), seatIndex: index,
        eventSource: "ROOM_SEAT_HOST_ASSIGN", member: target as SeatMember,
      });
      await connection.execute(
        "UPDATE live_seat_requests SET status = 'ACCEPTED', seat_index = ? WHERE room_id = ? AND application_user_id = ?",
        [index, room.id, target.id],
      );
      return { status: "accepted", seatIndex: index, targetPublicId: String(input.targetPublicId), ...assignment };
    }
    const [requests] = await connection.query<RowDataPacket[]>(
      `SELECT request.application_user_id, request.seat_index, member.seat_index current_seat_index,
              member.seat_session_id, member.seat_version, member.muted, member.room_role FROM live_seat_requests request
       INNER JOIN application_users user ON user.id = request.application_user_id AND user.account_status = 'ACTIVE'
       INNER JOIN live_room_members member ON member.room_id = request.room_id AND member.application_user_id = user.id
       WHERE request.room_id = ? AND user.public_id = ? AND request.status = 'PENDING'
         AND request.requested_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
         AND member.left_at IS NULL AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
       FOR UPDATE`,
      [room.id, input.targetPublicId ?? ""]);
    const request = requests[0];
    if (!request) throw new Error("This mic request has expired or is no longer pending.");
    if (input.action === "accept") {
      const [locked] = await connection.query<RowDataPacket[]>("SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ? LIMIT 1", [room.id, request.seat_index]);
      if (locked.length) throw new Error("Unlock this seat before accepting the request.");
      const [occupied] = await connection.query<RowDataPacket[]>("SELECT application_user_id FROM live_room_members WHERE room_id = ? AND seat_index = ? AND application_user_id != ? AND left_at IS NULL", [room.id, request.seat_index, request.application_user_id]);
      if (occupied.length) throw new Error("That seat was taken. Ask the user to choose another seat.");
      await assignSeat(connection, {
        roomId: String(room.id), userId: String(request.application_user_id), seatIndex: Number(request.seat_index),
        eventSource: "ROOM_SEAT_REQUEST_ACCEPT", member: {
          ...request,
          seat_index: request.current_seat_index,
        } as SeatMember,
      });
    }
    await connection.execute("UPDATE live_seat_requests SET status = ? WHERE room_id = ? AND application_user_id = ?", [input.action === "accept" ? "ACCEPTED" : "REJECTED", room.id, request.application_user_id]);
    if (input.action === "reject") {
      await connection.execute("UPDATE live_room_members SET media_role = 'PASSIVE_LISTENER', media_publishing = FALSE WHERE room_id = ? AND application_user_id = ? AND room_role = 'AUDIENCE'", [room.id, request.application_user_id]);
    }
    return { status: input.action === "accept" ? "accepted" : "rejected" };
  });
}
