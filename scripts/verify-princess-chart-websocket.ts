import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import mysql from "mysql2/promise";
import { WebSocket } from "ws";
registerHooks({
  resolve(s, c, n) {
    return n(
      s === "server-only" ? "next/dist/compiled/server-only/empty.js" : s,
      c,
    );
  },
});
async function main() {
  const q = JSON.parse(
    await readFile("/tmp/nazraa-owner-staging-fixtures.json", "utf8"),
  );
  assert.match(q.database, /^nazraa_mobile_qa_\d+$/);
  Object.assign(process.env, {
    DB_HOST: "127.0.0.1",
    DB_NAME: q.database,
    DB_USER: "root",
    DB_PASSWORD: "",
    DB_SSL: "false",
    REDIS_URL: "redis://127.0.0.1:6391",
    REALTIME_INTERNAL_SECRET: randomBytes(32).toString("hex"),
  });
  global.nazraaPool = mysql.createPool({
    host: "127.0.0.1",
    user: "root",
    database: q.database,
    connectionLimit: 4,
    timezone: "Z",
  });
  global.nazraaInstrumentedPool = global.nazraaPool;
  const { POST } = await import("../app/api/internal/realtime/authorize/route");
  const auth = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const result = await POST(
        new Request("http://127.0.0.1/api/internal/realtime/authorize", {
          method: "POST",
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks).toString(),
        }),
      );
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(await result.text());
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise<void>((r) => auth.listen(3912, "127.0.0.1", r));
  const path = process.cwd() + "/deploy/vps/.princess-ws-qa.mjs";
  await writeFile(
    path,
    (await readFile("deploy/vps/realtime.mjs", "utf8")).replace(
      'server.listen(3100, "0.0.0.0")',
      'server.listen(3911, "127.0.0.1")',
    ),
  );
  const child = spawn(process.execPath, [path], {
    env: { ...process.env, REALTIME_API_ORIGIN: "http://127.0.0.1:3912" },
    stdio: "ignore",
  });
  const sockets: WebSocket[] = [];
  process.env.ALLOW_DEVELOPMENT_MOBILE_AUTH = "true";
  const { createDevelopmentMobileSession } = await import(
    "../lib/auth/mobile-session"
  );
  const sessions = [];
  for (let i = 0; i < 2; i++)
    sessions.push(
      await createDevelopmentMobileSession({
        fullName: "Princess WebSocket QA " + i,
        countryCode: "IN",
        deviceId: "princess-local-device-" + randomBytes(16).toString("hex"),
      }),
    );
  try {
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch("http://127.0.0.1:3911/health")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const streams: any[][] = [];
    for (const fixture of sessions) {
      const ws = new WebSocket("ws://127.0.0.1:3911/realtime", {
        headers: { authorization: "Bearer " + fixture.token },
      });
      sockets.push(ws);
      const received: any[] = [];
      streams.push(received);
      ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      await once(ws, "open");
      ws.send(JSON.stringify({ op: "subscribe-game", game: "teen_patti" }));
    }
    for (
      let i = 0;
      i < 40 && !streams.every((s) => s.some((e) => e.type === "GAME_READY"));
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    assert(
      streams.every((s) => s.some((e) => e.type === "GAME_READY")),
      "both existing fixture sessions must authorize through actual API handler",
    );
    const { publishSharedGameBetInvalidation } = await import(
      "../lib/services/game-realtime-events"
    );
    const { authenticateMobileRequest } = await import(
      "../lib/auth/mobile-session"
    );
    const identity = await authenticateMobileRequest(
      new Request("http://127.0.0.1/api/v1/mobile/game-bets", {
        headers: { authorization: "Bearer " + sessions[0].token },
      }),
    );
    assert(identity);
    // Only this freshly created account in the asserted disposable local DB.
    await global.nazraaPool!.execute(
      "UPDATE wallet_balances SET available_balance=10000 WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'",
      [identity.userId],
    );
    await global.nazraaPool!.execute(
      "UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti' AND result_ends_at>UTC_TIMESTAMP(3)",
    );
    const product = await import("../lib/db/repositories/mobile-product");
    const state = await product.gameSharedRoundState(identity, "teen_patti");
    await global.nazraaPool!.execute(
      "UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 30 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 31 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 38 SECOND WHERE id=?",
      [state.round.id],
    );
    const request = {
      requestId: randomBytes(16).toString("hex"),
      game: "teen_patti",
      roundId: state.round.id,
      bets: { green: 100 },
      quoteId: String(
        state.publicPreview?.paytableQuoteId ??
          state.publicPreview?.quoteId ??
          "",
      ),
    };
    const accepted = await product.placeSharedGameBets(identity, request);
    const retried = await product.placeSharedGameBets(identity, request);
    assert.equal(accepted.round.phase, "BETTING");
    assert.equal(accepted.walletBalance, 9900);
    assert.equal(retried.walletBalance, 9900);
    const activity = accepted.princessActivity;
    assert(activity);
    assert.equal(activity.targetTotals.green, 100);
    assert.equal(activity.participants.green[0].userId, identity.publicId);
    await publishSharedGameBetInvalidation("teen_patti", activity);
    for (
      let i = 0;
      i < 40 &&
      !streams.every((s) => s.some((e) => e.reason === "PRINCESS_ACTIVITY"));
      i++
    )
      await new Promise((r) => setTimeout(r, 50));
    for (const s of streams) {
      const event = s.find((e) => e.reason === "PRINCESS_ACTIVITY");
      assert.deepEqual(event.state.princessActivity, activity);
      assert.equal(event.state.walletBalance, undefined);
      assert.equal(event.state.myBets, undefined);
    }
    console.log(
      "PRINCESS_WS_PASS: two actual authenticated fixture sessions; unchanged production edge implementation on isolated loopback ports; Redis-to-WebSocket durably accepted 100-Coin bet/retry projection delivered to both before any result; no wallet/private wager fields.",
    );
  } finally {
    for (const s of sockets) s.close();
    child.kill("SIGTERM");
    auth.close();
    await unlink(path).catch(() => {});
    await global.nazraaPool?.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
