import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createClient } from "redis";
import { WebSocket } from "ws";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("Set REDIS_URL to private QA Redis.");
const validToken = "q".repeat(43);
const invalidToken = "z".repeat(43);
const roomCode = "qa_realtime_room";
const internalSecret = "s".repeat(32);

function waitForMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${type} timed out`)), 5000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== type) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:3100/health", {
        signal: AbortSignal.timeout(300),
      });
      if (response.ok) return;
    } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Realtime server did not become healthy.");
}

async function connect(token) {
  const socket = new WebSocket("ws://127.0.0.1:3100/realtime", {
    headers: { authorization: `Bearer ${token}` },
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

const api = createServer((request, response) => {
  if (request.url !== "/api/internal/realtime/authorize" ||
      request.headers["x-nazraa-internal-key"] !== internalSecret ||
      request.headers.authorization !== `Bearer ${validToken}`) {
    response.writeHead(403).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ roomCode, roomId: "qa", userId: "qa" }));
});
await new Promise((resolve) => api.listen(3001, "127.0.0.1", resolve));
const realtime = spawn(process.execPath, ["deploy/vps/realtime.mjs"], {
  env: {
    ...process.env,
    REALTIME_API_ORIGIN: "http://127.0.0.1:3001",
    REALTIME_INTERNAL_SECRET: internalSecret,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let serverError = "";
realtime.stderr.on("data", (chunk) => { serverError += chunk.toString().slice(0, 512); });
const publisher = createClient({ url: redisUrl });
publisher.on("error", () => {});
try {
  await waitForHealth();
  await publisher.connect();
  const accepted = await connect(validToken);
  const ready = waitForMessage(accepted, "ROOM_READY");
  accepted.send(JSON.stringify({ op: "subscribe", roomCode }));
  assert.equal((await ready).roomCode, roomCode);
  const changed = waitForMessage(accepted, "ROOM_CHANGED");
  await publisher.publish(`room:${roomCode}`, JSON.stringify({
    type: "ROOM_CHANGED", roomCode, topic: "seat",
  }));
  assert.equal((await changed).topic, "seat");
  accepted.close();

  const denied = await connect(invalidToken);
  const closed = new Promise((resolve) => denied.once("close", resolve));
  denied.send(JSON.stringify({ op: "subscribe", roomCode }));
  assert.equal(await closed, 1008);
  console.log("PASS authenticated WebSocket subscribe, Redis delivery, denial");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Realtime QA failed.");
  if (serverError) console.error("Realtime child reported a startup error.");
  process.exitCode = 1;
} finally {
  await publisher.quit().catch(() => undefined);
  if (realtime.exitCode === null) {
    realtime.kill("SIGTERM");
    await new Promise((resolve) => realtime.once("exit", resolve));
  }
  await new Promise((resolve) => api.close(resolve));
}
