import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { currentPayoutCycle, payoutCycle } from "../lib/reports/payout-cycle";
import { configurableGameIds, mobileGamesConfig } from "../lib/games/game-config";
import { economyDraft, economyModel, type EconomyDraft } from "../lib/games/economy-policy";

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, context);
} });

async function main() {
  const fixture = JSON.parse(await readFile("/tmp/nazraa-gm-qa-fixtures.json", "utf8"));
  assert.match(fixture.database, /^nazraa_gm_qa_\d+$/);
  const pool = mysql.createPool({ host: "127.0.0.1", user: "root", database: fixture.database,
    timezone: "Z", connectionLimit: 8, decimalNumbers: true });
  pool.on("connection", c => { void c.query("SET time_zone='+00:00'"); });
  global.nazraaPool = pool;
  global.nazraaInstrumentedPool = pool;
  try {
    const { accountById, scopeFor } = await import("../lib/db/repositories/accounts");
    const { createPlatformAccount } = await import("../lib/db/repositories/administration");
    const { setCatalogOperator, catalogOperatorAccess } = await import("../lib/auth/catalog-operators");
    const { currentGameEconomy, previewGameEconomy, publishGameEconomy } = await import("../lib/db/repositories/game-economy");
    const { updateGift } = await import("../lib/db/repositories/catalog");
    const { gameSharedRoundState, mobileGiftCatalogSnapshot, sendGift } = await import("../lib/db/repositories/mobile-product");
    const { giftHistory } = await import("../lib/db/repositories/gift-history");
    const { hostPayoutSummary } = await import("../lib/db/repositories/host-payouts");

    const master = await scopeFor(fixture.master);
    const [existing] = await pool.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE full_name='QA Store Super' LIMIT 1");
    let superId = existing[0]?.id;
    if (!superId) {
      const country = await createPlatformAccount({
        scope: master, role: "COUNTRY_MANAGER", fullName: "QA Store Country", countryCode: "IN",
        password: "Local-QA-Only-2026!", documents: [],
      });
      superId = (await createPlatformAccount({
        scope: master, role: "SUPER_ADMIN", fullName: "QA Store Super", countryCode: "IN", requestedParentId: country.accountId,
        password: "Local-QA-Only-2026!", documents: [],
      })).accountId;
    }
    const { accountId } = await createPlatformAccount({
      scope: master, role: "ADMIN", fullName: "QA Catalog Admin", countryCode: "IN",
      password: "Local-QA-Only-2026!", requestedParentId: superId, documents: [],
    });
    const admin = await scopeFor((await accountById(accountId))!);
    assert.deepEqual(await catalogOperatorAccess(admin.account), { games: false, gifts: false });
    await assert.rejects(currentGameEconomy(admin), /explicitly authorized/);
    await assert.rejects(currentGameEconomy(await scopeFor(fixture.A)), /explicitly authorized/);
    await setCatalogOperator(master, String(admin.account.publicId), { games: true, gifts: true }, "Isolated operator QA");
    assert.deepEqual(await catalogOperatorAccess(admin.account), { games: true, gifts: true });

    const initial = (await currentGameEconomy(admin)).settings.games.teen_patti;
    const actor = (user: {id: string; publicId: string}, name: string, role: "HOST" | "NORMAL_USER") => ({
      userId: user.id, publicId: user.publicId, externalUserId: user.id, fullName: name, role,
      accountStatus: "ACTIVE", faceVerificationStatus: "VERIFIED", agencyAccountId: null,
      agencyFaceLiveAuthorized: true, superAdminFaceLiveAuthorized: true, hostAccessOverride: false,
      hostProfileStatus: "ACTIVE", liveRestricted: false, liveRestrictedUntil: null, liveRestrictionReason: null,
      temporaryLiveRestricted: false, temporaryLiveRestrictedUntil: null, temporaryLiveRestrictionReason: null,
      hostingSuspended: false, hostingSuspendedUntil: null, hostingSuspensionReason: null,
    });
    const sender = actor(fixture.people.own, "QA Sender", "NORMAL_USER");
    const host = actor(fixture.people.foreignCountry, "QA Recipient", "HOST");
    const round = await gameSharedRoundState(sender, "teen_patti");
    const [[before]] = await pool.query<RowDataPacket[]>("SELECT config_json,outcome_json,config_version FROM game_shared_rounds WHERE id=?", [round.round.id]);
    const proposal: EconomyDraft = {
      controlMode: "TARGET_RTP", mode: "HIGH_PAYOUT", targetRtp: 1.05,
      enabled: true, maintenance: false, minimumBet: initial.minimumBet,
      maximumBet: initial.maximumBet, maximumPayoutMultiplier: initial.maximumPayoutMultiplier,
      payoutScalePpm: initial.payoutScalePpm, denominations: [500, 100, 1000, 10000],
    };
    const preview = await previewGameEconomy(admin, "teen_patti", proposal);
    assert.equal(preview.proposed.economyMode, "HIGH_PAYOUT");
    assert(Math.abs(preview.model.average! - 1.05) < 1e-9);
    const promoVersion = await publishGameEconomy(admin, "teen_patti", proposal, preview.expectedVersion, "Promotional mode test only");
    const [[after]] = await pool.query<RowDataPacket[]>("SELECT config_json,outcome_json,config_version FROM game_shared_rounds WHERE id=?", [round.round.id]);
    assert.deepEqual(after, before);
    await pool.execute("UPDATE game_shared_rounds SET result_ends_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?", [round.round.id]);
    const next = await gameSharedRoundState(sender, "teen_patti");
    const [[stored]] = await pool.query<RowDataPacket[]>("SELECT config_json,config_version FROM game_shared_rounds WHERE id=?", [next.round.id]);
    assert.equal(Number(stored.config_version), promoVersion);
    const active = (await currentGameEconomy(admin)).settings.games.teen_patti;
    assert.equal(active.targetRtp, 1.05);
    assert.deepEqual(active.denominations, proposal.denominations);
    const back = { ...proposal, mode: "NORMAL" as const, targetRtp: initial.targetRtp,
      maximumBet: initial.maximumBet, maximumPayoutMultiplier: initial.maximumPayoutMultiplier };
    const normalVersion = await publishGameEconomy(admin, "teen_patti", back, promoVersion, "Return to original normal preset");
    const normal = (await currentGameEconomy(admin)).settings.games.teen_patti;
    for (const field of ["targetRtp", "payoutScalePpm", "maximumPayoutMultiplier", "princessPayoutProfile", "princessPreviewQuotes"] as const)
      assert.equal(normal[field], initial[field], field);
    assert.equal(normal.economyPresets?.HIGH_PAYOUT?.targetRtp, 1.05);
    const [[audit]] = await pool.query<RowDataPacket[]>("SELECT actor_role FROM audit_logs WHERE actor_account_id=? AND action='game.economy_publish' LIMIT 1", [accountId]);
    assert.equal(audit.actor_role, "ADMIN");

    const models = [];
    for (const game of configurableGameIds) {
      const config = mobileGamesConfig({}).games[game];
      const chips = [...config.denominations].reverse();
      const base: EconomyDraft = { controlMode: "TARGET_RTP", mode: "NORMAL", targetRtp: config.targetRtp,
        enabled: config.enabled, maintenance: config.maintenance, minimumBet: config.minimumBet,
        maximumBet: config.maximumBet, maximumPayoutMultiplier: config.maximumPayoutMultiplier,
        payoutScalePpm: config.payoutScalePpm, denominations: chips };
      assert.deepEqual(economyDraft(game, config, base).denominations, chips, game);
      assert.throws(() => economyDraft(game, config, { ...base, denominations: [0, 0] }), /unique betting/);
      if (game === "lion_vs_tiger" || game === "jungle_hunt") {
        assert.throws(() => economyDraft(game, config, { ...base, mode: "HIGH_PAYOUT", targetRtp: 1.05 }));
        continue;
      }
      const promotional = economyDraft(game, config, { ...base, mode: "HIGH_PAYOUT", targetRtp: 1.10 });
      assert(Math.abs(economyModel(game, promotional).average! - 1.10) < .00001, game);
      assert.throws(() => economyDraft(game, config, { ...base, mode: "HIGH_PAYOUT", targetRtp: 1.11 }), /NOT ACHIEVABLE/);
      models.push(game);
    }

    await pool.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('mobile.gift_economy',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
      [JSON.stringify({ platformFeeActivatedAt: "2026-01-01T00:00:00Z", giftPlatformFeeBps: 1500 }), master.account.id]);
    const room = randomUUID(), code = "catalog-qa-" + room;
    await pool.execute("INSERT INTO live_rooms(id,room_code,host_application_user_id,room_type,seat_count) VALUES(?,?,?,'PARTY',10)", [room, code, host.userId]);
    for (const user of [host, sender]) {
      await pool.execute("INSERT INTO live_room_members(room_id,application_user_id,room_role,media_role) VALUES(?,?,?,?)",
        [room, user.userId, user === host ? "OWNER" : "AUDIENCE", user === host ? "PARTY_OWNER" : "PASSIVE_VIEWER"]);
    }
    const id = randomUUID(), key = "operator_qa_" + Date.now();
    await pool.execute("INSERT INTO gift_catalog(id,gift_key,name,category,coin_price,economy_type,created_by) VALUES(?,?, 'QA Rose', 'QA',100,'NORMAL',?)",
      [id, key, master.account.id]);
    const intent = { roomCode: code, giftId: key, recipientPublicId: host.publicId, quantity: 1, expectedUnitCoinPrice: 100 };
    const first = await sendGift(sender, { ...intent, clientGiftId: randomUUID() });
    assert.equal(first.event?.value, 100);
    assert.equal(first.event?.diamondValue, 85);
    const update = { scope: admin, id, name: "QA Royal Rose", displayName: "Royal Rose", category: "QA",
      economyType: "NORMAL" as const, catalogType: "VIRTUAL_GIFT" as const, artworkMode: "EMOJI" as const, emoji: "🌹",
      coinPrice: 200, active: true, validityDays: 30, sortOrder: 1, effectConfig: {
        durationMs: 1800, loop: false, position: "BOTTOM" as const, zIndex: 1, soundVolume: 0,
        priority: 100, displayMode: "COMPACT" as const, presentationTier: "SMALL" as const,
        gameBehavior: "COMPACT" as const, modalBehavior: "COMPACT" as const,
      },
      reason: "Isolated audit gift price and name" };
    await assert.rejects(updateGift({ ...update, economyType: "LUCKY" }), /settlement type/);
    await updateGift(update);
    const gift = (await mobileGiftCatalogSnapshot()).gifts.find(row => row.id === key);
    assert.equal(gift?.name, "Royal Rose");
    assert.equal(gift?.cost, 200);
    await assert.rejects(sendGift(sender, { ...intent, clientGiftId: randomUUID() }), /Gift price changed/);
    const second = await sendGift(sender, { ...intent, expectedUnitCoinPrice: 200, clientGiftId: randomUUID() });
    assert.equal(second.event?.value, 200);
    assert.equal(second.event?.diamondValue, 170);
    const history = (await giftHistory(sender, { scope: "sent", period: "all" })).records;
    assert.equal(history.find(row => row.id === first.event?.id)?.gift.name, "QA Rose");
    assert.equal(history.find(row => row.id === second.event?.id)?.gift.name, "Royal Rose");
    assert.equal(history.find(row => row.id === first.event?.id)?.value, 100);

    const cycle1 = payoutCycle("2026-11-1"), cycle2 = payoutCycle("2026-11-2");
    assert.equal(currentPayoutCycle(new Date("2026-11-15T18:29:59.999Z")), cycle1.id);
    assert.equal(currentPayoutCycle(new Date("2026-11-15T18:30:00.000Z")), cycle2.id);
    assert.equal(payoutCycle("2028-02-2").to, "2028-02-29");
    assert.equal(payoutCycle("2026-12-2").next, "2027-01-1");
    const [requests] = await pool.query<RowDataPacket[]>("SELECT id FROM withdrawal_requests WHERE request_channel='HOST_WEB' ORDER BY id LIMIT 2");
    assert.equal(requests.length, 2);
    for (const [index, time] of ["2028-11-15T18:29:59.999Z", "2028-11-15T18:30:00.000Z"].entries())
      await pool.execute("UPDATE withdrawal_requests SET requested_at=? WHERE id=?", [new Date(time), requests[index].id]);
    assert.equal(Number((await hostPayoutSummary({ account: master.account }, payoutCycle("2028-11-1"))).requests), 1);
    assert.equal(Number((await hostPayoutSummary({ account: master.account }, payoutCycle("2028-11-2"))).requests), 1);
    assert.equal(Number((await hostPayoutSummary({ account: admin.account }, payoutCycle("2028-11-1"))).requests), 0);

    console.log(JSON.stringify({ status: "PASS", admin: admin.account.publicId, promoVersion, normalVersion,
      promotion: 105, modelsAt110: models, orderedChips: configurableGameIds,
      activeRoundPreserved: true, giftBeforeAfter: "100 → 200, old record 100", payoutBoundary: "18:30:00 UTC / midnight IST" }));
  } finally { await pool.end(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
