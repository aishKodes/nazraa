import { createServer } from "node:http";
import { createClient } from "redis";
import { WebSocket, WebSocketServer } from "ws";

const redisUrl = process.env.REDIS_URL;
const internalSecret = process.env.REALTIME_INTERNAL_SECRET;
const apiOrigin = process.env.REALTIME_API_ORIGIN || "http://api:3000";
if (!redisUrl || !internalSecret || internalSecret.length < 32) {
  throw new Error("Private realtime dependencies are not configured.");
}

const subscriber = createClient({ url: redisUrl });
subscriber.on("error", () => console.error("Realtime Redis connection failed."));
const stateCache = createClient({ url: redisUrl });
stateCache.on("error", () => console.error("Realtime Redis state cache failed."));
await Promise.all([subscriber.connect(), stateCache.connect()]);

const socketsByRoom = new Map();
const roomSubscriptions = new Map();
const socketsByGame = new Map();
const gameSubscriptions = new Map();
const supportedGames = new Set([
  "teen_patti_pro",
  "luck77",
  "greedy_lion",
  "greedy_king",
  "bounty_football",
]);
const server = createServer((request, response) => {
  if (request.url === "/health") {
    const ready = subscriber.isReady && stateCache.isReady;
    response.writeHead(ready ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify({ status: ready ? "ready" : "unavailable" }));
    return;
  }
  response.writeHead(404).end();
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 256 * 1024) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(message));
}

async function ensureRoomSubscription(roomCode) {
  const current = roomSubscriptions.get(roomCode);
  if (current) return current;
  const channel = `room:${roomCode}`;
  const pending = subscriber.subscribe(channel, (payload) => {
    if (payload.length > 16 * 1024) return;
    const sockets = socketsByRoom.get(roomCode);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > 256 * 1024) {
        socket.terminate();
        continue;
      }
      socket.send(payload);
    }
  });
  roomSubscriptions.set(roomCode, pending);
  try {
    await pending;
  } catch (error) {
    roomSubscriptions.delete(roomCode);
    throw error;
  }
}

async function ensureGameSubscription(game) {
  const current = gameSubscriptions.get(game);
  if (current) return current;
  const channel = `game:${game}`;
  const pending = subscriber.subscribe(channel, (payload) => {
    if (payload.length > 16 * 1024) return;
    const sockets = socketsByGame.get(game);
    if (!sockets) return;
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      return;
    }
    for (const socket of sockets) send(socket, message);
  });
  gameSubscriptions.set(game, pending);
  try {
    await pending;
  } catch (error) {
    gameSubscriptions.delete(game);
    throw error;
  }
}

async function detach(socket) {
  const roomCode = socket.nazraaRoomCode;
  socket.nazraaRoomCode = undefined;
  if (roomCode) {
    const sockets = socketsByRoom.get(roomCode);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        socketsByRoom.delete(roomCode);
        roomSubscriptions.delete(roomCode);
        await subscriber.unsubscribe(`room:${roomCode}`).catch(() => undefined);
      }
    }
  }
  const game = socket.nazraaGame;
  socket.nazraaGame = undefined;
  if (game) {
    const sockets = socketsByGame.get(game);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        socketsByGame.delete(game);
        gameSubscriptions.delete(game);
        await subscriber.unsubscribe(`game:${game}`).catch(() => undefined);
      }
    }
  }
}

async function authorizeRoom(token, roomCode) {
  const response = await fetch(`${apiOrigin}/api/internal/realtime/authorize`, {
    method: "POST",
    headers: {
      authorization: token,
      "x-nazraa-internal-key": internalSecret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ roomCode }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.roomCode === roomCode;
}

async function authorizeGame(token, game) {
  const response = await fetch(`${apiOrigin}/api/internal/realtime/authorize`, {
    method: "POST",
    headers: {
      authorization: token,
      "x-nazraa-internal-key": internalSecret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ game }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.game === game;
}

server.on("upgrade", (request, socket, head) => {
  const authorization = request.headers.authorization;
  if (
    request.url !== "/realtime" ||
    typeof authorization !== "string" ||
    !/^Bearer [A-Za-z0-9_-]{20,512}$/.test(authorization)
  ) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (client) => {
    client.nazraaAuthorization = authorization;
    wss.emit("connection", client);
  });
});

wss.on("connection", (socket) => {
  socket.nazraaAlive = true;
  socket.on("pong", () => { socket.nazraaAlive = true; });
  socket.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.close(1008, "Invalid message");
      return;
    }
    if (message?.op === "ping") {
      send(socket, { type: "PONG", serverNow: Date.now() });
      return;
    }
    try {
      if (message?.op === "subscribe") {
        const roomCode = message?.roomCode;
        if (typeof roomCode !== "string" || !/^[A-Za-z0-9_-]{3,80}$/.test(roomCode)) {
          socket.close(1008, "Invalid subscription");
          return;
        }
        if (!(await authorizeRoom(socket.nazraaAuthorization, roomCode))) {
          socket.close(1008, "Room access denied");
          return;
        }
        if (socket.nazraaRoomCode !== roomCode || socket.nazraaGame) await detach(socket);
        await ensureRoomSubscription(roomCode);
        let sockets = socketsByRoom.get(roomCode);
        if (!sockets) {
          sockets = new Set();
          socketsByRoom.set(roomCode, sockets);
        }
        sockets.add(socket);
        socket.nazraaRoomCode = roomCode;
        send(socket, { type: "ROOM_READY", roomCode, serverNow: Date.now() });
        return;
      }
      if (message?.op === "subscribe-game") {
        const game = message?.game;
        if (typeof game !== "string" || !supportedGames.has(game)) {
          socket.close(1008, "Invalid game subscription");
          return;
        }
        if (!(await authorizeGame(socket.nazraaAuthorization, game))) {
          socket.close(1008, "Game access denied");
          return;
        }
        if (socket.nazraaGame !== game || socket.nazraaRoomCode) await detach(socket);
        await ensureGameSubscription(game);
        let sockets = socketsByGame.get(game);
        if (!sockets) {
          sockets = new Set();
          socketsByGame.set(game, sockets);
        }
        sockets.add(socket);
        socket.nazraaGame = game;
        send(socket, { type: "GAME_READY", game, serverNow: Date.now() });
        // Redis is the public current-round cache. Send it immediately so a
        // new game surface has an authoritative phase/countdown without
        // waiting for the next worker transition or SQL reconciliation.
        const cached = await stateCache.get(`game:state:${game}`);
        if (cached && cached.length <= 16 * 1024) {
          try {
            send(socket, {
              type: "GAME_CHANGED",
              game,
              reason: "ROUND",
              state: JSON.parse(cached),
              serverNow: Date.now(),
            });
          } catch {
            // A stale cache is safe to ignore; the worker republishes phases.
          }
        }
        return;
      }
      socket.close(1008, "Invalid subscription");
    } catch {
      send(socket, { type: "RETRY", retryAfterMs: 2000 });
    }
  });
  socket.on("close", () => { void detach(socket); });
  socket.on("error", () => { void detach(socket); });
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.nazraaAlive) {
      socket.terminate();
      continue;
    }
    socket.nazraaAlive = false;
    socket.ping();
  }
}, 25_000);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    clearInterval(heartbeat);
    for (const socket of wss.clients) socket.close(1001, "Server restarting");
    server.close();
    await subscriber.quit().catch(() => undefined);
    await stateCache.quit().catch(() => undefined);
    process.exit(0);
  });
}

server.listen(3100, "0.0.0.0");
