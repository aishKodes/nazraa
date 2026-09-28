import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { publishRoomRealtimeEvent } from "@/lib/services/room-realtime-events";

async function main() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("Set REDIS_URL to the private staging Redis.");
  const roomCode = `qa_${randomUUID().replaceAll("-", "")}`;
  const subscriber = createClient({ url });
  subscriber.on("error", () => {});
  await subscriber.connect();
  try {
    const received = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Room event was not delivered.")), 3000);
      void subscriber.subscribe(`room:${roomCode}`, (payload) => {
        clearTimeout(timeout);
        resolve(JSON.parse(payload));
      }).then(() => publishRoomRealtimeEvent(roomCode, "seat"), reject);
    });
    const event = await received;
    assert.equal((event as { type?: string }).type, "ROOM_CHANGED");
    assert.equal((event as { roomCode?: string }).roomCode, roomCode);
    assert.equal((event as { topic?: string }).topic, "seat");
    console.log("PASS private Redis room invalidation delivery");
  } finally {
    await subscriber.quit().catch(() => undefined);
  }
}

main().then(() => process.exit(0)).catch(() => {
  console.error("FAIL private Redis room invalidation delivery");
  process.exit(1);
});
