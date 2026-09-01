import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { withTransaction } from "@/lib/db/transaction";

export async function actOnRoomSeat(identity: MobileIdentity, input: {
  roomCode: string; action: "request" | "accept" | "reject" | "assign" | "leave" | "lock" | "unlock";
  seatIndex?: number; targetPublicId?: string;
}) {
  return withTransaction(async (connection) => {
    const [rooms] = await connection.query<RowDataPacket[]>(
      `SELECT room.id, room.seat_count, member.room_role
       FROM live_rooms room INNER JOIN live_room_members member ON member.room_id = room.id
         AND member.application_user_id = ? AND member.left_at IS NULL
       WHERE room.room_code = ? AND room.room_type = 'PARTY' AND room.status IN ('ACTIVE','LOCKED') FOR UPDATE`,
      [identity.userId, input.roomCode]);
    const room = rooms[0];
    if (!room) throw new Error("Join this active Party room first.");
    await connection.execute("UPDATE live_room_members SET seat_index = NULL WHERE room_id = ? AND (left_at IS NOT NULL OR last_seen_at < CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE)", [room.id]);
    if (input.action === "leave") {
      await connection.execute("UPDATE live_room_members SET seat_index = NULL, muted = TRUE, room_role = IF(room_role = 'SPEAKER', 'AUDIENCE', room_role) WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      await connection.execute("UPDATE live_seat_requests SET status = 'EXPIRED' WHERE room_id = ? AND application_user_id = ?", [room.id, identity.userId]);
      return { status: "left" };
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
        await connection.execute("UPDATE live_room_members SET seat_index = ?, muted = FALSE WHERE room_id = ? AND application_user_id = ?", [index, room.id, identity.userId]);
        return { status: "accepted", seatIndex: index };
      }
      await connection.execute("INSERT INTO live_seat_requests (room_id, application_user_id, seat_index) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seat_index = VALUES(seat_index), status = 'PENDING', requested_at = CURRENT_TIMESTAMP(3)", [room.id, identity.userId, index]);
      return { status: "pending", seatIndex: index };
    }
    if (!["OWNER", "ADMIN"].includes(room.room_role)) throw new Error("Only the room owner or a room admin can decide mic requests.");
    if (input.action === "assign") {
      const index = input.seatIndex;
      if (index == null || !Number.isInteger(index) || index < 0 || index >= Number(room.seat_count)) throw new Error("Choose an available seat.");
      const [locked] = await connection.query<RowDataPacket[]>("SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ? LIMIT 1", [room.id, index]);
      if (locked.length) throw new Error("Unlock this seat before assigning a member.");
      const [targets] = await connection.query<RowDataPacket[]>(
        `SELECT user.id, member.room_role FROM live_room_members member
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
      await connection.execute(
        `UPDATE live_room_members
         SET room_role = IF(room_role = 'AUDIENCE', 'SPEAKER', room_role), seat_index = ?, muted = FALSE
         WHERE room_id = ? AND application_user_id = ?`,
        [index, room.id, target.id],
      );
      await connection.execute(
        "UPDATE live_seat_requests SET status = 'ACCEPTED', seat_index = ? WHERE room_id = ? AND application_user_id = ?",
        [index, room.id, target.id],
      );
      return { status: "accepted", seatIndex: index, targetPublicId: String(input.targetPublicId) };
    }
    const [requests] = await connection.query<RowDataPacket[]>(
      `SELECT request.application_user_id, request.seat_index FROM live_seat_requests request
       INNER JOIN application_users user ON user.id = request.application_user_id AND user.account_status = 'ACTIVE'
       INNER JOIN live_room_members member ON member.room_id = request.room_id AND member.application_user_id = user.id
       WHERE request.room_id = ? AND user.public_id = ? AND request.status = 'PENDING'
         AND request.requested_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE
         AND member.left_at IS NULL AND member.last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE`,
      [room.id, input.targetPublicId ?? ""]);
    const request = requests[0];
    if (!request) throw new Error("This mic request has expired or is no longer pending.");
    if (input.action === "accept") {
      const [locked] = await connection.query<RowDataPacket[]>("SELECT seat_index FROM live_room_seat_locks WHERE room_id = ? AND seat_index = ? LIMIT 1", [room.id, request.seat_index]);
      if (locked.length) throw new Error("Unlock this seat before accepting the request.");
      const [occupied] = await connection.query<RowDataPacket[]>("SELECT application_user_id FROM live_room_members WHERE room_id = ? AND seat_index = ? AND application_user_id != ? AND left_at IS NULL", [room.id, request.seat_index, request.application_user_id]);
      if (occupied.length) throw new Error("That seat was taken. Ask the user to choose another seat.");
      await connection.execute("UPDATE live_room_members SET room_role = IF(room_role = 'AUDIENCE', 'SPEAKER', room_role), seat_index = ?, muted = FALSE WHERE room_id = ? AND application_user_id = ?", [request.seat_index, room.id, request.application_user_id]);
    }
    await connection.execute("UPDATE live_seat_requests SET status = ? WHERE room_id = ? AND application_user_id = ?", [input.action === "accept" ? "ACCEPTED" : "REJECTED", room.id, request.application_user_id]);
    return { status: input.action === "accept" ? "accepted" : "rejected" };
  });
}
