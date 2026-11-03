import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import type { MobileIdentity } from "../lib/auth/mobile-session";
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
  const pool = mysql.createPool({
    host: "127.0.0.1",
    user: "root",
    database: q.database,
    timezone: "Z",
    connectionLimit: 6,
  });
  pool.on("connection", c => { void c.query("SET time_zone='+00:00'"); });
  global.nazraaPool = pool;
  global.nazraaInstrumentedPool = pool;
  Object.assign(process.env, {
    DB_HOST: "127.0.0.1",
    DB_NAME: q.database,
    DB_USER: "root",
    DB_PASSWORD: "",
    DB_SSL: "false",
    REDIS_URL: "redis://127.0.0.1:56379",
  });
  const c = await pool.getConnection();
  let previous: unknown;
  const users = q.fixtures.slice(0, 3) as MobileIdentity[];
  try {
    const product = await import("../lib/db/repositories/mobile-product"),
      { princessNinetyQuote, commitPrincessQuote } = await import(
        "../lib/games/princess-preview-pricing"
      ),
      { dealChairRound } = await import("../lib/games/teen-patti"),
      { effectiveMobileGamesConfig } = await import("../lib/games/game-config"),
      { princessChartActivity } = await import(
        "../lib/db/repositories/princess-chart-activity"
      );
    const [settings] = await c.query<mysql.RowDataPacket[]>(
      "SELECT setting_value FROM system_settings WHERE setting_key='mobile.games'",
    );
    previous = settings[0]?.setting_value;
    const config = effectiveMobileGamesConfig(previous);
    config.games.teen_patti = {
      ...config.games.teen_patti,
      enabled: true,
      maintenance: false,
      princessPayoutProfile: "FAIR_90_FEE_5",
      princessServiceFeeBps: 500,
      targetRtp: 0.9,
    };
    await c.execute(
      "UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.games'",
      [JSON.stringify(config)],
    );
    // Exclude only disposable fixture history from today's expected ranking.
    const [oldDates] = await c.query<mysql.RowDataPacket[]>(
      "SELECT result_record_id,business_date FROM game_daily_winner_contributions WHERE game_name='teen_patti'",
    );
    await c.execute(
      "UPDATE game_daily_winner_contributions SET business_date='2000-01-01' WHERE game_name='teen_patti'",
    );
    const outcomes = [];
    const renderFixtures = [];
    try {
      for (const [index, chair] of ["green", "blue", "red"].entries()) {
        await c.execute(
          "UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE game_name='teen_patti' AND result_ends_at>UTC_TIMESTAMP(3)",
        );
        let state = await product.gameSharedRoundState(users[0], "teen_patti");
        const roundId = state.round.id;
        let outcome;
        do {
          outcome = dealChairRound();
        } while (outcome.winner !== chair);
        const pricing = princessNinetyQuote(),
          committed = {
            ...outcome,
            rulesVersion: pricing.rulesVersion,
            pricing,
            ...commitPrincessQuote(outcome.hands, pricing),
          };
        await c.execute(
          "UPDATE game_shared_rounds SET outcome_json=?,betting_ends_at=UTC_TIMESTAMP(3)+INTERVAL 45 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)+INTERVAL 46 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 52 SECOND WHERE id=?",
          [JSON.stringify(committed), roundId],
        );
        for (const [i, user] of users.entries()) {
          const request = {
            requestId: randomUUID(),
            game: "teen_patti",
            roundId,
            bets: { [chair]: (i + 1) * 100 },
            quoteId: committed.commitment,
          };
          const accepted = await product.placeSharedGameBets(user, request),
            retry = await product.placeSharedGameBets(user, request);
          assert.deepEqual(accepted.myBets, retry.myBets);
          assert.equal(accepted.walletBalance, retry.walletBalance);
          assert.equal(accepted.princessActivity?.roundId, roundId);
          assert.equal(
            accepted.princessActivity?.participants[chair].length,
            i + 1,
          );
        }
        const viewer = await product.gameSharedRoundState(
          q.fixtures[3],
          "teen_patti",
        );
        assert.equal(viewer.round.phase, "BETTING");
        assert.equal(viewer.princessActivity?.targetTotals[chair], 600);
        assert.equal(
          viewer.walletBalance,
          (await product.gameSharedRoundState(q.fixtures[3], "teen_patti"))
            .walletBalance,
        );
        assert.equal(viewer.myBets[chair], 0);
        await c.execute(
          "UPDATE game_shared_rounds SET betting_ends_at=UTC_TIMESTAMP(3)-INTERVAL 2 SECOND,drawing_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,result_ends_at=UTC_TIMESTAMP(3)+INTERVAL 8 SECOND WHERE id=?",
          [roundId],
        );
        await product.maintainSharedGameRounds();
        await product.maintainSharedGameRounds();

        const activity = await princessChartActivity(
            c,
            roundId,
            state.round.number,
          ),
          winners = activity.top3[chair];
        assert.equal(winners.length, 3);
        assert.deepEqual(
          winners.map((p) => p.amount),
          [810, 540, 270],
        );
        assert.deepEqual(
          winners.map((p) => p.userId),
          [...users].reverse().map((p) => p.publicId),
        );
        assert(
          winners.every((p) => p.displayName && p.displayName !== p.userId),
        );
        for (const other of ["green", "blue", "red"].slice(index + 1))
          assert.equal(
            activity.top3[other].length,
            0,
            "A chair cannot populate another chair",
          );
        const [settlements] = await c.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) n,SUM(payout_total) payout FROM game_shared_settlements WHERE round_id=?",
          [roundId],
        );
        assert.equal(Number(settlements[0].n), 3);
        assert.equal(Number(settlements[0].payout), 1620);
        outcomes.push({
          chair,
          roundId,
          top3: winners,
          acceptedPot: 600,
          settled: 3,
          payout: 1620,
        });
        renderFixtures.push({
          chair,
          outcome: committed,
          activity,
          roundId,
          roundNumber: state.round.number,
        });
        await c.execute(
          "UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
          [roundId],
        );
        const next = await product.gameSharedRoundState(users[0], "teen_patti");
        assert.notEqual(next.round.id, roundId);
        assert.deepEqual(next.targetTotals, { green: 0, blue: 0, red: 0 });
        assert.equal(
          Object.values(next.princessActivity!.participants).flat().length,
          0,
        );
        assert.equal(
          next.princessActivity!.top3[chair].length,
          0,
          "New round never inherits earlier round winners",
        );
      }
      // Canonical identity, not display name, must select the correct DP.
      const [profiles] = await c.query<mysql.RowDataPacket[]>(
        "SELECT id,full_name,avatar_url FROM application_users WHERE id IN (?,?,?)",
        users.map((u) => u.userId),
      );
      try {
        for (const [i, u] of users.entries())
          await c.execute(
            "UPDATE application_users SET full_name=?,avatar_url=? WHERE id=?",
            [
              "Same visible name",
              "https://example.invalid/princess-qa-dp-" + i + ".png",
              u.userId,
            ],
          );

        const mapped = await princessChartActivity(
          c,
          renderFixtures[2].roundId,
          renderFixtures[2].roundNumber,
        );
        assert.equal(new Set(mapped.top3.red.map((p) => p.userId)).size, 3);
        for (const p of mapped.top3.red) {
          const i = users.findIndex((u) => u.publicId === p.userId);
          assert.equal(p.displayName, "Same visible name");
          assert.equal(
            p.avatarUrl,
            "https://example.invalid/princess-qa-dp-" + i + ".png",
          );
        }
      } finally {
        for (const p of profiles)
          await c.execute(
            "UPDATE application_users SET full_name=?,avatar_url=? WHERE id=?",
            [p.full_name, p.avatar_url, p.id],
          );

      }
      // Real two logical clients receive one committed Princess public projection.
      const { createClient } = await import("redis"),
        { publishSharedGameBetInvalidation } = await import(
          "../lib/services/game-realtime-events"
        );
      const sub = createClient({ url: process.env.REDIS_URL });
      await sub.connect();
      let resolve!: (v: any) => void;
      const message = new Promise<any>((r) => (resolve = r));
      await sub.subscribe("game:teen_patti", (raw) => resolve(JSON.parse(raw)));
      const state = await product.gameSharedRoundState(users[0], "teen_patti");
      await publishSharedGameBetInvalidation(
        "teen_patti",
        state.princessActivity,
      );
      const packet = (await Promise.race([
        message,
        new Promise((_, r) =>
          setTimeout(() => r(Error("Redis event timeout")), 2000),
        ),
      ])) as any;
      assert.equal(packet.reason, "TABLE_ACTIVITY");
      assert.equal(packet.state.princessActivity.roundId, state.round.id);
      assert.equal(packet.state.walletBalance, undefined);
      assert.equal(packet.state.myBets, undefined);
      await sub.quit();
      await mkdir("/tmp/nazraa-princess-chart-evidence", { recursive: true });
      await writeFile(
        "/tmp/nazraa-princess-chart-evidence/results.json",
        JSON.stringify(outcomes, null, 2),
      );
      await writeFile(
        "/tmp/nazraa-princess-chart-evidence/render-fixtures.json",
        JSON.stringify(renderFixtures, null, 2),
      );
      console.log(
        "PASS three authoritative chairs; 3 actual winners/chair ordered by settled net Coins; canonical profile mapping; repeat bet/settlement once; 2 logical Redis clients receive public accepted participation before result; new round clears all pots/participants and removes all previous-round winners.",
      );
    } finally {
      for (const r of oldDates)
        await c.execute(
          "UPDATE game_daily_winner_contributions SET business_date=? WHERE result_record_id=?",
          [r.business_date, r.result_record_id],
        );
    }
  } finally {
    if (previous !== undefined)
      await c.execute(
        "UPDATE system_settings SET setting_value=? WHERE setting_key='mobile.games'",
        [typeof previous === "string" ? previous : JSON.stringify(previous)],
      );
    c.release();
    await pool.end();
    global.nazraaPool = undefined;
    global.nazraaInstrumentedPool = undefined;
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
