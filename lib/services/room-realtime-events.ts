import { createClient, type RedisClientType } from "redis";

/**
 * Best-effort invalidations only. MySQL remains authoritative and the client
 * reconciles through the existing room API after an event or reconnect.
 * Never put chat, financial details, or bearer tokens on the Redis channel.
 */
export type RoomRealtimeTopic =
  | "presence"
  | "seat"
  | "chat"
  | "gift"
  | "pk"
  | "game"
  | "settings"
  | "room-ended";

let publisher: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

async function connectedPublisher(): Promise<RedisClientType | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) return undefined; // Vercel remains operational until cutover.
  if (publisher?.isReady) return publisher;
  if (!connecting) {
    const client = createClient({ url, socket: { connectTimeout: 1500 } });
    client.on("error", () => {
      // The next authoritative HTTP snapshot remains the recovery path.
    });
    connecting = client.connect().then(() => {
      publisher = client as RedisClientType;
      return publisher;
    }).catch(async () => {
      await client.disconnect().catch(() => undefined);
      throw new Error("Realtime publish unavailable");
    }).finally(() => { connecting = undefined; });
  }
  return connecting;
}

export async function publishRoomRealtimeEvent(
  roomCode: string,
  topic: RoomRealtimeTopic,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(roomCode)) return;
  try {
    const client = await connectedPublisher();
    if (!client) return;
    await client.publish(
      `room:${roomCode}`,
      JSON.stringify({ type: "ROOM_CHANGED", roomCode, topic, serverNow: Date.now() }),
    );
  } catch {
    // Realtime delivery must never turn a committed Gift, bet or chat into an
    // apparent failure that a client might retry. HTTP reconciliation remains.
  }
}
