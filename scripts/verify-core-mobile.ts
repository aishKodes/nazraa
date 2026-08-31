import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import mysql, { type RowDataPacket } from "mysql2/promise";
import sharp from "sharp";
import type { MobileIdentity } from "@/lib/auth/mobile-session";

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "server-only" ? "next/dist/compiled/server-only/empty.js" : specifier, context);
} });

async function main() {
  const database = `nazraa_mobile_qa_${Date.now()}`;
  const root = await mysql.createConnection({ host: "127.0.0.1", user: "root", multipleStatements: true });
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  global.nazraaPool = mysql.createPool({ host: "127.0.0.1", user: "root", database, decimalNumbers: true, connectionLimit: 8, timezone: "Z" });
  process.env.DOCUMENT_ENCRYPTION_KEY = "nazraa-local-mobile-qa-only-key-2026";
  let keep = false;
  try {
    for (const file of (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort()) await root.query(await readFile(`db/migrations/${file}`, "utf8"));
    const product = await import("@/lib/db/repositories/mobile-product");
    const social = await import("@/lib/db/repositories/mobile-social");
    const rooms = await import("@/lib/db/repositories/mobile-completion");
    const seats = await import("@/lib/db/repositories/mobile-seats");
    const accounts = await import("@/lib/db/repositories/accounts");
    const admin = await import("@/lib/db/repositories/administration");
    const agencies = await import("@/lib/db/repositories/agency-applications");
    const images = await import("@/lib/security/public-images");
    await accounts.createInitialMaster({ publicId: 100001, fullName: "QA Master", password: "Local-QA-Only-2026!" });
    const master = await accounts.scopeFor((await accounts.accountByManagementId("100001"))!);
    const country = await admin.createPlatformAccount({ scope: master, role: "COUNTRY_MANAGER", fullName: "QA Country", countryCode: "IN", password: "Local-QA-Only-2026!", documents: [] });
    const superAdmin = await admin.createPlatformAccount({ scope: master, role: "SUPER_ADMIN", requestedParentId: country.accountId, fullName: "QA Super Admin", countryCode: "IN", password: "Local-QA-Only-2026!", documents: [] });
    const parent = await admin.createPlatformAccount({ scope: master, role: "ADMIN", requestedParentId: superAdmin.accountId, fullName: "QA Parent Admin", countryCode: "IN", password: "Local-QA-Only-2026!", documents: [] });
    const parentAccount = (await accounts.accountByManagementId(String(parent.publicId)))!;
    const parentScope = await accounts.scopeFor(parentAccount);
    for (const kind of ["PARTY", "LIVE", "FACE"]) await root.execute("INSERT INTO host_reward_rules (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by) VALUES (?, ?, 0, 60, TRUE, '2020-01-01', ?)", [randomUUID(), kind, master.account.id]);
    for (let day = 1; day <= 7; day += 1) await root.execute("INSERT INTO daily_reward_rules (id, day_number, reward_coins, label, updated_by) VALUES (?, ?, ?, ?, ?)", [randomUUID(), day, day * 10, `Day ${day}`, master.account.id]);
    await root.execute("INSERT INTO gift_catalog (id, gift_key, name, category, coin_price, animation_key, created_by) VALUES (?, 'qa_rose', 'QA Rose', 'Popular', 10, 'gift.qa_rose', ?)", [randomUUID(), master.account.id]);
    async function user(name: string): Promise<MobileIdentity> {
      const id = randomUUID();
      await root.execute("INSERT INTO application_users (id, external_user_id, full_name, country_code, face_verification_status, onboarding_completed, is_host) VALUES (?, ?, ?, 'IN', 'VERIFIED', TRUE, TRUE)", [id, id, name]);
      const [rows] = await root.query<RowDataPacket[]>("SELECT public_id FROM application_users WHERE id = ?", [id]);
      await root.execute("INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES (?, 'APPLICATION_USER', ?, 'COIN', 5000)", [randomUUID(), id]);
      await root.execute("INSERT INTO host_profiles (id, application_user_id, status, verification_status) VALUES (?, ?, 'ACTIVE', 'VERIFIED')", [randomUUID(), id]);
      return { userId: id, publicId: String(rows[0].public_id), externalUserId: id, fullName: name, role: "HOST", accountStatus: "ACTIVE", faceVerificationStatus: "VERIFIED", agencyAccountId: null, agencyFaceLiveAuthorized: true, superAdminFaceLiveAuthorized: true };
    }
    const owner = await user("QA Room Owner");
    const guest = await user("QA Audience");
    const roomAdmin = await user("QA Room Admin");
    const stranger = await user("QA Other Branch");
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#7450ad" } }).png().toBuffer();
    const photo = `data:image/png;base64,${png.toString("base64")}`;
    const image = await images.publicImageFromDataUrl(photo, 1_500_000, "QA photo");
    assert.ok(image.byteSize < 1000, "Small optimized photos must be accepted");
    await assert.rejects(images.publicImageFromDataUrl(photo.replace("image/png", "image/jpeg"), 1_500_000, "QA photo"));
    const post = await social.createDiscoveryPost(owner, { caption: "Text-only QA post" });
    const photoPost = await social.createDiscoveryPost(owner, { caption: "Photo QA post", photoDataUrl: photo });
    await assert.rejects(social.createDiscoveryPost(owner, { caption: " " }));
    const posts = await social.discoveryPosts();
    assert.equal(posts.find((entry) => entry.id === post.id)?.type, "text");
    assert.equal(posts.find((entry) => entry.id === photoPost.id)?.type, "photo");
    await assert.rejects(social.deleteDiscoveryPost(guest, post.id));
    console.log("PASS photos: compressed small image, MIME validation, text-only/photo posts, ownership");

    const clientMessageId = randomUUID();
    await social.sendPrivateMessage(owner, { recipientPublicId: guest.publicId, body: "QA request", clientMessageId });
    assert.equal((await social.privateMessagingForUser(guest)).messages[0].conversationStatus, "pending");
    await assert.rejects(social.respondToPrivateRequest(owner, { targetPublicId: guest.publicId, accept: true }));
    await assert.rejects(social.respondToPrivateRequest(stranger, { targetPublicId: owner.publicId, accept: true }));
    await assert.rejects(social.sendPrivateMessage(owner, { recipientPublicId: guest.publicId, body: "Spam", clientMessageId: randomUUID() }));
    await social.respondToPrivateRequest(guest, { targetPublicId: owner.publicId, accept: true });
    await social.sendPrivateMessage(guest, { recipientPublicId: owner.publicId, body: "Accepted reply", clientMessageId: randomUUID() });
    assert.ok((await social.privateMessagingForUser(owner)).messages.every((message) => message.conversationStatus === "accepted"));
    assert.equal((await social.privateMessagingForUser(stranger)).messages.length, 0);
    assert.equal((await social.sendPrivateMessage(owner, { recipientPublicId: guest.publicId, body: "QA request", clientMessageId })).alreadySent, true);
    await social.sendPrivateMessage(stranger, { recipientPublicId: guest.publicId, body: "Second request", clientMessageId: randomUUID() });
    await social.respondToPrivateRequest(guest, { targetPublicId: stranger.publicId, accept: false });
    await assert.rejects(social.sendPrivateMessage(stranger, { recipientPublicId: guest.publicId, body: "Declined", clientMessageId: randomUUID() }));
    console.log("PASS Inbox: pending/accepted/rejected, recipient-only decision, no directory rows, idempotent charge");

    const roomCode = `QA${Date.now()}`;
    await product.createRoom(owner, { roomCode, kind: "party", title: "QA Manual Room", category: "Talk", language: "Hindi", privacy: "public", seatCount: 10, themeIndex: 0, themeEnabled: false, photoDataUrl: photo, countryCode: "IN" });
    await rooms.joinLiveRoom(guest, roomCode);
    await rooms.joinLiveRoom(roomAdmin, roomCode);
    const [joinedSeats] = await root.query<RowDataPacket[]>(
      `SELECT seat_index FROM live_room_members
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)
         AND application_user_id IN (?, ?)`,
      [roomCode, guest.userId, roomAdmin.userId],
    );
    assert.equal(joinedSeats.every((row) => row.seat_index == null), true, "joining must never auto-fill Couple Seats");
    await rooms.setRoomAdmin(owner, { roomCode, targetPublicId: roomAdmin.publicId, makeAdmin: true });
    await assert.rejects(rooms.roomPublishingDecision(guest, roomCode));
    await seats.actOnRoomSeat(guest, { roomCode, action: "request", seatIndex: 0 });
    const before = await rooms.refreshRoomPresence(owner, roomCode);
    assert.equal(before.seatRequests?.[0].userId, guest.publicId);
    await assert.rejects(seats.actOnRoomSeat(guest, { roomCode, action: "accept", targetPublicId: guest.publicId }));
    await assert.rejects(seats.actOnRoomSeat(stranger, { roomCode, action: "accept", targetPublicId: guest.publicId }));
    await seats.actOnRoomSeat(roomAdmin, { roomCode, action: "accept", targetPublicId: guest.publicId });
    const accepted = await rooms.refreshRoomPresence(guest, roomCode);
    assert.equal(accepted.roomRole, "speaker");
    assert.equal(accepted.seatIndex, 0);
    assert.equal((await rooms.roomPublishingDecision(guest, roomCode)).allowed, true);
    await assert.rejects(seats.actOnRoomSeat(roomAdmin, { roomCode, action: "request", seatIndex: 0 }));
    await seats.actOnRoomSeat(guest, { roomCode, action: "leave" });
    await assert.rejects(rooms.roomPublishingDecision(guest, roomCode));
    await seats.actOnRoomSeat(owner, { roomCode, action: "assign", seatIndex: 1, targetPublicId: guest.publicId });
    assert.equal((await rooms.refreshRoomPresence(guest, roomCode)).seatIndex, 1);
    await seats.actOnRoomSeat(guest, { roomCode, action: "leave" });
    await seats.actOnRoomSeat(guest, { roomCode, action: "request", seatIndex: 2 });
    await seats.actOnRoomSeat(owner, { roomCode, action: "reject", targetPublicId: guest.publicId });
    assert.equal((await rooms.refreshRoomPresence(guest, roomCode)).seatRequests?.[0].status, "rejected");
    console.log("PASS seat permissions: Couple Seats stay empty on join; explicit request/accept or staff assignment only; conflicts, rejection, leave, foreign denial");

    const ownerBeforeGift = await product.mobileBootstrap(owner);
    const guestBeforeGift = await product.mobileBootstrap(guest);
    const gift = ownerBeforeGift.gifts[0];
    assert.ok(gift && gift.cost > 0);
    const giftResult = await product.sendGift(owner, {
      roomCode,
      giftId: gift.id,
      recipientPublicId: guest.publicId,
      quantity: 2,
    });
    const giftValue = gift.cost * 2;
    assert.equal(giftResult.remainingCoins, ownerBeforeGift.wallet.coins - giftValue);
    const guestPresenceAfterGift = await rooms.refreshRoomPresence(guest, roomCode);
    assert.equal(guestPresenceAfterGift.wallet?.diamonds, guestBeforeGift.wallet.diamonds + giftValue);
    assert.equal(guestPresenceAfterGift.giftEvents?.at(-1)?.receiver.id, guest.publicId);
    assert.equal(
      guestPresenceAfterGift.participants?.find((entry: { user: { id: string } }) => entry.user.id === guest.publicId)?.receivedGiftValue,
      giftValue,
    );
    await assert.rejects(product.sendGift(owner, {
      roomCode,
      giftId: gift.id,
      recipientPublicId: stranger.publicId,
      quantity: 1,
    }));
    console.log("PASS gifts: active receivers only, atomic coin debit/diamond credit, room event and per-seat total");

    const beforeReward = (await product.mobileBootstrap(owner)).wallet.coins;
    const reward = await rooms.claimDailyReward(owner);
    assert.equal(reward.newBalance, beforeReward + reward.rewardCoins);
    assert.equal((await product.mobileBootstrap(owner)).dailyRewards.claimable, false);
    await assert.rejects(rooms.claimDailyReward(owner));
    const [unreadRewardMail] = await root.query<RowDataPacket[]>("SELECT read_at FROM mobile_notifications WHERE application_user_id = ? AND notification_type = 'DAILY_REWARD' ORDER BY created_at DESC LIMIT 1", [owner.userId]);
    assert.equal(unreadRewardMail[0].read_at, null);
    await rooms.markMobileNotificationsRead(owner);
    const [readRewardMail] = await root.query<RowDataPacket[]>("SELECT read_at FROM mobile_notifications WHERE application_user_id = ? AND notification_type = 'DAILY_REWARD' ORDER BY created_at DESC LIMIT 1", [owner.userId]);
    assert.ok(readRewardMail[0].read_at);
    console.log("PASS rewards/mail: server credit, persisted claim state, duplicate denial, persistent unread/read state");

    await rooms.updateRoomSettings(owner, { roomCode, chatLocked: true, removePassword: false, resetTopDp: false });
    await assert.rejects(rooms.sendRoomChat(guest, { roomCode, body: "Locked message" }));
    await rooms.updateRoomSettings(roomAdmin, { roomCode, chatLocked: false, removePassword: false, resetTopDp: false });
    await rooms.sendRoomChat(guest, { roomCode, body: "Unlocked message" });
    assert.equal((await rooms.refreshRoomPresence(owner, roomCode)).messages?.[0].body, "Unlocked message");
    await rooms.clearRoomChat(owner, roomCode);
    assert.equal((await rooms.refreshRoomPresence(guest, roomCode)).messages?.length, 0);
    await root.execute("UPDATE application_users SET consumption_points = 12500, anchor_income_points = 500, level_number = 6 WHERE id = ?", [owner.userId]);
    const bootstrap = await product.mobileBootstrap(owner);
    assert.ok(bootstrap.posts.some((entry) => entry.id === photoPost.id), "Bootstrap must not overwrite published posts with an empty list");
    assert.notEqual(bootstrap.consumptionLevel.level, bootstrap.anchorIncomeLevel.level);
    assert.notEqual(bootstrap.profile.level, bootstrap.profile.anchorLevel);
    assert.equal(bootstrap.rooms[0].photoUrl?.includes("/assets/rooms/"), true);
    console.log("PASS room state: chat lock/unlock/clear, separate levels, uploaded cover URL");

    await root.execute("UPDATE wallet_balances SET available_balance = 100000 WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'", [owner.userId]);
    const gameBalanceBefore = (await product.mobileBootstrap(owner)).wallet.gameCredits;
    assert.ok(gameBalanceBefore > 0, "Game Center must receive the real nonzero server balance");
    const gameTransactionId = randomUUID();
    const gameDebit = await product.mutateGameWallet(owner, { clientTransactionId: gameTransactionId, direction: "DEBIT", amount: 25, game: "Luck77", reason: "QA real game wager" });
    assert.equal(gameDebit.coinBalance, gameBalanceBefore - 25);
    assert.equal((await product.mobileBootstrap(owner)).wallet.gameCredits, gameBalanceBefore - 25);
    const repeatedDebit = await product.mutateGameWallet(owner, { clientTransactionId: gameTransactionId, direction: "DEBIT", amount: 25, game: "Luck77", reason: "QA repeated wager" });
    assert.equal(repeatedDebit.coinBalance, gameDebit.coinBalance, "game wallet mutation must be idempotent");
    const diamondsBeforeGame = (await product.mobileBootstrap(owner)).wallet.diamonds;
    const clientRoundId = randomUUID();
    const gameRound = await product.settleGameRound(owner, {
      clientRoundId,
      game: "luck77",
      bets: { watermelon: 500, seven: 0, plum: 0 },
    });
    assert.equal(gameRound.coinBalance, repeatedDebit.coinBalance - gameRound.wager + gameRound.payout);
    const repeatedRound = await product.settleGameRound(owner, {
      clientRoundId,
      game: "luck77",
      bets: { watermelon: 500, seven: 0, plum: 0 },
    });
    assert.equal(repeatedRound.roundId, gameRound.roundId);
    assert.equal(repeatedRound.coinBalance, gameRound.coinBalance, "game round settlement must be idempotent");
    await assert.rejects(product.settleGameRound(owner, {
      clientRoundId,
      game: "luck77",
      bets: { watermelon: 0, seven: 500, plum: 0 },
    }), /already used/);
    const roundHistory = await product.gameRoundHistory(owner, "luck77", 10);
    assert.equal(roundHistory.rounds[0]?.roundId, gameRound.roundId);
    const teenRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "teen_patti_pro",
      bets: { "0": 10000, "1": 0, "2": 0 },
    });
    assert.equal(Array.isArray(teenRound.outcome.hands) && teenRound.outcome.hands.length, 3);
    const footballRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "bounty_football",
      bets: { "0": 500, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0, "8": 0, "9": 0 },
    });
    assert.equal(Number.isInteger(footballRound.outcome.winner), true);
    const jungleRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "jungle_hunt",
      bets: { spin: 150 },
    });
    assert.equal(Array.isArray(jungleRound.outcome.grid) && jungleRound.outcome.grid.length, 3);
    assert.equal(Array.isArray(jungleRound.outcome.winningLines), true);
    assert.equal((await product.mobileBootstrap(owner)).wallet.diamonds, diamondsBeforeGame, "game results must never credit withdrawable host earnings");
    console.log("PASS games: all four server result schemas, real balance, atomic wager/payout, immutable idempotency key, history, no DIAMOND credit");

    const agencyInput = { name: "QA Uploaded Agency", ownerName: "QA Applicant", countryCode: "IN", whatsappE164: "+919000000001", aadhaar: "123456789012", parentCode: String(parent.publicId), documentDataUrl: photo, documentName: "proof-1.png", additionalDocuments: [{ dataUrl: photo, name: "proof-2.png" }, { dataUrl: photo, name: "proof-3.png" }], logoDataUrl: photo };
    await assert.rejects(social.applyToCreateAgency(stranger, { ...agencyInput, additionalDocuments: [] }));
    await assert.rejects(social.applyToCreateAgency(stranger, { ...agencyInput, logoDataUrl: undefined }));
    await social.applyToCreateAgency(stranger, agencyInput);
    const application = (await social.agencyApplicationsForUser(stranger)).find((entry) => entry.type === "create")!;
    const [agenciesBeforeReview] = await root.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?", [stranger.userId]);
    assert.equal(agenciesBeforeReview.length, 0, "submitting must not create an Agency");
    const [rows] = await root.query<RowDataPacket[]>("SELECT pan_encrypted, logo_byte_size FROM agency_creation_applications WHERE id = ?", [application.id]);
    assert.equal(rows[0].pan_encrypted, null);
    assert.ok(rows[0].logo_byte_size > 0);
    const pending = (await agencies.listAgencyApplications(parentScope)).find((entry) => entry.id === application.id)!;
    assert.equal(pending.documentCount, 3);
    await assert.rejects(agencies.reviewAgencyCreation({ scope: parentScope, applicationId: application.id, decision: "APPROVED", reason: "QA non-Master cannot approve" }), /Only Master/);
    await agencies.reviewAgencyCreation({ scope: master, applicationId: application.id, decision: "APPROVED", reason: "QA Master verified three protected documents" });
    const [documents] = await root.query<RowDataPacket[]>("SELECT document.id FROM private_documents document JOIN agency_creation_applications application ON application.approved_agency_account_id = document.owner_id WHERE application.id = ?", [application.id]);
    assert.equal(documents.length, 3);
    const [createdAgencyRows] = await root.query<RowDataPacket[]>("SELECT id, public_id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?", [stranger.userId]);
    assert.equal(createdAgencyRows.length, 1);
    assert.match(String(createdAgencyRows[0].public_id), /^\d{6}$/);
    const createdAgencyId = String(createdAgencyRows[0].id);
    const createdAgencyPublicId = String(createdAgencyRows[0].public_id);
    const agencyOwner = { ...stranger, role: "AGENCY_OWNER" as const, agencyAccountId: createdAgencyId };
    const directoryEntry = await social.searchAgency(createdAgencyPublicId);
    assert.equal(directoryEntry.owner?.id, stranger.publicId);
    assert.equal(directoryEntry.owner?.name, stranger.fullName);

    const joiner = await user("QA Agency Joiner");
    await social.applyToJoinAgency(joiner, createdAgencyPublicId);
    const firstJoin = (await social.agencyApplicationsForUser(joiner)).find((entry) => entry.type === "join" && entry.status === "pending")!;
    const [pendingMembership] = await root.query<RowDataPacket[]>("SELECT agency_account_id FROM application_users WHERE id = ?", [joiner.userId]);
    assert.equal(pendingMembership[0].agency_account_id, null, "pending request must not map a host");
    assert.equal((await social.agencyOwnerSnapshot(agencyOwner)).joinRequests[0]?.id, firstJoin.id);
    await social.reviewOwnAgencyJoin(agencyOwner, { applicationId: firstJoin.id, decision: "REJECTED", reason: "QA first request rejected" });
    assert.equal((await social.agencyApplicationsForUser(joiner)).find((entry) => entry.id === firstJoin.id)?.status, "rejected");

    await social.applyToJoinAgency(joiner, createdAgencyPublicId);
    const secondJoin = (await social.agencyApplicationsForUser(joiner)).find((entry) => entry.type === "join" && entry.status === "pending")!;
    await social.reviewOwnAgencyJoin(agencyOwner, { applicationId: secondJoin.id, decision: "APPROVED" });
    const [joinedUser] = await root.query<RowDataPacket[]>("SELECT agency_account_id FROM application_users WHERE id = ?", [joiner.userId]);
    const [joinedHost] = await root.query<RowDataPacket[]>("SELECT agency_account_id FROM host_profiles WHERE application_user_id = ?", [joiner.userId]);
    assert.equal(joinedUser[0].agency_account_id, createdAgencyId);
    assert.equal(joinedHost[0].agency_account_id, createdAgencyId);
    assert.equal((await social.agencyOwnerSnapshot(agencyOwner)).hosts[0]?.user.id, joiner.publicId);
    await assert.rejects(social.applyToJoinAgency(joiner, createdAgencyPublicId), /must remove you/);
    await assert.rejects(social.applyToCreateAgency(joiner, { ...agencyInput, name: "Blocked Joined Agency" }), /already linked/);

    await social.removeOwnAgencyHost(agencyOwner, { targetPublicId: joiner.publicId, reason: "QA membership lifecycle test" });
    const [removedUser] = await root.query<RowDataPacket[]>("SELECT agency_account_id FROM application_users WHERE id = ?", [joiner.userId]);
    const [removedHost] = await root.query<RowDataPacket[]>("SELECT agency_account_id FROM host_profiles WHERE application_user_id = ?", [joiner.userId]);
    const [removedMembership] = await root.query<RowDataPacket[]>("SELECT status, ended_at, end_reason FROM agency_membership_applications WHERE id = ?", [secondJoin.id]);
    assert.equal(removedUser[0].agency_account_id, null);
    assert.equal(removedHost[0].agency_account_id, null);
    assert.equal(removedMembership[0].status, "REMOVED");
    assert.ok(removedMembership[0].ended_at);

    const rejectedAgencyInput = { ...agencyInput, name: "QA Rejected Agency", ownerName: joiner.fullName, whatsappE164: "+919000000002" };
    await social.applyToCreateAgency(joiner, rejectedAgencyInput);
    const rejectedCreation = (await social.agencyApplicationsForUser(joiner)).find((entry) => entry.type === "create" && entry.status === "pending")!;
    await agencies.reviewAgencyCreation({ scope: master, applicationId: rejectedCreation.id, decision: "REJECTED", reason: "QA rejection creates no Agency" });
    const [rejectedAgencyRows] = await root.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?", [joiner.userId]);
    assert.equal(rejectedAgencyRows.length, 0);

    const otherOwner = await user("QA Other Agency Owner");
    await social.applyToCreateAgency(otherOwner, { ...agencyInput, name: "QA Other Agency", ownerName: otherOwner.fullName, whatsappE164: "+919000000003" });
    const otherCreation = (await social.agencyApplicationsForUser(otherOwner)).find((entry) => entry.type === "create" && entry.status === "pending")!;
    await agencies.reviewAgencyCreation({ scope: master, applicationId: otherCreation.id, decision: "APPROVED", reason: "QA create second owned Agency" });
    const [otherAgencyRows] = await root.query<RowDataPacket[]>("SELECT public_id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?", [otherOwner.userId]);
    const otherAgencyPublicId = String(otherAgencyRows[0].public_id);
    await social.applyToJoinAgency(joiner, otherAgencyPublicId);
    assert.equal((await social.agencyApplicationsForUser(joiner)).some((entry) => entry.type === "join" && entry.agencyId === otherAgencyPublicId && entry.status === "pending"), true);
    console.log("PASS Agency lifecycle: no Agency -> pending -> owner reject/reapply -> joined -> owner removed -> rejected create creates nothing -> may join another; Master-only creation approval; owner and six-digit ID visible");

    if (process.env.NAZRAA_QA_KEEP === "1") {
      const fixtures = [];
      for (const [index, identity] of [owner, guest, roomAdmin].entries()) {
        const token = `nazraa-local-core-qa-token-${index}-2026`;
        await root.execute("INSERT INTO mobile_sessions (id, application_user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY))", [randomUUID(), identity.userId, createHash("sha256").update(token).digest("hex")]);
        fixtures.push({ ...identity, token });
      }
      await writeFile("/tmp/nazraa-core-qa.json", JSON.stringify({ database, roomCode, fixtures }));
      keep = true;
      console.log(`QA fixtures retained: ${database}; /tmp/nazraa-core-qa.json`);
    }
  } finally {
    await global.nazraaPool?.end();
    if (!keep) await root.query(`DROP DATABASE \`${database}\``);
    await root.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
