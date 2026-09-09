import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import mysql, { type RowDataPacket } from "mysql2/promise";
import sharp from "sharp";
import type { MobileIdentity } from "@/lib/auth/mobile-session";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only"
        ? "next/dist/compiled/server-only/empty.js"
        : specifier,
      context,
    );
  },
});

async function main() {
  const database = `nazraa_mobile_qa_${Date.now()}`;
  const root = await mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    multipleStatements: true,
  });
  await root.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await root.query(`USE \`${database}\``);
  global.nazraaPool = mysql.createPool({
    host: "127.0.0.1",
    user: "root",
    database,
    decimalNumbers: true,
    connectionLimit: 8,
    timezone: "Z",
  });
  // Production obtains this proxy lazily in db(); the isolated harness
  // supplies its own pool, so bind the same local pool for repository calls.
  global.nazraaInstrumentedPool = global.nazraaPool;
  process.env.DOCUMENT_ENCRYPTION_KEY = "nazraa-local-mobile-qa-only-key-2026";
  let keep = false;
  try {
    for (const file of (await readdir("db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await root.query(await readFile(`db/migrations/${file}`, "utf8"));
    const playbackKey = "QAPlaybackKey123456789012345678";
    process.env.ZEGO_CDN_PLAYBACK_PRIMARY_KEY = playbackKey;
    process.env.ZEGO_CDN_PLAYBACK_URL_TTL_SECONDS = "3600";
    const playbackAuth = await import("@/lib/services/zego-cdn-playback-auth");
    const signingTime = new Date("2026-09-07T12:00:00.000Z");
    const signedPlayback = playbackAuth.signedZegoCdnPlaybackUrl(
      "qa_stream_1",
      null,
      signingTime,
    );
    assert.ok(signedPlayback);
    const signedPlaybackUri = new URL(signedPlayback);
    const expiry = signedPlaybackUri.searchParams.get("wsABStime");
    assert.equal(
      expiry,
      Math.floor(signingTime.getTime() / 1_000 + 3600)
        .toString(16)
        .toUpperCase(),
    );
    assert.equal(
      signedPlaybackUri.searchParams.get("wsSecret"),
      createHash("md5")
        .update(`${expiry}/live/qa_stream_1/playlist.m3u8${playbackKey}`)
        .digest("hex"),
    );
    assert.equal(playbackAuth.signedZegoCdnPlaybackUrl("../bad-stream"), null);
    const providerPlayback = playbackAuth.signedZegoCdnPlaybackUrl(
      "qa_stream_1",
      "https://provider-play.zegocloud.example/live/qa_stream_1/playlist.m3u8",
      signingTime,
    );
    assert.equal(
      new URL(providerPlayback!).hostname,
      "play-ws1.live.pixtra.site",
    );
    console.log(
      "PASS ZEGO CDN playback auth: server-only Wangsu signature, uppercase expiry, fixed host and stream validation",
    );
    const product = await import("@/lib/db/repositories/mobile-product");
    const liveBusiness = await import("@/lib/services/live-business-policy");
    const defaultLiveRules = liveBusiness.faceLiveRulesFromSetting({});
    assert.equal(
      liveBusiness.evaluateFaceLiveSchedule(
        defaultLiveRules,
        new Date("2026-09-05T02:29:59.000Z"),
      ).allowed,
      false,
      "07:59:59 Asia/Kolkata must be closed",
    );
    assert.equal(
      liveBusiness.evaluateFaceLiveSchedule(
        defaultLiveRules,
        new Date("2026-09-05T02:30:00.000Z"),
      ).allowed,
      true,
      "08:00:00 Asia/Kolkata must be open",
    );
    const beforeClose = liveBusiness.evaluateFaceLiveSchedule(
      defaultLiveRules,
      new Date("2026-09-05T19:29:59.000Z"),
    );
    assert.equal(
      beforeClose.allowed,
      true,
      "00:59:59 Asia/Kolkata must remain open",
    );
    assert.equal(beforeClose.secondsUntilClose, 1);
    const atClose = liveBusiness.evaluateFaceLiveSchedule(
      defaultLiveRules,
      new Date("2026-09-05T19:30:00.000Z"),
    );
    assert.equal(
      atClose.allowed,
      false,
      "01:00:00 Asia/Kolkata must be closed",
    );
    assert.equal(
      atClose.unavailableMessage,
      "Live streaming is available from 8:00 AM to 1:00 AM.",
    );
    const eligibleHost = {
      gender: "FEMALE",
      accountActive: true,
      isHost: true,
      hostProfileActive: true,
      faceVerified: true,
      agencyAuthorized: true,
      activelyRestricted: false,
      validBroadcastSession: true,
      roomType: "FACE",
    };
    assert.deepEqual(
      liveBusiness.liveHourlyRewardEligibility(defaultLiveRules, eligibleHost),
      {
        eligible: true,
        diamondsPerHour: 3500,
        reason: "ELIGIBLE",
      },
    );
    assert.deepEqual(
      liveBusiness.liveHourlyRewardEligibility(defaultLiveRules, {
        ...eligibleHost,
        gender: "MALE",
      }),
      {
        eligible: true,
        diamondsPerHour: 3500,
        reason: "ELIGIBLE",
      },
    );
    assert.equal(
      liveBusiness.faceLiveRulesFromSetting({ hourlyRewardDiamonds: 4200 })
        .maleHourlyRewardDiamonds,
      4200,
    );
    console.log(
      "PASS Face Live policy: server timezone boundaries 07:59/08:00/00:59/01:00; every eligible Host receives the once-daily 3,500 first-hour reward",
    );
    const gameConfig = await import("@/lib/games/game-config");
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.teen_patti_pro.targetWinRate,
      0.5,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.teen_patti_pro.bettingSeconds,
      12,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.teen_patti_pro.resultSeconds,
      3,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.luck77.targetWinRate,
      0.5,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.luck77.bettingSeconds,
      8,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.jungle_hunt.targetWinRate,
      0.4,
    );
    assert.equal(
      gameConfig.defaultMobileGamesConfig.games.jungle_hunt
        .maximumPayoutMultiplier,
      20,
    );
    assert.equal(product.giftDiamondValue(100), 97);
    assert.equal(product.giftDiamondValue(1000), 970);
    assert.equal(product.giftDiamondValue(100000), 97000);
    assert.deepEqual([...product.teenPattiLaneMultiplierTenths], [27, 29, 28]);
    assert.deepEqual(
      [0, 1, 2].map((lane) => product.teenPattiLanePayout(lane, 500)),
      [1350, 1450, 1400],
    );
    const social = await import("@/lib/db/repositories/mobile-social");
    const rooms = await import("@/lib/db/repositories/mobile-completion");
    const mediaAuthority = await import("@/lib/services/room-media-authority");
    const rewards = await import("@/lib/db/repositories/mobile-rewards");
    const cosmetics = await import("@/lib/db/repositories/mobile-cosmetics");
    const catalog = await import("@/lib/db/repositories/catalog");
    const completionAdmin =
      await import("@/lib/db/repositories/completion-administration");
    const monthlyReset =
      await import("@/lib/db/repositories/monthly-host-reset");
    const operations = await import("@/lib/db/repositories/operations");
    const mobileAdministration =
      await import("@/lib/db/repositories/mobile-administration");
    const withdrawalFinance =
      await import("@/lib/db/repositories/withdrawal-finance");
    const seats = await import("@/lib/db/repositories/mobile-seats");
    const accounts = await import("@/lib/db/repositories/accounts");
    const admin = await import("@/lib/db/repositories/administration");
    const agencies = await import("@/lib/db/repositories/agency-applications");
    const images = await import("@/lib/security/public-images");
    await accounts.createInitialMaster({
      publicId: 100001,
      fullName: "QA Master",
      password: "Local-QA-Only-2026!",
    });
    const master = await accounts.scopeFor(
      (await accounts.accountByManagementId("100001"))!,
    );
    // Production already has a Master when 0068 runs. Re-run this idempotent
    // migration after the isolated QA Master is created so its catalogue seed
    // is covered by the same integration suite.
    await root.query(
      await readFile(
        "db/migrations/0068_daily_live_reward_and_premium_catalog.sql",
        "utf8",
      ),
    );
    await root.query(
      await readFile(
        "db/migrations/0069_game_room_effect_reliability.sql",
        "utf8",
      ),
    );
    const [premiumCatalogRows] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM gift_catalog WHERE gift_key LIKE 'mall_%_frame' OR category LIKE 'VIP %'",
    );
    assert.equal(
      Number(premiumCatalogRows[0].count),
      23,
      "all 23 premium frame, entry, profile, chat, badge and medal assets must be published",
    );
    const currentUtcMinutes =
      new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    const qaClock = (offset: number) => {
      const total = (currentUtcMinutes + offset + 1440) % 1440;
      return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    };
    const qaLiveRules = {
      ...defaultLiveRules,
      timezone: "UTC",
      startTime: qaClock(-480),
      endTime: qaClock(480),
    };
    await global.nazraaPool!.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES ('mobile.live_rules', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify(qaLiveRules), master.account.id],
    );
    const country = await admin.createPlatformAccount({
      scope: master,
      role: "COUNTRY_MANAGER",
      fullName: "QA Country",
      countryCode: "IN",
      password: "Local-QA-Only-2026!",
      documents: [],
    });
    const superAdmin = await admin.createPlatformAccount({
      scope: master,
      role: "SUPER_ADMIN",
      requestedParentId: country.accountId,
      fullName: "QA Super Admin",
      countryCode: "IN",
      password: "Local-QA-Only-2026!",
      documents: [],
    });
    const parent = await admin.createPlatformAccount({
      scope: master,
      role: "ADMIN",
      requestedParentId: superAdmin.accountId,
      fullName: "QA Parent Admin",
      countryCode: "IN",
      password: "Local-QA-Only-2026!",
      documents: [],
    });
    const qaAgency = await admin.createPlatformAccount({
      scope: master,
      role: "AGENCY",
      requestedParentId: parent.accountId,
      fullName: "QA Agency",
      countryCode: "IN",
      password: "Local-QA-Only-2026!",
      documents: [],
    });
    const parentAccount = (await accounts.accountByManagementId(
      String(parent.publicId),
    ))!;
    const parentScope = await accounts.scopeFor(parentAccount);
    for (const kind of ["PARTY", "LIVE", "FACE"])
      await root.execute(
        "INSERT INTO host_reward_rules (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by) VALUES (?, ?, ?, 60, TRUE, '2020-01-01', ?)",
        [randomUUID(), kind, kind === "PARTY" ? 0 : 3500, master.account.id],
      );
    for (let day = 1; day <= 7; day += 1)
      await root.execute(
        "INSERT INTO daily_reward_rules (id, day_number, reward_coins, label, updated_by) VALUES (?, ?, ?, ?, ?)",
        [randomUUID(), day, day * 10, `Day ${day}`, master.account.id],
      );
    await root.execute(
      "INSERT INTO gift_catalog (id, gift_key, name, category, coin_price, animation_key, created_by) VALUES (?, 'qa_rose', 'QA Rose', 'Popular', 50, 'gift.qa_rose', ?)",
      [randomUUID(), master.account.id],
    );
    async function user(
      name: string,
      gender: "FEMALE" | "MALE" = "FEMALE",
    ): Promise<MobileIdentity> {
      const id = randomUUID();
      await root.execute(
        "INSERT INTO application_users (id, external_user_id, full_name, gender, country_code, face_verification_status, onboarding_completed, is_host) VALUES (?, ?, ?, ?, 'IN', 'VERIFIED', TRUE, TRUE)",
        [id, id, name, gender],
      );
      const [rows] = await root.query<RowDataPacket[]>(
        "SELECT public_id FROM application_users WHERE id = ?",
        [id],
      );
      await root.execute(
        "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES (?, 'APPLICATION_USER', ?, 'COIN', 5000)",
        [randomUUID(), id],
      );
      await root.execute(
        "INSERT INTO host_profiles (id, application_user_id, status, verification_status) VALUES (?, ?, 'ACTIVE', 'VERIFIED')",
        [randomUUID(), id],
      );
      await root.execute(
        `INSERT INTO policy_acceptances (application_user_id, policy_key, policy_version, source)
         VALUES (?, 'terms', '2026-09-06', 'IN_APP'), (?, 'community-guidelines', '2026-09-06', 'IN_APP')`,
        [id, id],
      );
      return {
        userId: id,
        publicId: String(rows[0].public_id),
        externalUserId: id,
        fullName: name,
        gender,
        role: "HOST",
        accountStatus: "ACTIVE",
        faceVerificationStatus: "VERIFIED",
        agencyAccountId: null,
        agencyFaceLiveAuthorized: true,
        superAdminFaceLiveAuthorized: true,
        hostAccessOverride: false,
        hostProfileStatus: "ACTIVE",
        liveRestricted: false,
        liveRestrictedUntil: null,
        liveRestrictionReason: null,
        temporaryLiveRestricted: false,
        temporaryLiveRestrictedUntil: null,
        temporaryLiveRestrictionReason: null,
        hostingSuspended: false,
        hostingSuspendedUntil: null,
        hostingSuspensionReason: null,
      };
    }
    const owner = await user("QA Room Owner");
    const guest = await user("QA Audience");
    const roomAdmin = await user("QA Room Admin");
    const stranger = await user("QA Other Branch");
    owner.agencyAccountId = qaAgency.accountId;
    await root.execute(
      "UPDATE application_users SET agency_account_id = ? WHERE id = ?",
      [qaAgency.accountId, owner.userId],
    );

    const remotePreviewV1 = await sharp(randomBytes(128 * 128 * 4), {
      raw: { width: 128, height: 128, channels: 4 },
    })
      .webp({ quality: 82 })
      .toBuffer();
    const remotePreviewV2 = await sharp(randomBytes(144 * 144 * 4), {
      raw: { width: 144, height: 144, channels: 4 },
    })
      .webp({ quality: 82 })
      .toBuffer();
    const remoteEffectConfig = {
      width: 720,
      height: 720,
      durationMs: 2200,
      loop: false,
      position: "CENTER" as const,
      zIndex: 10,
      soundVolume: 0.8,
      priority: 450,
      displayMode: "AUTO" as const,
      presentationTier: "PREMIUM" as const,
      gameBehavior: "COMPACT" as const,
      modalBehavior: "COMPACT" as const,
    };
    await catalog.createGift({
      scope: master,
      key: "qa_remote_entry",
      name: "QA Remote Entry",
      category: "Entry",
      catalogType: "ENTRY_EFFECT",
      coinPrice: 1500,
      validityDays: 30,
      vipTierEligibility: 2,
      sortOrder: 11,
      accentHex: "#8a5cff",
      image: {
        mimeType: "image/webp",
        data: remotePreviewV1,
        byteSize: remotePreviewV1.length,
        originalName: "qa-remote-entry-v1.webp",
      },
      effectConfig: remoteEffectConfig,
    });
    const initialRemoteCatalog = (await product.mobileBootstrap(owner))
      .mallCatalog;
    const initialRemoteItem = initialRemoteCatalog.find(
      (item) => item.id === "qa_remote_entry",
    );
    assert.ok(
      initialRemoteItem?.visualUrl?.startsWith(
        "https://nazraa.vercel.app/api/v1/assets/gifts/",
      ),
      "uploaded assets must receive an internal URL automatically",
    );
    assert.equal(initialRemoteItem?.assetConfig.presentationTier, "PREMIUM");
    const remoteCatalogId = (await catalog.listGifts()).find(
      (item) => item.key === "qa_remote_entry",
    )!.id;
    const firstRemoteAssetUrl = initialRemoteItem!.visualUrl;
    await catalog.updateGift({
      scope: master,
      id: remoteCatalogId,
      name: "QA Remote Entry Replaced",
      category: "Entry",
      catalogType: "ENTRY_EFFECT",
      artworkMode: "IMAGE",
      coinPrice: 1700,
      validityDays: 45,
      vipTierEligibility: 3,
      sortOrder: 12,
      accentHex: "#ff4fa2",
      image: {
        mimeType: "image/webp",
        data: remotePreviewV2,
        byteSize: remotePreviewV2.length,
        originalName: "qa-remote-entry-v2.webp",
      },
      effectConfig: { ...remoteEffectConfig, priority: 500 },
      reason: "QA remote replacement verification",
    });
    const replacedRemoteItem = (
      await product.mobileBootstrap(owner)
    ).mallCatalog.find((item) => item.id === "qa_remote_entry");
    assert.notEqual(
      replacedRemoteItem?.visualUrl,
      firstRemoteAssetUrl,
      "asset replacement must be visible without an APK build",
    );
    assert.deepEqual(
      [
        replacedRemoteItem?.cost,
        replacedRemoteItem?.validityDays,
        replacedRemoteItem?.vipTierEligibility,
      ],
      [1700, 45, 3],
    );
    assert.equal(replacedRemoteItem?.assetConfig.priority, 500);
    await catalog.setGiftActive({
      scope: master,
      id: remoteCatalogId,
      active: false,
    });
    assert.equal(
      (await product.mobileBootstrap(owner)).mallCatalog.some(
        (item) => item.id === "qa_remote_entry",
      ),
      false,
      "disabled assets must disappear on the next app refresh",
    );
    await catalog.setGiftActive({
      scope: master,
      id: remoteCatalogId,
      active: true,
    });
    assert.equal(
      (await product.mobileBootstrap(owner)).mallCatalog.some(
        (item) => item.id === "qa_remote_entry",
      ),
      true,
      "re-enabled assets must return without an APK build",
    );
    console.log(
      "PASS Master cosmetics runtime: upload, internal URL, preview metadata, replace, reprice, retier, reprioritize, disable/enable and app refresh without APK",
    );

    const boundaryFaceCode = `QABOUNDARYFACE${Date.now()}`;
    const boundaryPartyCode = `QABOUNDARYPARTY${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: boundaryFaceCode,
      kind: "face",
      title: "QA Boundary Face",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await product.createRoom(owner, {
      roomCode: boundaryPartyCode,
      kind: "party",
      title: "QA Boundary Party",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 8,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    const blockedQaRules = {
      ...qaLiveRules,
      startTime: qaClock(60),
      endTime: qaClock(120),
    };
    await root.execute(
      "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'mobile.live_rules'",
      [JSON.stringify(blockedQaRules)],
    );
    await assert.rejects(
      product.createRoom(owner, {
        roomCode: `QABLOCKEDFACE${Date.now()}`,
        kind: "face",
        title: "QA Blocked Face",
        category: "Talk",
        language: "Hindi",
        privacy: "public",
        seatCount: 0,
        themeIndex: 0,
        themeEnabled: false,
        countryCode: "IN",
        // Proves the schedule rejection occurs before expensive/invalid asset
        // decoding and therefore before any RTC-token path.
        photoDataUrl: "data:image/png;base64,not-valid-image-data",
      }),
      /Live streaming is available from/,
    );
    const outsideHoursParty = await product.createRoom(owner, {
      roomCode: `QAPARTYANYTIME${Date.now()}`,
      kind: "party",
      title: "QA Party Any Time",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 8,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    const boundaryDiscovery = await product.activeRoomPage();
    assert.equal(
      boundaryDiscovery.some((room) => room.id === boundaryFaceCode),
      false,
      "closed Face Live must leave discovery at the server boundary",
    );
    assert.equal(
      boundaryDiscovery.some((room) => room.id === boundaryPartyCode),
      true,
      "Face Live hours must never auto-end Party Audio",
    );
    const [boundaryStates] = await root.query<RowDataPacket[]>(
      "SELECT room_code, status FROM live_rooms WHERE room_code IN (?, ?) ORDER BY room_code",
      [boundaryFaceCode, boundaryPartyCode],
    );
    assert.equal(
      boundaryStates.find((room) => room.room_code === boundaryFaceCode)
        ?.status,
      "ENDED",
    );
    assert.equal(
      boundaryStates.find((room) => room.room_code === boundaryPartyCode)
        ?.status,
      "ACTIVE",
    );
    await rooms.finalizeLiveSession(owner, boundaryPartyCode);
    await rooms.finalizeLiveSession(owner, outsideHoursParty.roomCode);
    await root.execute(
      "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'mobile.live_rules'",
      [JSON.stringify(qaLiveRules)],
    );
    console.log(
      "PASS Live boundary integration: reject before asset/RTC work; discovery auto-end Face; Party remains available",
    );
    await global.nazraaPool!.execute(
      "UPDATE application_users SET face_verification_status = 'NOT_SUBMITTED', agency_face_live_authorized = FALSE, super_admin_face_live_authorized = FALSE WHERE id = ?",
      [guest.userId],
    );
    const existingAndroidSelfie = await sharp({
      create: { width: 720, height: 960, channels: 3, background: "#b48a72" },
    })
      .jpeg({ quality: 96 })
      .toBuffer();
    const faceSubmissionId = randomUUID();
    const faceResult = await rooms.submitAutomaticFaceVerification(guest, {
      framesBase64: [existingAndroidSelfie.toString("base64")],
      consentVersion: "nazraa-biometric-1.0",
      clientSubmissionId: faceSubmissionId,
    });
    assert.equal(faceResult.status, "pending");
    const duplicateFaceResult = await rooms.submitAutomaticFaceVerification(
      guest,
      {
        framesBase64: [existingAndroidSelfie.toString("base64")],
        consentVersion: "nazraa-biometric-1.0",
        clientSubmissionId: faceSubmissionId,
      },
    );
    assert.equal(
      duplicateFaceResult.id,
      faceResult.id,
      "upload retries must resolve to one durable request",
    );
    const [faceRows] = await root.query<RowDataPacket[]>(
      "SELECT face_verification_status, agency_face_live_authorized, super_admin_face_live_authorized FROM application_users WHERE id = ?",
      [guest.userId],
    );
    assert.equal(faceRows[0].face_verification_status, "PENDING");
    assert.equal(Number(faceRows[0].agency_face_live_authorized), 0);
    assert.equal(Number(faceRows[0].super_admin_face_live_authorized), 0);
    const [privateSelfieRows] = await root.query<RowDataPacket[]>(
      "SELECT document.encrypted_data, document.mime_type FROM private_documents document INNER JOIN face_verification_requests request ON request.selfie_document_id = document.id WHERE request.id = ?",
      [faceResult.id],
    );
    assert.ok(
      Buffer.from(privateSelfieRows[0].encrypted_data).length > 1000,
      "selfie must be durably encrypted before submission success",
    );
    assert.equal(privateSelfieRows[0].mime_type, "image/jpeg");
    await mobileAdministration.reviewFaceVerification({
      scope: master,
      requestId: String(faceResult.id),
      decision: "VERIFIED",
      reason: "QA authorized reviewer approval",
    });
    const [approvedFaceRows] = await root.query<RowDataPacket[]>(
      "SELECT face_verification_status, agency_face_live_authorized, super_admin_face_live_authorized FROM application_users WHERE id = ?",
      [guest.userId],
    );
    assert.equal(approvedFaceRows[0].face_verification_status, "VERIFIED");
    assert.equal(Number(approvedFaceRows[0].agency_face_live_authorized), 1);
    assert.equal(
      Number(approvedFaceRows[0].super_admin_face_live_authorized),
      1,
    );
    console.log(
      "PASS Face Verification upload: EXIF-safe JPEG normalization, encrypted durable storage, idempotent retry, manual approval/status sync",
    );
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#7450ad" },
    })
      .png()
      .toBuffer();
    const photo = `data:image/png;base64,${png.toString("base64")}`;
    const image = await images.publicImageFromDataUrl(
      photo,
      1_500_000,
      "QA photo",
    );
    assert.ok(image.byteSize < 1000, "Small optimized photos must be accepted");
    await assert.rejects(
      images.publicImageFromDataUrl(
        photo.replace("image/png", "image/jpeg"),
        1_500_000,
        "QA photo",
      ),
    );
    const post = await social.createDiscoveryPost(owner, {
      caption: "Text-only QA post",
    });
    const photoPost = await social.createDiscoveryPost(owner, {
      caption: "Photo QA post",
      photoDataUrl: photo,
    });
    await assert.rejects(social.createDiscoveryPost(owner, { caption: " " }));
    const posts = await social.discoveryPosts();
    assert.equal(posts.find((entry) => entry.id === post.id)?.type, "text");
    assert.equal(
      posts.find((entry) => entry.id === photoPost.id)?.type,
      "photo",
    );
    await assert.rejects(social.deleteDiscoveryPost(guest, post.id));
    console.log(
      "PASS photos: compressed small image, MIME validation, text-only/photo posts, ownership",
    );

    const clientMessageId = randomUUID();
    const ownerCoinsBeforeMessages = (await product.mobileBootstrap(owner))
      .wallet.coins;
    const firstMessage = await social.sendPrivateMessage(owner, {
      recipientPublicId: guest.publicId,
      body: "QA request",
      clientMessageId,
    });
    assert.equal(firstMessage.coinCost, 10);
    assert.equal(
      (await social.privateMessagingForUser(guest)).messages[0]
        .conversationStatus,
      "pending",
    );
    await assert.rejects(
      social.respondToPrivateRequest(owner, {
        targetPublicId: guest.publicId,
        accept: true,
      }),
    );
    await assert.rejects(
      social.respondToPrivateRequest(stranger, {
        targetPublicId: owner.publicId,
        accept: true,
      }),
    );
    await assert.rejects(
      social.sendPrivateMessage(owner, {
        recipientPublicId: guest.publicId,
        body: "Spam",
        clientMessageId: randomUUID(),
      }),
    );
    await social.respondToPrivateRequest(guest, {
      targetPublicId: owner.publicId,
      accept: true,
    });
    await social.sendPrivateMessage(guest, {
      recipientPublicId: owner.publicId,
      body: "Accepted reply",
      clientMessageId: randomUUID(),
    });
    assert.ok(
      (await social.privateMessagingForUser(owner)).messages.every(
        (message) => message.conversationStatus === "accepted",
      ),
    );
    assert.equal(
      (await social.privateMessagingForUser(stranger)).messages.length,
      0,
    );
    const duplicateMessage = await social.sendPrivateMessage(owner, {
      recipientPublicId: guest.publicId,
      body: "QA request",
      clientMessageId,
    });
    assert.equal(duplicateMessage.alreadySent, true);
    assert.equal(duplicateMessage.paidMessagesToday, 1);
    for (let index = 2; index <= 20; index += 1) {
      const paid = await social.sendPrivateMessage(owner, {
        recipientPublicId: guest.publicId,
        body: `Paid DM ${index}`,
        clientMessageId: randomUUID(),
      });
      assert.equal(paid.coinCost, 10);
      assert.equal(paid.paidMessagesToday, index);
    }
    const freeMessage = await social.sendPrivateMessage(owner, {
      recipientPublicId: guest.publicId,
      body: "Free DM 21",
      clientMessageId: randomUUID(),
    });
    assert.equal(freeMessage.coinCost, 0);
    assert.equal(freeMessage.remainingPaidMessages, 0);
    assert.equal(freeMessage.nextMessageCoinCost, 0);
    const ownerMessaging = await social.privateMessagingForUser(owner);
    assert.equal(ownerMessaging.dailyPaidLimit, 20);
    assert.equal(ownerMessaging.paidMessagesToday, 20);
    assert.equal(ownerMessaging.totalMessagesToday, 21);
    assert.equal(ownerMessaging.remainingPaidMessages, 0);
    assert.equal(ownerMessaging.nextMessageCoinCost, 0);
    assert.equal(
      (await product.mobileBootstrap(owner)).wallet.coins,
      ownerCoinsBeforeMessages - 200,
    );
    const [messageLedger] = await root.query<RowDataPacket[]>(
      "SELECT transaction_type, COUNT(*) count FROM ledger_transactions WHERE source_id = ? AND transaction_type IN ('PRIVATE_MESSAGE','PRIVATE_MESSAGE_FREE') GROUP BY transaction_type",
      [owner.userId],
    );
    assert.equal(
      Number(
        messageLedger.find((row) => row.transaction_type === "PRIVATE_MESSAGE")
          ?.count,
      ),
      20,
    );
    assert.equal(
      Number(
        messageLedger.find(
          (row) => row.transaction_type === "PRIVATE_MESSAGE_FREE",
        )?.count,
      ),
      1,
    );
    await social.sendPrivateMessage(stranger, {
      recipientPublicId: guest.publicId,
      body: "Second request",
      clientMessageId: randomUUID(),
    });
    await social.respondToPrivateRequest(guest, {
      targetPublicId: stranger.publicId,
      accept: false,
    });
    await assert.rejects(
      social.sendPrivateMessage(stranger, {
        recipientPublicId: guest.publicId,
        body: "Declined",
        clientMessageId: randomUUID(),
      }),
    );
    assert.deepEqual(
      (await social.searchPrivateMessageRecipients(owner, "Q")).people,
      [],
    );
    const recipientSearch = await social.searchPrivateMessageRecipients(
      owner,
      "Audience",
    );
    assert.deepEqual(
      recipientSearch.people.map((entry) => entry.id),
      [guest.publicId],
    );
    const recipientIdSearch = await social.searchPrivateMessageRecipients(
      owner,
      guest.publicId,
    );
    assert.equal(recipientIdSearch.people[0]?.id, guest.publicId);
    assert.equal(
      recipientIdSearch.people.some((entry) => entry.id === owner.publicId),
      false,
    );
    console.log(
      "PASS Inbox: pending/accepted/rejected, daily 20×10-coin allowance, free remainder, server counter, idempotent charge",
    );

    const roomCode = `QA${Date.now()}`;
    await product.createRoom(owner, {
      roomCode,
      kind: "party",
      title: "QA Manual Room",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 10,
      themeIndex: 0,
      themeEnabled: false,
      photoDataUrl: photo,
      countryCode: "IN",
    });
    await rooms.joinLiveRoom(guest, roomCode);
    await rooms.joinLiveRoom(roomAdmin, roomCode);
    await rooms.updateRoomSettings(owner, {
      roomCode,
      themeIndex: 6,
      themeEnabled: true,
      removePassword: false,
      resetTopDp: false,
    });
    const persistedTheme = await rooms.refreshRoomPresence(guest, roomCode);
    assert.equal(persistedTheme.themeIndex, 6);
    assert.equal(persistedTheme.themeEnabled, true);
    await rooms.sendRoomChat(roomAdmin, {
      roomCode,
      body: "Public room chat requires no friendship",
      clientMessageId: randomUUID(),
    });
    assert.equal(
      (await rooms.refreshRoomPresence(owner, roomCode)).messages?.at(-1)?.body,
      "Public room chat requires no friendship",
    );
    await rooms.clearRoomChat(owner, roomCode);
    assert.equal(
      (await rooms.refreshRoomPresence(guest, roomCode)).messages?.length,
      0,
    );
    console.log(
      "PASS Party persistence/chat: authoritative theme 6 restored; non-friend room chat allowed; staff clear hides only live feed messages",
    );
    const [joinedSeats] = await root.query<RowDataPacket[]>(
      `SELECT seat_index FROM live_room_members
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)
         AND application_user_id IN (?, ?)`,
      [roomCode, guest.userId, roomAdmin.userId],
    );
    assert.equal(
      joinedSeats.every((row) => row.seat_index == null),
      true,
      "joining must never auto-fill Couple Seats",
    );
    await rooms.setRoomAdmin(owner, {
      roomCode,
      targetPublicId: roomAdmin.publicId,
      makeAdmin: true,
    });
    await assert.rejects(rooms.roomPublishingDecision(guest, roomCode));
    await seats.actOnRoomSeat(guest, {
      roomCode,
      action: "request",
      seatIndex: 0,
    });
    const before = await rooms.refreshRoomPresence(owner, roomCode, true, {
      connectionPhase: "connected",
      reconnectCount: 2,
      publishing: true,
      playbackActive: true,
      lastTerminalErrorCategory: null,
      activeSpeakers: 1,
      passiveViewers: 2,
      animationQueueLength: 3,
      messageDeliveryLatencyMs: 145,
    });
    assert.equal(before.seatRequests?.[0].userId, guest.publicId);
    const [runtimeDiagnostics] = await root.query<RowDataPacket[]>(
      `SELECT connection_phase, reconnect_count, publish_state, playback_state,
              active_speakers, passive_viewers, animation_queue_length,
              message_delivery_latency_ms
       FROM live_media_usage
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)
         AND application_user_id = ? AND usage_type = 'PARTY_SPEAKER_RTC'`,
      [roomCode, owner.userId],
    );
    assert.deepEqual(
      {
        phase: runtimeDiagnostics[0].connection_phase,
        reconnects: Number(runtimeDiagnostics[0].reconnect_count),
        publishing: Boolean(runtimeDiagnostics[0].publish_state),
        playback: Boolean(runtimeDiagnostics[0].playback_state),
        speakers: Number(runtimeDiagnostics[0].active_speakers),
        passive: Number(runtimeDiagnostics[0].passive_viewers),
        effects: Number(runtimeDiagnostics[0].animation_queue_length),
        latency: Number(runtimeDiagnostics[0].message_delivery_latency_ms),
      },
      {
        phase: "connected",
        reconnects: 2,
        publishing: true,
        playback: true,
        speakers: 1,
        passive: 2,
        effects: 3,
        latency: 145,
      },
      "room runtime diagnostics must be durable without raw SDK details",
    );
    await assert.rejects(
      seats.actOnRoomSeat(guest, {
        roomCode,
        action: "accept",
        targetPublicId: guest.publicId,
      }),
    );
    await assert.rejects(
      seats.actOnRoomSeat(stranger, {
        roomCode,
        action: "accept",
        targetPublicId: guest.publicId,
      }),
    );
    await seats.actOnRoomSeat(roomAdmin, {
      roomCode,
      action: "accept",
      targetPublicId: guest.publicId,
    });
    const accepted = await rooms.refreshRoomPresence(guest, roomCode);
    assert.equal(accepted.roomRole, "speaker");
    assert.equal(accepted.seatIndex, 0);
    assert.equal(
      (await rooms.roomPublishingDecision(guest, roomCode)).allowed,
      true,
    );
    await assert.rejects(
      seats.actOnRoomSeat(roomAdmin, {
        roomCode,
        action: "request",
        seatIndex: 0,
      }),
    );
    await seats.actOnRoomSeat(guest, { roomCode, action: "leave" });
    await assert.rejects(rooms.roomPublishingDecision(guest, roomCode));
    await seats.actOnRoomSeat(owner, {
      roomCode,
      action: "assign",
      seatIndex: 1,
      targetPublicId: guest.publicId,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, roomCode)).seatIndex,
      1,
    );
    await seats.actOnRoomSeat(guest, { roomCode, action: "leave" });
    await seats.actOnRoomSeat(guest, {
      roomCode,
      action: "request",
      seatIndex: 2,
    });
    await seats.actOnRoomSeat(owner, {
      roomCode,
      action: "reject",
      targetPublicId: guest.publicId,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, roomCode)).seatRequests?.[0]
        .status,
      "rejected",
    );
    await seats.actOnRoomSeat(owner, {
      roomCode,
      action: "lock",
      seatIndex: 2,
    });
    assert.deepEqual(
      (await rooms.refreshRoomPresence(guest, roomCode)).lockedSeatIndexes,
      [2],
    );
    await assert.rejects(
      seats.actOnRoomSeat(guest, { roomCode, action: "request", seatIndex: 2 }),
      /locked/,
    );
    await assert.rejects(
      seats.actOnRoomSeat(guest, { roomCode, action: "unlock", seatIndex: 2 }),
      /Only the Room Owner/,
    );
    await seats.actOnRoomSeat(roomAdmin, {
      roomCode,
      action: "unlock",
      seatIndex: 2,
    });
    assert.deepEqual(
      (await rooms.refreshRoomPresence(owner, roomCode)).lockedSeatIndexes,
      [],
    );
    console.log(
      "PASS seat permissions: Couple Seats stay empty; per-seat Lock/Unlock persists server-side; request/accept, assignment, rejection, leave and foreign denial",
    );

    // Kick Out is a scoped room block. It must close this membership and media
    // grant, deny only this room's re-entry, remain visible to staff, and be
    // reversible without touching account/device/Live moderation state.
    await rooms.kickRoomMember(owner, {
      roomCode,
      targetPublicId: guest.publicId,
    });
    await assert.rejects(
      rooms.joinLiveRoom(guest, roomCode),
      /blocked you from this Live/,
    );
    const blockedUsers = await rooms.listRoomBlockedUsers(owner, roomCode);
    assert.equal(blockedUsers.blockedUsers.length, 1);
    assert.equal(blockedUsers.blockedUsers[0].publicId, guest.publicId);
    const unrelatedRoomCode = `QAB${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: unrelatedRoomCode,
      kind: "party",
      title: "QA Other Party",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 8,
      themeIndex: 0,
      themeEnabled: false,
      photoDataUrl: photo,
      countryCode: "IN",
    });
    await rooms.joinLiveRoom(guest, unrelatedRoomCode);
    await rooms.unblockRoomMember(owner, {
      roomCode,
      targetPublicId: guest.publicId,
    });
    assert.equal(
      (await rooms.listRoomBlockedUsers(owner, roomCode)).blockedUsers.length,
      0,
    );
    await rooms.joinLiveRoom(guest, roomCode);
    const [roomBlockRows] = await root.query<RowDataPacket[]>(
      `SELECT active, removed_at, removed_by_application_user_id
       FROM live_room_blocks WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)
         AND application_user_id = ?`,
      [roomCode, guest.userId],
    );
    assert.equal(Boolean(roomBlockRows[0].active), false);
    assert.ok(roomBlockRows[0].removed_at);
    assert.equal(
      String(roomBlockRows[0].removed_by_application_user_id),
      owner.userId,
    );
    console.log(
      "PASS room Kick Out: room-specific exclusion, unrelated-room access, Owner/Admin list and audited unblock",
    );

    const videoRoomCode = `QAV${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: videoRoomCode,
      kind: "legacy-client-value",
      title: "QA Legacy Normalization",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    const [normalizedRooms] = await root.query<RowDataPacket[]>(
      "SELECT room_type FROM live_rooms WHERE room_code = ?",
      [videoRoomCode],
    );
    assert.equal(
      normalizedRooms[0]?.room_type,
      "FACE",
      "a legacy non-party room must normalize to Face Live",
    );
    await rooms.joinLiveRoom(guest, videoRoomCode);
    await rooms.requestLiveCoHost(guest, videoRoomCode);
    assert.equal(
      (await rooms.refreshRoomPresence(owner, videoRoomCode))
        .coHostRequests?.[0]?.userId,
      guest.publicId,
    );
    await assert.rejects(
      rooms.respondLiveCoHost(stranger, {
        roomCode: videoRoomCode,
        targetPublicId: guest.publicId,
        accept: true,
      }),
    );
    await rooms.respondLiveCoHost(owner, {
      roomCode: videoRoomCode,
      targetPublicId: guest.publicId,
      accept: true,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, videoRoomCode)).roomRole,
      "speaker",
    );
    assert.equal(
      (await rooms.roomPublishingDecision(guest, videoRoomCode)).allowed,
      true,
    );
    await rooms.endLiveCoHost(guest, { roomCode: videoRoomCode });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, videoRoomCode)).roomRole,
      "audience",
    );
    await assert.rejects(rooms.roomPublishingDecision(guest, videoRoomCode));
    await rooms.requestLiveCoHost(guest, videoRoomCode);
    await rooms.respondLiveCoHost(owner, {
      roomCode: videoRoomCode,
      targetPublicId: guest.publicId,
      accept: false,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, videoRoomCode))
        .coHostRequests?.[0]?.status,
      "rejected",
    );
    console.log(
      "PASS Face-only compatibility: legacy room values normalize to Face; audio request, owner accept/reject, publish grant, disconnect and token denial",
    );

    const faceRoomCode = `QAF${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: faceRoomCode,
      kind: "face",
      title: "QA Face Broadcast",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await rooms.joinLiveRoom(guest, faceRoomCode);
    await rooms.joinLiveRoom(stranger, faceRoomCode);
    const hostMediaGrant = await mediaAuthority.authorizeRoomRtc(owner, {
      roomCode: faceRoomCode,
      canPublish: true,
    });
    assert.equal(hostMediaGrant.mediaRole, "HOST");
    assert.equal(hostMediaGrant.publishMode, "video_audio");
    assert.equal(
      hostMediaGrant.streamId,
      `${faceRoomCode}_${owner.publicId}_main`,
    );
    await assert.rejects(
      mediaAuthority.authorizeRoomRtc(guest, {
        roomCode: faceRoomCode,
        canPublish: true,
      }),
      /Audio Request/,
    );
    const fallbackViewerGrant = await mediaAuthority.authorizeRoomRtc(guest, {
      roomCode: faceRoomCode,
      canPublish: false,
    });
    assert.equal(fallbackViewerGrant.mediaRole, "PASSIVE_VIEWER");
    assert.equal(fallbackViewerGrant.publishMode, "none");
    await assert.rejects(
      rooms.roomPublishingDecision(guest, faceRoomCode),
      /audio request/,
    );
    await rooms.requestLiveCoHost(guest, faceRoomCode);
    await rooms.requestLiveCoHost(stranger, faceRoomCode);
    assert.equal(
      (await rooms.refreshRoomPresence(owner, faceRoomCode)).coHostRequests
        ?.length,
      2,
    );
    await rooms.respondLiveCoHost(owner, {
      roomCode: faceRoomCode,
      targetPublicId: guest.publicId,
      accept: true,
    });
    await rooms.respondLiveCoHost(owner, {
      roomCode: faceRoomCode,
      targetPublicId: stranger.publicId,
      accept: true,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, faceRoomCode)).roomRole,
      "speaker",
    );
    assert.equal(
      (await rooms.roomPublishingDecision(guest, faceRoomCode)).allowed,
      true,
    );
    const audioGuestGrant = await mediaAuthority.authorizeRoomRtc(guest, {
      roomCode: faceRoomCode,
      canPublish: true,
    });
    assert.equal(audioGuestGrant.mediaRole, "AUDIO_GUEST");
    assert.equal(audioGuestGrant.publishMode, "audio_only");
    assert.equal(
      (
        await rooms.refreshRoomPresence(owner, faceRoomCode)
      ).participants?.filter(
        (participant: { roomRole: string }) =>
          participant.roomRole === "speaker",
      ).length,
      2,
    );
    await rooms.endLiveCoHost(owner, {
      roomCode: faceRoomCode,
      targetPublicId: guest.publicId,
    });
    assert.equal(
      (await rooms.refreshRoomPresence(guest, faceRoomCode)).roomRole,
      "audience",
    );
    assert.equal(
      (await rooms.refreshRoomPresence(stranger, faceRoomCode)).roomRole,
      "speaker",
      "disconnecting B must not disconnect audio guest C",
    );
    await assert.rejects(
      mediaAuthority.authorizeRoomRtc(guest, {
        roomCode: faceRoomCode,
        canPublish: true,
      }),
      /Audio Request/,
    );
    const [faceRoomRows] = await root.query<RowDataPacket[]>(
      "SELECT id FROM live_rooms WHERE room_code = ?",
      [faceRoomCode],
    );
    await root.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES ('mobile.room_features', JSON_OBJECT(
         'facePassivePlaybackMode', 'live_streaming',
         'partyPassivePlaybackMode', 'live_streaming',
         'partyStreamingThreshold', 8,
         'paidMediaRoutingEnabled', TRUE,
         'streamMixingEnabled', TRUE,
         'emergencyRtcFallbackEnabled', FALSE,
         'rtcPassiveFallbackCeiling', 3
       ), ?)
       ON DUPLICATE KEY UPDATE setting_value = JSON_SET(
         COALESCE(setting_value, JSON_OBJECT()),
         '$.facePassivePlaybackMode', 'live_streaming',
         '$.paidMediaRoutingEnabled', TRUE,
         '$.streamMixingEnabled', TRUE,
         '$.emergencyRtcFallbackEnabled', FALSE,
         '$.rtcPassiveFallbackCeiling', 3
       )`,
      [master.account.id],
    );
    await root.execute(
      `INSERT INTO live_media_mix_tasks
        (room_id, task_id, output_stream_id, status)
       VALUES (?, ?, ?, 'INACTIVE')
       ON DUPLICATE KEY UPDATE status = 'INACTIVE', playback_url = NULL`,
      [faceRoomRows[0].id, `qa-task-${randomUUID()}`, `qa-mix-${randomUUID()}`],
    );
    const priorMixerReady = process.env.ZEGO_STREAM_MIXING_READY;
    process.env.ZEGO_STREAM_MIXING_READY = "true";
    const pendingPresence = await rooms.refreshRoomPresence(
      guest,
      faceRoomCode,
    );
    assert.equal(pendingPresence.mediaDelivery?.mode, "streamingPending");
    await assert.rejects(
      mediaAuthority.authorizeRoomRtc(guest, {
        roomCode: faceRoomCode,
        canPublish: false,
      }),
      /Passive RTC fallback is disabled/,
    );
    await root.execute(
      `INSERT INTO live_media_mix_tasks
        (room_id, task_id, output_stream_id, status, playback_url, active_started_at)
       VALUES (?, ?, ?, 'ACTIVE', NULL, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status = 'ACTIVE', playback_url = NULL, active_started_at = CURRENT_TIMESTAMP(3)`,
      [faceRoomRows[0].id, `qa-task-${randomUUID()}`, `qa-mix-${randomUUID()}`],
    );
    try {
      assert.equal(
        (await rooms.refreshRoomPresence(guest, faceRoomCode)).mediaDelivery
          ?.mode,
        "liveStreaming",
      );
      await assert.rejects(
        mediaAuthority.authorizeRoomRtc(guest, {
          roomCode: faceRoomCode,
          canPublish: false,
        }),
        /delivered by the public Live stream/,
      );
      const acceptedGuestGrant = await mediaAuthority.authorizeRoomRtc(
        stranger,
        { roomCode: faceRoomCode, canPublish: true },
      );
      assert.equal(acceptedGuestGrant.publishMode, "audio_only");
    } finally {
      if (priorMixerReady == null) delete process.env.ZEGO_STREAM_MIXING_READY;
      else process.env.ZEGO_STREAM_MIXING_READY = priorMixerReady;
    }
    console.log(
      "PASS Face Live broadcast authority: one Host video/audio publisher, zero-RTC pending/active public stream, accepted audio-only guests, targeted disconnect",
    );

    await root.execute(
      `UPDATE system_settings SET setting_value = JSON_SET(setting_value,
        '$.paidMediaRoutingEnabled', FALSE,
        '$.streamMixingEnabled', FALSE,
        '$.facePassivePlaybackMode', 'rtc_fallback',
        '$.partyPassivePlaybackMode', 'dynamic_rtc_fallback',
        '$.temporaryRtcCostGuardEnabled', TRUE,
        '$.temporaryFaceRtcViewerCeiling', 3,
        '$.temporaryPartyRtcUserCeiling', 12)
       WHERE setting_key = 'mobile.room_features'`,
    );
    await root.execute(
      "UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE application_user_id = ?",
      [owner.userId],
    );
    await root.execute(
      "UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE application_user_id = ?",
      [owner.userId],
    );
    const cappedFaceCode = `QACF${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: cappedFaceCode,
      kind: "face",
      title: "QA Capped Face",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await mediaAuthority.authorizeRoomRtc(owner, {
      roomCode: cappedFaceCode,
      canPublish: true,
    });
    const faceFallbackUsers = await Promise.all(
      [1, 2, 3, 4].map((index) => user(`QA Face Fallback ${index}`)),
    );
    for (const fallbackUser of faceFallbackUsers)
      await rooms.joinLiveRoom(fallbackUser, cappedFaceCode);
    for (const fallbackUser of faceFallbackUsers.slice(0, 3)) {
      await mediaAuthority.authorizeRoomRtc(fallbackUser, {
        roomCode: cappedFaceCode,
        canPublish: false,
      });
    }
    await assert.rejects(
      mediaAuthority.authorizeRoomRtc(faceFallbackUsers[3], {
        roomCode: cappedFaceCode,
        canPublish: false,
      }),
      /temporarily supports 3 viewers/,
    );
    await root.execute(
      "UPDATE live_media_access_grants SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE application_user_id = ?",
      [owner.userId],
    );
    await root.execute(
      "UPDATE live_media_usage SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE application_user_id = ?",
      [owner.userId],
    );
    const cappedPartyCode = `QACP${Date.now()}`;
    await product.createRoom(owner, {
      roomCode: cappedPartyCode,
      kind: "party",
      title: "QA Capped Party",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 8,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await mediaAuthority.authorizeRoomRtc(owner, {
      roomCode: cappedPartyCode,
      canPublish: true,
    });
    const partyFallbackUsers = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        user(`QA Party Fallback ${index + 1}`),
      ),
    );
    for (const fallbackUser of partyFallbackUsers)
      await rooms.joinLiveRoom(fallbackUser, cappedPartyCode);
    for (const fallbackUser of partyFallbackUsers.slice(0, 11)) {
      await mediaAuthority.authorizeRoomRtc(fallbackUser, {
        roomCode: cappedPartyCode,
        canPublish: false,
      });
    }
    await assert.rejects(
      mediaAuthority.authorizeRoomRtc(partyFallbackUsers[11], {
        roomCode: cappedPartyCode,
        canPublish: false,
      }),
      /temporarily supports 12 RTC members/,
    );
    console.log(
      "PASS temporary RTC cost guard: Face passive hard cap 3; Party total hard cap 12; no overflow token issued",
    );

    await product.setFollow(owner, "user", guest.publicId, true);
    const followers = await social.socialDirectory(guest, {
      targetPublicId: guest.publicId,
      kind: "followers",
    });
    const following = await social.socialDirectory(owner, {
      targetPublicId: owner.publicId,
      kind: "following",
    });
    assert.deepEqual(
      followers.people.map((entry) => entry.id),
      [owner.publicId],
    );
    assert.deepEqual(
      following.people.map((entry) => entry.id),
      [guest.publicId],
    );
    assert.equal(followers.target.isSelf, true);
    const guestDirectory = (await product.mobileBootstrap(owner)).people.find(
      (entry) => entry.id === guest.publicId,
    );
    const guestProfile = (await product.mobileBootstrap(guest)).profile;
    assert.equal(guestDirectory?.followers, 1);
    assert.equal(guestProfile.followers, 1);
    await product.setFollow(owner, "user", guest.publicId, false);
    assert.equal((await product.mobileBootstrap(guest)).profile.followers, 0);
    console.log(
      "PASS follow/fans: persisted follow state and live follower counts",
    );

    const ownerBeforeGift = await product.mobileBootstrap(owner);
    const guestBeforeGift = await product.mobileBootstrap(guest);
    const gift = ownerBeforeGift.gifts[0];
    assert.ok(gift && gift.cost > 0);
    const clientGiftId = randomUUID();
    const giftInput = {
      clientGiftId,
      roomCode,
      giftId: gift.id,
      recipientPublicId: guest.publicId,
      quantity: 2,
    };
    const giftResult = await product.sendGift(owner, giftInput);
    const giftValue = gift.cost * 2;
    const diamondValue = Math.floor((giftValue * 97) / 100);
    assert.equal(
      giftResult.remainingCoins,
      ownerBeforeGift.wallet.coins - giftValue,
    );
    const ownerAfterGift = await product.mobileBootstrap(owner);
    const guestAfterGift = await product.mobileBootstrap(guest);
    assert.equal(
      ownerAfterGift.wallet.diamonds,
      ownerBeforeGift.wallet.diamonds,
      "Sending a gift must not debit diamonds",
    );
    assert.equal(
      guestAfterGift.wallet.coins,
      guestBeforeGift.wallet.coins,
      "Receiving a gift must not credit social coins",
    );
    const senderGiftLedger = ownerAfterGift.transactions.filter((entry) =>
      entry.type.startsWith("GIFT_"),
    );
    const receiverGiftLedger = guestAfterGift.transactions.filter((entry) =>
      entry.type.startsWith("GIFT_"),
    );
    assert.deepEqual(
      senderGiftLedger.map((entry) => [
        entry.type,
        entry.currency,
        entry.isCredit,
        entry.amount,
      ]),
      [["GIFT_SPEND", "COIN", false, giftValue]],
    );
    assert.deepEqual(
      receiverGiftLedger.map((entry) => [
        entry.type,
        entry.currency,
        entry.isCredit,
        entry.amount,
      ]),
      [["GIFT_RECEIVE", "DIAMOND", true, diamondValue]],
    );
    const guestPresenceAfterGift = await rooms.refreshRoomPresence(
      guest,
      roomCode,
    );
    assert.equal(
      guestPresenceAfterGift.wallet?.diamonds,
      guestBeforeGift.wallet.diamonds + diamondValue,
    );
    assert.equal(
      guestPresenceAfterGift.giftEvents?.at(-1)?.receiver.id,
      guest.publicId,
    );
    assert.equal(
      guestPresenceAfterGift.participants?.find(
        (entry: { user: { id: string } }) => entry.user.id === guest.publicId,
      )?.receivedGiftValue,
      giftValue,
    );
    const duplicateGift = await product.sendGift(owner, giftInput);
    assert.equal(duplicateGift.message, "Gift already sent");
    assert.equal(
      (await product.mobileBootstrap(owner)).wallet.coins,
      ownerAfterGift.wallet.coins,
      "gift transport retry must not charge twice",
    );
    const concurrentGiftInput = {
      ...giftInput,
      clientGiftId: randomUUID(),
      quantity: 1,
    };
    const concurrentSenderBefore = (await product.mobileBootstrap(owner)).wallet
      .coins;
    const concurrentReceiverBefore = (await product.mobileBootstrap(guest))
      .wallet.diamonds;
    const concurrentResults = await Promise.all([
      product.sendGift(owner, concurrentGiftInput),
      product.sendGift(owner, concurrentGiftInput),
    ]);
    assert.equal(
      (await product.mobileBootstrap(owner)).wallet.coins,
      concurrentSenderBefore - gift.cost,
    );
    assert.equal(
      (await product.mobileBootstrap(guest)).wallet.diamonds,
      concurrentReceiverBefore + product.giftDiamondValue(gift.cost),
    );
    assert.equal(
      concurrentResults.filter((result) => result.event != null).length,
      1,
      "simultaneous transport retries must create one room event",
    );
    await assert.rejects(
      product.sendGift(owner, {
        roomCode,
        giftId: gift.id,
        recipientPublicId: stranger.publicId,
        quantity: 1,
      }),
    );
    console.log(
      "PASS gifts: active receivers, atomic coin debit/diamond credit, retry idempotency, wallet-specific ledger, room event and per-seat total",
    );

    const rocketAdminBefore =
      await completionAdmin.getCompletionAdminSettings();
    assert.deepEqual(
      rocketAdminBefore.rocket.tiers.map((tier) => tier.target),
      [5000, 35000, 100000, 250000, 500000, 1000000],
    );
    const rocketInput = {
      scope: master,
      energyPerCoin: 1,
      minimumUserLevel: 1,
      minimumVipTier: 0,
      vipEnergyBonusPercent: 0,
      reason: "QA Rocket control wiring",
      tiers: rocketAdminBefore.rocket.tiers.map((tier) => ({
        level: tier.level,
        target: tier.target,
        top1: tier.top1,
        top2: tier.top2,
        top3: tier.top3,
        room: tier.room,
      })),
    };
    await completionAdmin.saveRocketSettings({
      ...rocketInput,
      enabled: false,
    });
    const [rocketBeforeDisabledGift] = await root.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(coin_value), 0) total FROM rocket_contributions",
    );
    const disabledGift = await product.sendGift(owner, {
      roomCode,
      giftId: gift.id,
      recipientPublicId: guest.publicId,
      quantity: 1,
    });
    assert.equal(disabledGift.rocket, null);
    const [rocketAfterDisabledGift] = await root.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(coin_value), 0) total FROM rocket_contributions",
    );
    assert.equal(
      Number(rocketAfterDisabledGift[0].total),
      Number(rocketBeforeDisabledGift[0].total),
    );
    await completionAdmin.saveRocketSettings({ ...rocketInput, enabled: true });
    const [rocketTargetUpdate] = await root.execute(
      `UPDATE rocket_cycles SET target_coins = contributed_coins + ?
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?) AND status = 'ACTIVE'`,
      [gift.cost, roomCode],
    );
    assert.equal(
      Number(
        (rocketTargetUpdate as { affectedRows?: number }).affectedRows ?? 0,
      ),
      1,
      "Rocket QA must have one active cycle",
    );
    const [armedRocketRows] = await root.query<RowDataPacket[]>(
      `SELECT contributed_coins, target_coins FROM rocket_cycles
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?) AND status = 'ACTIVE' LIMIT 1`,
      [roomCode],
    );
    assert.equal(
      Number(armedRocketRows[0].target_coins),
      Number(armedRocketRows[0].contributed_coins) + gift.cost,
    );
    const beforeLaunch = (await product.mobileBootstrap(owner)).wallet.coins;
    const rocketLaunch = await product.sendGift(owner, {
      roomCode,
      giftId: gift.id,
      recipientPublicId: guest.publicId,
      quantity: 1,
    });
    assert.ok(
      rocketLaunch.rocket,
      "Enabled Rocket must return authoritative progress",
    );
    assert.equal(
      rocketLaunch.rocket.launched,
      true,
      JSON.stringify(rocketLaunch.rocket),
    );
    assert.equal(
      rocketLaunch.remainingCoins,
      beforeLaunch - gift.cost + 500,
      "Rocket Top 1 reward must be in the immediate wallet response",
    );
    const rocketState = await rewards.rocketSnapshot(owner, roomCode);
    assert.equal(
      rocketState.history.some((cycle) => cycle.status === "completed"),
      true,
    );
    const [rocketRewards] = await root.query<RowDataPacket[]>(
      "SELECT reward_group, reward_coins FROM rocket_rewards WHERE application_user_id = ?",
      [owner.userId],
    );
    assert.equal(rocketRewards[0]?.reward_group, "TOP1");
    console.log(
      "PASS Rocket: Master enable/disable, six thresholds/rewards, eligible gift progress, target launch, rewards, history, immediate wallet and restart snapshot",
    );

    const mallFrameId = randomUUID();
    const alternateFrameId = randomUUID();
    const mallChatId = randomUUID();
    const vipChatId = randomUUID();
    const vipLegendChatId = randomUUID();
    await root.execute(
      `INSERT INTO gift_catalog
        (id, gift_key, name, category, catalog_type, coin_price, validity_days, vip_tier_eligibility, sort_order, visual_url, asset_config, created_by)
       VALUES
        (?, 'qa_aurora_frame', 'QA Aurora Frame', 'Frames', 'AVATAR_FRAME', 5000, 30, NULL, 10, 'https://example.invalid/aurora.webp', JSON_OBJECT('accent', 4288908543), ?),
        (?, 'qa_sapphire_frame', 'QA Sapphire Frame', 'Frames', 'AVATAR_FRAME', 1000, 30, NULL, 20, 'https://example.invalid/sapphire.webp', JSON_OBJECT('accent', 4284791039), ?),
        (?, 'qa_mall_chat', 'QA Mall Chat', 'Chat', 'CHAT_FRAME', 2000, 30, NULL, 20, 'https://example.invalid/mall-chat.webp', JSON_OBJECT('accent', 4284791039), ?),
        (?, 'qa_vip_chat', 'QA VIP Chat', 'Chat', 'CHAT_FRAME', 1000, 30, 3, 30, NULL, JSON_OBJECT('accent', 4294922952), ?),
        (?, 'qa_vip_legend_chat', 'QA Legend Chat', 'Chat', 'CHAT_FRAME', 1000, 30, 5, 40, 'https://example.invalid/legend-chat.webp', JSON_OBJECT('accent', 4294953536), ?)`,
      [
        mallFrameId,
        master.account.id,
        alternateFrameId,
        master.account.id,
        mallChatId,
        master.account.id,
        vipChatId,
        master.account.id,
        vipLegendChatId,
        master.account.id,
      ],
    );
    await root.execute(
      "UPDATE wallet_balances SET available_balance = 2000000 WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'",
      [owner.userId],
    );
    const vipBefore = await rewards.vipSnapshot(owner);
    assert.deepEqual(
      vipBefore.tiers.map((tier) => [
        tier.name,
        tier.priceCoins,
        tier.dailyRewardCoins,
      ]),
      [
        ["Gold", 100000, 2500],
        ["Platinum", 300000, 7500],
        ["Diamond", 500000, 12500],
        ["Master", 700000, 17500],
        ["Legend", 1000000, 25000],
      ],
    );
    const diamondVipPurchase = await rewards.purchaseVipTier(owner, 3);
    assert.equal(diamondVipPurchase.chargedCoins, 500000);
    const diamondVipCosmetics = await cosmetics.cosmeticSnapshot(owner);
    assert.equal(
      diamondVipCosmetics.loadout.CHAT_FRAME?.itemId,
      "qa_vip_chat",
      "the best eligible tier-3 cosmetic must equip first",
    );
    const vipPurchase = await rewards.purchaseVipTier(owner, 5);
    assert.equal(vipPurchase.chargedCoins, 500000);
    const vipClaim = await rewards.claimVipDailyReward(owner);
    assert.equal(vipClaim.rewardCoins, 25000);
    await assert.rejects(rewards.claimVipDailyReward(owner), /already claimed/);
    assert.equal((await rewards.vipSnapshot(owner)).claimable, false);
    console.log(
      "PASS VIP: exact configurable tiers, cumulative purchase, Legend reward, server-day persistence, duplicate claim denial",
    );

    const vipCosmetics = await cosmetics.cosmeticSnapshot(owner);
    assert.equal(
      vipCosmetics.loadout.CHAT_FRAME?.source,
      "VIP",
      "configured VIP cosmetics must use the common loadout",
    );
    assert.equal(
      vipCosmetics.loadout.CHAT_FRAME?.itemId,
      "qa_vip_legend_chat",
      "highest eligible VIP asset must win its slot",
    );
    assert.ok(
      vipCosmetics.entitlements.some(
        (item) => item.itemId === "qa_vip_chat" && !item.equipped,
      ),
    );
    assert.ok(
      vipCosmetics.entitlements.some(
        (item) => item.itemId === "qa_vip_legend_chat" && item.equipped,
      ),
    );
    const legendEntitlement = vipCosmetics.entitlements.find(
      (item) => item.itemId === "qa_vip_legend_chat",
    )!;
    const vipUnequipped = await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: legendEntitlement.id,
      equipped: false,
    });
    assert.equal(
      vipUnequipped.loadout.CHAT_FRAME,
      undefined,
      "VIP items must support a deliberate unequip",
    );
    assert.equal(
      (await cosmetics.cosmeticSnapshot(owner)).loadout.CHAT_FRAME,
      undefined,
      "VIP unequip must survive a refreshed snapshot",
    );
    await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: legendEntitlement.id,
      equipped: true,
    });
    const mallChatPurchase = await cosmetics.purchaseMallCosmetic(owner, {
      itemId: "qa_mall_chat",
      clientRequestId: randomUUID(),
    });
    const mallChatEntitlement = mallChatPurchase.entitlements.find(
      (item) => item.itemId === "qa_mall_chat",
    )!;
    assert.equal(
      mallChatEntitlement.equipped,
      false,
      "an active VIP selection must not be silently replaced by a purchase",
    );
    await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: mallChatEntitlement.id,
      equipped: true,
    });
    assert.equal(
      (await cosmetics.cosmeticSnapshot(owner)).loadout.CHAT_FRAME?.itemId,
      "qa_mall_chat",
      "an explicitly equipped Mall cosmetic must survive VIP refresh",
    );
    await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: mallChatEntitlement.id,
      equipped: false,
    });
    await root.execute(
      "UPDATE gift_catalog SET vip_tier_eligibility = NULL WHERE id = ?",
      [vipLegendChatId],
    );
    const reconfiguredVipCosmetics = await cosmetics.cosmeticSnapshot(owner);
    assert.equal(
      reconfiguredVipCosmetics.loadout.CHAT_FRAME?.itemId,
      "chat_regal_crystal_wings",
      "Master eligibility changes must revoke stale grants and fall back to the next configured VIP asset immediately",
    );
    assert.equal(
      reconfiguredVipCosmetics.entitlements.some(
        (item) => item.itemId === "qa_vip_legend_chat",
      ),
      false,
    );
    const beforeCosmeticPurchase = (await product.mobileBootstrap(owner)).wallet
      .coins;
    const purchaseRequestId = randomUUID();
    const purchased = await cosmetics.purchaseMallCosmetic(owner, {
      itemId: "qa_aurora_frame",
      clientRequestId: purchaseRequestId,
    });
    assert.equal(purchased.idempotent, false);
    assert.equal(
      "chargedCoins" in purchased ? purchased.chargedCoins : null,
      5000,
    );
    const purchasedFrame = purchased.entitlements.find(
      (item) => item.itemId === "qa_aurora_frame",
    )!;
    assert.equal(
      purchasedFrame.equipped,
      false,
      "an active VIP frame must not be silently replaced by a Mall purchase",
    );
    await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: purchasedFrame.id,
      equipped: true,
    });
    assert.equal(
      (await cosmetics.cosmeticSnapshot(owner)).loadout.AVATAR_FRAME?.itemId,
      "qa_aurora_frame",
    );
    const retriedPurchase = await cosmetics.purchaseMallCosmetic(owner, {
      itemId: "qa_aurora_frame",
      clientRequestId: purchaseRequestId,
    });
    assert.equal(retriedPurchase.idempotent, true);
    assert.equal(
      (await product.mobileBootstrap(owner)).wallet.coins,
      beforeCosmeticPurchase - 5000,
      "purchase retry must never debit twice",
    );
    await assert.rejects(
      cosmetics.purchaseMallCosmetic(owner, {
        itemId: "qa_sapphire_frame",
        clientRequestId: purchaseRequestId,
      }),
      /does not match/,
    );
    const alternate = await cosmetics.purchaseMallCosmetic(owner, {
      itemId: "qa_sapphire_frame",
      clientRequestId: randomUUID(),
    });
    const alternateEntitlement = alternate.entitlements.find(
      (item) => item.itemId === "qa_sapphire_frame",
    )!;
    assert.equal(
      alternateEntitlement.equipped,
      false,
      "a second item in one slot must not silently replace the equipped item",
    );
    await cosmetics.setCosmeticEquipped(owner, {
      entitlementId: alternateEntitlement.id,
      equipped: true,
    });
    const switched = await cosmetics.cosmeticSnapshot(owner);
    assert.equal(switched.loadout.AVATAR_FRAME?.itemId, "qa_sapphire_frame");
    assert.equal(
      switched.entitlements.find((item) => item.itemId === "qa_aurora_frame")
        ?.equipped,
      false,
    );
    await root.execute(
      "UPDATE user_cosmetic_entitlements SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?",
      [alternateEntitlement.id],
    );
    const expired = await cosmetics.cosmeticSnapshot(owner);
    assert.equal(
      expired.loadout.AVATAR_FRAME?.itemId,
      "vip_legend_phoenix_frame",
      "an expired Mall selection must stop rendering and fall back to the active VIP frame without cleanup cron",
    );
    assert.equal(
      expired.entitlements.find((item) => item.id === alternateEntitlement.id)
        ?.equipped,
      false,
    );
    const [cosmeticLedger] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count, SUM(amount) amount FROM ledger_transactions WHERE source_id = ? AND transaction_type = 'COSMETIC_PURCHASE'",
      [owner.userId],
    );
    assert.deepEqual(
      [Number(cosmeticLedger[0].count), Number(cosmeticLedger[0].amount)],
      [3, 8000],
    );
    await root.execute(
      "UPDATE application_users SET vip_tier = 3, vip_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY) WHERE id = ?",
      [guest.userId],
    );
    assert.equal(
      (await cosmetics.cosmeticSnapshot(guest)).loadout.CHAT_FRAME?.itemId,
      "qa_vip_chat",
    );
    await root.execute(
      "UPDATE application_users SET vip_expires_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?",
      [guest.userId],
    );
    await cosmetics.expireEndedVipMemberships();
    const [expiredVipRows] = await root.query<RowDataPacket[]>(
      "SELECT vip_tier, vip_expires_at FROM application_users WHERE id = ?",
      [guest.userId],
    );
    assert.equal(
      Number(expiredVipRows[0].vip_tier),
      0,
      "expired VIP tier must clear without waiting for cron",
    );
    assert.equal(expiredVipRows[0].vip_expires_at, null);
    assert.equal(
      (await cosmetics.cosmeticSnapshot(guest)).loadout.CHAT_FRAME,
      undefined,
      "expired VIP privileges must disappear from room presentation",
    );
    console.log(
      "PASS VIP/Mall cosmetics: 23 production assets published; common grants, idempotent debit, preview metadata, one equipped item per slot, exact expiry and immediate unload",
    );

    const sourceLiveCode = `PKS${Date.now()}`;
    const targetLiveCode = `PKT${Date.now()}`;
    for (const [code, host, title] of [
      [sourceLiveCode, owner, "QA PK Source"],
      [targetLiveCode, roomAdmin, "QA PK Target"],
    ] as const) {
      const roomId = randomUUID();
      await root.execute(
        "INSERT INTO live_rooms (id, room_code, host_application_user_id, room_type, title, category, language_code, privacy, seat_count, theme_index, theme_enabled, country_code, status) VALUES (?, ?, ?, 'FACE', ?, 'PK', 'Hindi', 'PUBLIC', 0, 0, FALSE, 'IN', 'ACTIVE')",
        [roomId, code, host.userId, title],
      );
      await root.execute(
        "INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted) VALUES (?, ?, 'OWNER', 'HOST', FALSE)",
        [roomId, host.userId],
      );
    }
    const [pkRooms] = await root.query<RowDataPacket[]>(
      "SELECT id, room_code FROM live_rooms WHERE room_code IN (?, ?)",
      [sourceLiveCode, targetLiveCode],
    );
    const sourceRoomId = String(
      pkRooms.find((row) => row.room_code === sourceLiveCode)?.id,
    );
    const targetRoomId = String(
      pkRooms.find((row) => row.room_code === targetLiveCode)?.id,
    );
    const [giftCatalog] = await root.query<RowDataPacket[]>(
      "SELECT id FROM gift_catalog WHERE gift_key = 'qa_rose' LIMIT 1",
    );
    const rejectedInvite = await rooms.createPkSession(owner, {
      sourceRoomCode: sourceLiveCode,
      targetRoomCode: targetLiveCode,
      mode: "Classic",
      durationMinutes: 5,
    });
    const sourcePkPresence = await rooms.refreshRoomPresence(
      owner,
      sourceLiveCode,
      true,
    );
    const targetPkPresence = await rooms.refreshRoomPresence(
      roomAdmin,
      targetLiveCode,
      true,
    );
    assert.equal(sourcePkPresence.pkSession?.id, rejectedInvite.id);
    assert.equal(sourcePkPresence.pkSession?.isSourceRoom, true);
    assert.equal(targetPkPresence.pkSession?.id, rejectedInvite.id);
    assert.equal(targetPkPresence.pkSession?.isSourceRoom, false);
    assert.equal(
      sourcePkPresence.pkSession?.sourceStreamId,
      `${sourceLiveCode}_${owner.publicId}_main`,
    );
    assert.equal(
      targetPkPresence.pkSession?.targetStreamId,
      `${targetLiveCode}_${roomAdmin.publicId}_main`,
    );
    await assert.rejects(
      rooms.respondPkSession(owner, {
        sessionId: rejectedInvite.id,
        accept: true,
      }),
      /Only the invited Host/,
    );
    const rejection = await rooms.respondPkSession(roomAdmin, {
      sessionId: rejectedInvite.id,
      accept: false,
    });
    assert.equal(rejection.status, "rejected");
    assert.equal(
      (
        await rooms.closePkSession(owner, {
          sessionId: rejectedInvite.id,
          completed: false,
        })
      ).status,
      "rejected",
    );
    for (let round = 1; round <= 3; round += 1) {
      const session = await rooms.createPkSession(owner, {
        sourceRoomCode: sourceLiveCode,
        targetRoomCode: targetLiveCode,
        mode: "Classic",
        durationMinutes: 5,
      });
      const accepted = await rooms.respondPkSession(roomAdmin, {
        sessionId: session.id,
        accept: true,
      });
      assert.equal(accepted.status, "active");
      assert.equal(
        (await rooms.activatePkSession(owner, session.id)).status,
        "active",
        "requester callback must be idempotent after invited Host accepts",
      );
      const eventId = randomUUID();
      await root.execute(
        "INSERT INTO live_room_gift_events (id, room_id, sender_application_user_id, receiver_application_user_id, gift_catalog_id, quantity, coin_value) VALUES (?, ?, ?, ?, ?, 1, 6000)",
        [eventId, sourceRoomId, owner.userId, owner.userId, giftCatalog[0].id],
      );
      const result = await rooms.closePkSession(owner, {
        sessionId: session.id,
        completed: true,
      });
      assert.equal(result.qualifyingWin, true);
      assert.equal(result.streak, round === 3 ? 0 : round);
      assert.equal(result.bonusCoins, round === 3 ? 10000 : 0);
      await root.execute(
        "UPDATE live_room_gift_events SET created_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 5 SECOND) WHERE id = ?",
        [eventId],
      );
    }
    const streakAfterBonus = await rewards.pkStreakSnapshot(owner);
    assert.equal(streakAfterBonus.currentStreak, 0);
    assert.equal(streakAfterBonus.bonusesAwarded, 1);
    const losingSession = await rooms.createPkSession(owner, {
      sourceRoomCode: sourceLiveCode,
      targetRoomCode: targetLiveCode,
      mode: "Classic",
      durationMinutes: 5,
    });
    await rooms.respondPkSession(roomAdmin, {
      sessionId: losingSession.id,
      accept: true,
    });
    await root.execute(
      "INSERT INTO live_room_gift_events (id, room_id, sender_application_user_id, receiver_application_user_id, gift_catalog_id, quantity, coin_value) VALUES (?, ?, ?, ?, ?, 1, 6000)",
      [
        randomUUID(),
        targetRoomId,
        roomAdmin.userId,
        roomAdmin.userId,
        giftCatalog[0].id,
      ],
    );
    const loss = await rooms.closePkSession(owner, {
      sessionId: losingSession.id,
      completed: true,
    });
    assert.equal(loss.result, "loss");
    assert.equal(loss.streak, 0);
    console.log(
      "PASS PK: invited Host authority, Accept/Reject lifecycle, requester synchronization, 5,000 minimum, 3 consecutive wins, 10,000 bonus once, completed-streak reset, loss reset",
    );

    const identities = [owner, guest, roomAdmin];
    const gifted = [5000000, 4000000, 3000000];
    await root.execute(
      "DELETE FROM weekly_gifter_reward_runs WHERE week_start = DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) + 7 DAY)",
    );
    for (let index = 0; index < identities.length; index += 1) {
      await root.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, created_at)
         VALUES (?, ?, 'COIN', 'GIFT_SPEND', 'APPLICATION_USER', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', DATE_SUB(CURRENT_DATE, INTERVAL WEEKDAY(CURRENT_DATE) + 1 DAY))`,
        [
          randomUUID(),
          `QAWK-${randomUUID()}`,
          identities[index].userId,
          stranger.userId,
          gifted[index],
        ],
      );
    }
    const weekly = await rewards.settlePreviousWeeklyGifterRewards();
    assert.equal(weekly.settled, true);
    const [weeklyRows] = await root.query<RowDataPacket[]>(
      "SELECT rank_number, reward_coins FROM weekly_gifter_rewards ORDER BY rank_number",
    );
    assert.deepEqual(
      weeklyRows.map((row) => Number(row.reward_coins)),
      [125000, 60000, 30000],
    );
    assert.equal(
      (await rewards.settlePreviousWeeklyGifterRewards()).settled,
      false,
    );
    const [weeklyCount] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) total FROM weekly_gifter_rewards",
    );
    assert.equal(Number(weeklyCount[0].total), 3);
    console.log(
      "PASS weekly Top Gifters: real calendar-week ranking, 2.5/1.5/1%, auditable transactions, duplicate payout prevention",
    );

    const beforeReward = (await product.mobileBootstrap(owner)).wallet.coins;
    const reward = await rooms.claimDailyReward(owner);
    assert.equal(reward.newBalance, beforeReward + reward.rewardCoins);
    assert.equal(
      (await product.mobileBootstrap(owner)).dailyRewards.claimable,
      false,
    );
    await assert.rejects(rooms.claimDailyReward(owner));
    const [unreadRewardMail] = await root.query<RowDataPacket[]>(
      "SELECT read_at FROM mobile_notifications WHERE application_user_id = ? AND notification_type = 'DAILY_REWARD' ORDER BY created_at DESC LIMIT 1",
      [owner.userId],
    );
    assert.equal(unreadRewardMail[0].read_at, null);
    await rooms.markMobileNotificationsRead(owner);
    const [readRewardMail] = await root.query<RowDataPacket[]>(
      "SELECT read_at FROM mobile_notifications WHERE application_user_id = ? AND notification_type = 'DAILY_REWARD' ORDER BY created_at DESC LIMIT 1",
      [owner.userId],
    );
    assert.ok(readRewardMail[0].read_at);
    console.log(
      "PASS rewards/mail: server credit, persisted claim state, duplicate denial, persistent unread/read state",
    );

    await rooms.updateRoomSettings(owner, {
      roomCode,
      chatLocked: true,
      removePassword: false,
      resetTopDp: false,
    });
    await assert.rejects(
      rooms.sendRoomChat(guest, {
        roomCode,
        body: "Locked message",
        clientMessageId: randomUUID(),
      }),
    );
    await rooms.updateRoomSettings(roomAdmin, {
      roomCode,
      chatLocked: false,
      removePassword: false,
      resetTopDp: false,
    });
    const chatIdempotencyKey = randomUUID();
    const firstChat = await rooms.sendRoomChat(guest, {
      roomCode,
      body: "Unlocked message",
      clientMessageId: chatIdempotencyKey,
    });
    const retriedChat = await rooms.sendRoomChat(guest, {
      roomCode,
      body: "Unlocked message",
      clientMessageId: chatIdempotencyKey,
    });
    assert.equal(firstChat.id, retriedChat.id);
    assert.equal(
      (await rooms.refreshRoomPresence(owner, roomCode)).messages?.[0].body,
      "Unlocked message",
    );
    await rooms.clearRoomChat(owner, roomCode);
    assert.equal(
      (await rooms.refreshRoomPresence(guest, roomCode)).messages?.length,
      0,
    );
    await rooms.sendRoomInteraction(guest, {
      roomCode,
      targetPublicId: owner.publicId,
      interactionKey: "kiss",
    });
    const interactionPresence = await rooms.refreshRoomPresence(
      owner,
      roomCode,
    );
    assert.equal(
      interactionPresence.interactions?.at(-1)?.interactionKey,
      "kiss",
    );
    assert.equal(
      interactionPresence.interactions?.at(-1)?.senderPublicId,
      guest.publicId,
    );
    await assert.rejects(
      rooms.sendRoomInteraction(owner, {
        roomCode,
        targetPublicId: owner.publicId,
        interactionKey: "kiss",
      }),
    );
    await root.execute(
      "UPDATE application_users SET consumption_points = 12500, anchor_income_points = 500, level_number = 6 WHERE id = ?",
      [owner.userId],
    );
    const bootstrap = await product.mobileBootstrap(owner);
    assert.ok(
      bootstrap.posts.some((entry) => entry.id === photoPost.id),
      "Bootstrap must not overwrite published posts with an empty list",
    );
    assert.notEqual(
      bootstrap.consumptionLevel.level,
      bootstrap.anchorIncomeLevel.level,
    );
    assert.notEqual(bootstrap.profile.level, bootstrap.profile.anchorLevel);
    assert.equal(
      bootstrap.rooms
        .find((entry) => entry.id === roomCode)
        ?.photoUrl?.includes("/assets/rooms/"),
      true,
    );
    console.log(
      "PASS room state: chat lock/unlock/clear, separate levels, uploaded cover URL",
    );

    await root.execute(
      "UPDATE wallet_balances SET available_balance = 100000 WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN'",
      [owner.userId],
    );
    const gameBalanceBefore = (await product.mobileBootstrap(owner)).wallet
      .gameCredits;
    assert.ok(
      gameBalanceBefore > 0,
      "Game Center must receive the real nonzero server balance",
    );
    await assert.rejects(
      product.mutateGameWallet(owner, {
        clientTransactionId: randomUUID(),
        direction: "CREDIT",
        amount: 25,
        game: "Luck77",
        reason: "Untrusted client payout",
      }),
      /secure round settlement/,
      "a client must never be able to create a game payout directly",
    );
    assert.equal(
      (await product.mobileBootstrap(owner)).wallet.gameCredits,
      gameBalanceBefore,
    );
    const diamondsBeforeGame = (await product.mobileBootstrap(owner)).wallet
      .diamonds;
    async function completeSharedRound(
      game:
        | "teen_patti_pro"
        | "luck77"
        | "bounty_football"
        | "greedy_king"
        | "greedy_lion",
      bets: Record<string, number>,
    ) {
      const before = await product.gameSharedRoundState(owner, game);
      // The QA call can land during DRAWING/RESULT. Keep this deterministic
      // without sleeping by reopening only this temporary database round.
      await root.execute(
        "UPDATE game_shared_rounds SET betting_ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 SECOND), drawing_ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 31 SECOND), result_ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 32 SECOND) WHERE id = ?",
        [before.round.id],
      );
      const requestId = randomUUID();
      const placed = await product.placeSharedGameBets(owner, {
        requestId,
        game,
        roundId: before.round.id,
        bets,
      });
      const repeated = await product.placeSharedGameBets(owner, {
        requestId,
        game,
        roundId: before.round.id,
        bets,
      });
      assert.equal(
        repeated.walletBalance,
        placed.walletBalance,
        `${game} retry must not debit twice`,
      );
      const changed = { ...bets };
      const first = Object.keys(changed)[0];
      changed[first] = Number(changed[first]) + 500;
      await assert.rejects(
        product.placeSharedGameBets(owner, {
          requestId,
          game,
          roundId: before.round.id,
          bets: changed,
        }),
        /already used/,
      );
      await root.execute(
        "UPDATE game_shared_rounds SET betting_ends_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 SECOND), drawing_ends_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND), result_ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 SECOND) WHERE id = ?",
        [before.round.id],
      );
      const settled = await product.gameSharedRoundState(owner, game);
      assert.ok(settled.outcome, `${game} must reveal one server outcome`);
      assert.ok(settled.settlement, `${game} must settle the user's wager`);
      assert.equal(
        settled.walletBalance,
        placed.walletBalance + Number(settled.settlement.payout),
        `${game} visible wallet must match the settled payout`,
      );
      return {
        ...settled,
        outcome: settled.outcome!,
        settlement: settled.settlement!,
      };
    }
    const gameRound = await completeSharedRound("luck77", {
      watermelon: 500,
      seven: 0,
      plum: 0,
    });
    assert.ok(
      ["watermelon", "seven", "plum"].includes(
        String(gameRound.outcome.winner),
      ),
    );
    assert.equal(
      gameRound.outcome.oddsFinalized,
      true,
      "Luck77 must finalize one shared result against the configured server target",
    );
    const roundHistory = await product.gameRoundHistory(owner, "luck77", 10);
    assert.equal(
      roundHistory.rounds[0]?.outcome.sharedRoundId,
      gameRound.round.id,
    );
    assert.equal(
      gameRound.players.find((player) => player.publicId === owner.publicId)
        ?.bets.watermelon,
      500,
    );
    assert.equal(
      gameRound.latestSettlement?.roundId,
      gameRound.round.id,
      "a settled Luck77 wager must remain recoverable even if the client misses RESULT",
    );
    const sharedTeenRound = await completeSharedRound("teen_patti_pro", {
      "0": 500,
      "1": 0,
      "2": 0,
      crown: 500,
    });
    assert.notEqual(
      sharedTeenRound.round.number,
      1,
      "Teen Patti must expose the global server round number",
    );
    assert.equal(
      Array.isArray(sharedTeenRound.outcome.hands) &&
        sharedTeenRound.outcome.hands.length,
      3,
    );
    assert.equal(
      sharedTeenRound.players.find(
        (player) => player.publicId === owner.publicId,
      )?.bets.crown,
      500,
    );
    const teenRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "teen_patti_pro",
      bets: { "0": 10000, "1": 0, "2": 0 },
    });
    assert.equal(
      Array.isArray(teenRound.outcome.hands) && teenRound.outcome.hands.length,
      3,
    );
    assert.ok(
      [0, 1, 2].includes(Number(teenRound.outcome.winnerLane)),
      "Teen Patti Pro must settle exactly one of its three lanes",
    );
    const teenWinnerLane = Number(teenRound.outcome.winnerLane);
    assert.equal(
      Number(teenRound.outcome.payoutMultiplier),
      [2.7, 2.9, 2.8][teenWinnerLane],
    );
    assert.equal(
      Number(teenRound.outcome.rawNormalPayout),
      product.teenPattiLanePayout(
        teenWinnerLane,
        Number(teenRound.bets[String(teenWinnerLane)] ?? 0),
      ),
      "Teen Patti Pro raw payout must come only from the strongest winning lane",
    );
    assert.equal(
      Number(teenRound.outcome.grossPayout),
      Number(teenRound.outcome.normalPayout),
      "Teen Patti Pro gross return must use the configured fixed-RTP scale",
    );
    const crownRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "teen_patti_pro",
      bets: { "0": 10000, "1": 10000, "2": 0, crown: 10000 },
    });
    const normalGross = Number(crownRound.outcome.normalPayout ?? 0);
    const crownGross = Number(crownRound.outcome.crownPayout ?? 0);
    assert.equal(
      Number(crownRound.outcome.grossPayout),
      normalGross + crownGross,
      "Crown and the winning hand must use the fixed-RTP server scales",
    );
    assert.equal(
      Number(crownRound.outcome.commissionablePayout),
      normalGross + crownGross,
      "The configured winnings deduction must cover the entire game return",
    );
    await assert.rejects(
      product.settleGameRound(owner, {
        clientRoundId: randomUUID(),
        game: "teen_patti_pro",
        bets: { "0": 500, "1": 500, "2": 500, crown: 500 },
      }),
      /up to 2 hands/,
    );
    const teenLeaderboard = await product.gameRoundLeaderboard(
      "teen_patti_pro",
      10,
      "round",
    );
    assert.ok(
      teenLeaderboard.entries.some(
        (entry) => entry.publicId === owner.publicId,
      ),
    );
    assert.ok(
      teenLeaderboard.entries.every((entry) =>
        Number.isInteger(entry.netWinnings),
      ),
    );
    const spectatorTeenRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "teen_patti_pro",
      bets: { "0": 0, "1": 0, "2": 0 },
    });
    assert.equal(spectatorTeenRound.wager, 0);
    assert.equal(spectatorTeenRound.payout, 0);
    assert.equal(
      spectatorTeenRound.outcome.spectator,
      true,
      "Teen Patti spectators must still receive a server-authoritative reveal",
    );
    const footballRound = await completeSharedRound("bounty_football", {
      "0": 500,
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0,
      "5": 0,
      "6": 0,
      "7": 0,
      "8": 0,
      "9": 0,
    });
    assert.equal(Number.isInteger(footballRound.outcome.winner), true);
    const jungleRound = await product.settleGameRound(owner, {
      clientRoundId: randomUUID(),
      game: "jungle_hunt",
      bets: { spin: 150 },
    });
    assert.equal(
      Array.isArray(jungleRound.outcome.grid) &&
        jungleRound.outcome.grid.length,
      3,
    );
    assert.equal(Array.isArray(jungleRound.outcome.winningLines), true);
    for (const game of ["greedy_king", "greedy_lion"] as const) {
      const zoneCount = game === "greedy_king" ? 10 : 8;
      const round = await completeSharedRound(
        game,
        Object.fromEntries(
          Array.from({ length: zoneCount }, (_, index) => [
            String(index),
            index < 2 ? 500 : 0,
          ]),
        ),
      );
      assert.ok(
        Number(round.outcome.winner) >= 0 && Number(round.outcome.winner) < 8,
      );
      assert.ok([5, 10, 15, 25, 45].includes(Number(round.outcome.multiplier)));
    }
    const postGameBootstrap = await product.mobileBootstrap(owner);
    assert.equal(
      postGameBootstrap.wallet.diamonds,
      diamondsBeforeGame,
      "game results must never credit withdrawable host earnings",
    );
    assert.equal(
      postGameBootstrap.transactions.some((item) =>
        item.type.startsWith("GAME"),
      ),
      false,
      "game ledger audit rows must not appear in user transaction history",
    );
    console.log(
      "PASS games: published server result schemas, real balance, atomic wager/payout, immutable idempotency key, history, no DIAMOND credit",
    );

    // Repeated real database rounds, not mocked Flutter results. Validate each
    // server payout against the returned result, the wallet and paired ledgers.
    await root.execute(
      "UPDATE wallet_balances SET available_balance = 100000 WHERE owner_id = ? AND asset_type = 'COIN'",
      [stranger.userId],
    );
    const importedGames = ["jungle_hunt"] as const;
    for (const game of importedGames) {
      for (let roundIndex = 0; roundIndex < 3; roundIndex++) {
        const before = (await product.mobileBootstrap(stranger)).wallet.coins;
        const bets: Record<string, number> = { spin: 150 };
        const round = await product.settleGameRound(stranger, {
          clientRoundId: randomUUID(),
          game,
          bets,
        });
        const gross = Number(round.outcome.grossPayout);
        const deduction = gross > round.wager ? Math.floor(gross * 0.01) : 0;
        const expected = gross - deduction;
        assert.equal(
          round.payout,
          expected,
          `${game} payout must agree with visible result`,
        );
        assert.equal(Number(round.outcome.grossPayout), gross);
        assert.equal(Number(round.outcome.winningsDeduction), deduction);
        assert.equal(round.coinBalance, before - round.wager + round.payout);
        assert.equal(
          (await product.mobileBootstrap(stranger)).wallet.coins,
          round.coinBalance,
        );
        const [ledger] = await root.query<RowDataPacket[]>(
          "SELECT transaction_type, SUM(amount) amount, COUNT(*) count FROM ledger_transactions WHERE metadata->>'$.clientRoundId' = ? GROUP BY transaction_type",
          [round.clientRoundId],
        );
        assert.equal(
          Number(
            ledger.find((row) => row.transaction_type === "GAME_BET")?.amount,
          ),
          round.wager,
        );
        assert.equal(
          Number(
            ledger.find((row) => row.transaction_type === "GAME_BET")?.count,
          ),
          1,
        );
        assert.equal(
          Number(
            ledger.find((row) => row.transaction_type === "GAME_WIN")?.amount ??
              0,
          ),
          round.payout,
        );
        assert.equal(
          Number(
            ledger.find((row) => row.transaction_type === "GAME_WITHHOLDING")
              ?.amount ?? 0,
          ),
          deduction,
        );
      }
      assert.equal(
        (await product.gameRoundHistory(stranger, game, 10)).rounds.length,
        3,
      );
    }
    const concurrentInput = {
      clientRoundId: randomUUID(),
      game: "jungle_hunt" as const,
      bets: { spin: 150 },
    };
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () =>
        product.settleGameRound(stranger, concurrentInput),
      ),
    );
    assert.equal(new Set(concurrent.map((round) => round.roundId)).size, 1);
    const laterRound = await product.settleGameRound(stranger, {
      clientRoundId: randomUUID(),
      game: "jungle_hunt",
      bets: { spin: 150 },
    });
    const oldRetry = await product.settleGameRound(stranger, concurrentInput);
    assert.equal(
      oldRetry.coinBalance,
      laterRound.coinBalance,
      "old retry must return CURRENT wallet, not historical balance",
    );
    assert.deepEqual(oldRetry.outcome, concurrent[0].outcome);
    await assert.rejects(
      product.settleGameRound(stranger, {
        clientRoundId: randomUUID(),
        game: "luck77",
        bets: { watermelon: 500, seven: 500, plum: 500 },
      }),
    );
    await root.execute(
      "UPDATE wallet_balances SET available_balance = 10000000 WHERE owner_id = ? AND asset_type = 'COIN'",
      [stranger.userId],
    );
    for (let sample = 0; sample < 100; sample += 1) {
      const round = await product.settleGameRound(stranger, {
        clientRoundId: randomUUID(),
        game: "teen_patti_pro",
        bets: { "0": 10000, "1": 0, "2": 0 },
      });
      assert.equal(
        round.outcome.targetWin,
        undefined,
        "results must never carry a player-targeting decision",
      );
      assert.equal(round.outcome.selectionModel, "BET_INDEPENDENT_FIXED_RTP");
      const gross = Number(round.outcome.grossPayout);
      const deduction = gross > round.wager ? Math.floor(gross * 0.01) : 0;
      assert.equal(Number(round.outcome.winningsDeduction), deduction);
      assert.equal(round.payout, gross - deduction);
    }
    // A 100-round random sample can occasionally fall outside the old broad
    // range even when the fixed reel distribution is unchanged. Use enough
    // real persisted rounds for this release gate to measure the configured
    // hit-frequency band instead of failing roughly one run in a hundred.
    const jungleSamples = 500;
    let jungleWins = 0;
    for (let sample = 0; sample < jungleSamples; sample += 1) {
      const round = await product.settleGameRound(stranger, {
        clientRoundId: randomUUID(),
        game: "jungle_hunt",
        bets: { spin: 150 },
      });
      if (round.payout > 0) jungleWins += 1;
      assert.ok(
        Number(round.outcome.grossPayout) <= 3000,
        "A 150-coin Jungle spin must never gross more than its configured 20x cap",
      );
      assert.ok(
        round.payout <= 2970,
        "The 1% deduction must apply after the Jungle payout cap",
      );
    }
    const jungleHitRate = jungleWins / jungleSamples;
    assert.ok(
      jungleHitRate >= 0.28 && jungleHitRate <= 0.48,
      `${jungleSamples} Jungle spins should stay near the configured 40% hit-frequency reference, got ${(jungleHitRate * 100).toFixed(1)}%`,
    );
    console.log(
      `PASS imported games: complete database rounds, bet-independent Teen Patti outcomes, exact 1% withholding, Jungle ${(jungleHitRate * 100).toFixed(1)}% hit frequency across ${jungleSamples} rounds, Jungle 20x payout cap, paired ledger, history, retries`,
    );

    const rewardHost = await user("QA Reward Host");
    rewardHost.agencyAccountId = qaAgency.accountId;
    await root.execute(
      "UPDATE application_users SET agency_account_id = ? WHERE id = ?",
      [qaAgency.accountId, rewardHost.userId],
    );
    await root.execute(
      "UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?",
      [qaAgency.accountId, rewardHost.userId],
    );
    const liveRewardCode = `LIVEREWARD${Date.now()}`;
    const liveRewardRoomId = randomUUID();
    await root.execute(
      "INSERT INTO live_rooms (id, room_code, host_application_user_id, agency_account_id, room_type, title, category, language_code, privacy, seat_count, theme_index, theme_enabled, country_code, status) VALUES (?, ?, ?, ?, 'FACE', 'QA Reward Live', 'Talk', 'Hindi', 'PUBLIC', 0, 0, FALSE, 'IN', 'ACTIVE')",
      [liveRewardRoomId, liveRewardCode, rewardHost.userId, qaAgency.accountId],
    );
    await root.execute(
      "INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted) VALUES (?, ?, 'OWNER', 'HOST', FALSE)",
      [liveRewardRoomId, rewardHost.userId],
    );
    await root.execute(
      "INSERT INTO live_session_accounting (id, room_id, host_application_user_id, room_type, started_at, reward_rule_id) SELECT ?, ?, ?, 'FACE', CURRENT_TIMESTAMP(3), id FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE ORDER BY effective_from DESC LIMIT 1",
      [randomUUID(), liveRewardRoomId, rewardHost.userId],
    );
    await root.execute(
      "UPDATE live_session_accounting SET media_publishing = TRUE, last_media_heartbeat_at = CURRENT_TIMESTAMP(3), media_segment_seconds = 3600, valid_media_seconds = 3600 WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)",
      [liveRewardCode],
    );
    const rewardDiamondsBefore = (await product.mobileBootstrap(rewardHost))
      .wallet.diamonds;
    await root.execute(
      "UPDATE live_room_members SET muted = TRUE, last_seen_at = CURRENT_TIMESTAMP(3) - INTERVAL 90 SECOND WHERE room_id = ?",
      [liveRewardRoomId],
    );
    await root.execute(
      "UPDATE live_session_accounting SET last_media_heartbeat_at = CURRENT_TIMESTAMP(3) - INTERVAL 90 SECOND WHERE room_id = ?",
      [liveRewardRoomId],
    );
    const liveProgress = await rooms.refreshRoomPresence(
      rewardHost,
      liveRewardCode,
      true,
    );
    assert.ok(liveProgress.liveRewardProgress);
    assert.equal(liveProgress.liveRewardProgress!.rewardDiamondsPerHour, 3500);
    assert.ok(
      liveProgress.liveRewardProgress!.continuousSeconds >= 3600 &&
        liveProgress.liveRewardProgress!.continuousSeconds <= 3630,
      "a reconnect must preserve the completed hour while excluding the unobserved outage window",
    );
    assert.equal(
      liveProgress.liveRewardProgress!.publishing,
      true,
      "muted Face microphone must not stop camera reward eligibility",
    );
    assert.equal(liveProgress.liveRewardProgress!.secondsUntilNextReward, 0);
    assert.equal(liveProgress.liveRewardProgress!.dailyRewardEarned, true);
    assert.equal(
      liveProgress.liveRewardProgress!.rewardEligible,
      false,
      "the countdown must stop after today's reward is earned",
    );
    assert.equal(liveProgress.liveRewardProgress!.newlyClaimableDiamonds, 3500);
    let rewardBootstrap = await product.mobileBootstrap(rewardHost);
    assert.equal(
      rewardBootstrap.wallet.diamonds,
      rewardDiamondsBefore,
      "earning must not alter the withdrawable balance before Claim",
    );
    assert.equal(rewardBootstrap.liveRewards.length, 1);
    assert.equal(rewardBootstrap.liveRewards[0].status, "unclaimed");
    assert.equal(rewardBootstrap.liveRewards[0].amount, 3500);
    const finalizedLive = await rooms.finalizeLiveSession(
      rewardHost,
      liveRewardCode,
    );
    assert.equal(finalizedLive.rewardCoins, 3500);
    assert.equal(
      (await rooms.finalizeLiveSession(rewardHost, liveRewardCode))
        .alreadyFinalized,
      true,
      "finalization retry must be idempotent",
    );
    rewardBootstrap = await product.mobileBootstrap(rewardHost);
    assert.equal(
      rewardBootstrap.wallet.diamonds,
      rewardDiamondsBefore,
      "finalization must not auto-credit an earned hour",
    );
    assert.equal(
      rewardBootstrap.wallet.coins,
      5000,
      "Host Live rewards must not mint spendable social coins",
    );
    assert.equal(rewardBootstrap.hostRewardHistory[0].rewardCoins, 3500);

    // Accelerated regression checks use a dedicated reviewer Host and write a
    // non-financial audit row only. The production 60-minute reward rule and
    // every wallet balance remain untouched.
    await root.execute(
      `INSERT INTO play_reviewer_credentials
        (id, application_user_id, username, password_hash, reviewer_role, active)
       VALUES (?, ?, ?, 'qa-only-hash', 'HOST', TRUE)`,
      [randomUUID(), rewardHost.userId, `qa-live-${Date.now()}`],
    );
    await root.execute(
      `INSERT INTO mobile_access_overrides
        (application_user_id, host_access_override, play_reviewer_access_override,
         live_reward_qa_enabled, live_reward_qa_threshold_seconds,
         live_reward_qa_expires_at, note)
       VALUES (?, FALSE, FALSE, TRUE, 60,
               DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE), 'Core mobile QA')
       ON DUPLICATE KEY UPDATE live_reward_qa_enabled = TRUE,
         live_reward_qa_threshold_seconds = 60,
         live_reward_qa_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 10 MINUTE)`,
      [rewardHost.userId],
    );
    const qaProbeRoomId = randomUUID();
    const qaProbeAccountingId = randomUUID();
    const qaProbeRoomCode = `QAPROBE${Date.now()}`;
    await root.execute(
      `INSERT INTO live_rooms
        (id, room_code, host_application_user_id, agency_account_id, room_type,
         title, category, language_code, privacy, seat_count, theme_index,
         theme_enabled, country_code, status)
       VALUES (?, ?, ?, ?, 'FACE', 'QA probe', 'Talk', 'Hindi', 'PUBLIC',
               0, 0, FALSE, 'IN', 'ACTIVE')`,
      [qaProbeRoomId, qaProbeRoomCode, rewardHost.userId, qaAgency.accountId],
    );
    await root.execute(
      "INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted) VALUES (?, ?, 'OWNER', 'HOST', FALSE)",
      [qaProbeRoomId, rewardHost.userId],
    );
    await root.execute(
      `INSERT INTO live_session_accounting
        (id, room_id, host_application_user_id, room_type, started_at,
         media_publishing, last_media_heartbeat_at, last_media_evidence_at,
         eligible_seconds_committed, media_segment_seconds, valid_media_seconds,
         reward_rule_id)
       SELECT ?, ?, ?, 'FACE', CURRENT_TIMESTAMP(3), TRUE,
              CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), 60, 60, 60, id
       FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE
       ORDER BY effective_from DESC LIMIT 1`,
      [qaProbeAccountingId, qaProbeRoomId, rewardHost.userId],
    );
    const diamondsBeforeQaProbe = (await product.mobileBootstrap(rewardHost)).wallet.diamonds;
    await rooms.refreshRoomPresence(rewardHost, qaProbeRoomCode, true);
    await rooms.refreshRoomPresence(rewardHost, qaProbeRoomCode, true);
    const [qaRuns] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM live_reward_qa_runs WHERE live_session_accounting_id = ?",
      [qaProbeAccountingId],
    );
    assert.equal(Number(qaRuns[0].count), 1, "duplicate QA heartbeats must create one non-financial probe record");
    assert.equal((await product.mobileBootstrap(rewardHost)).wallet.diamonds, diamondsBeforeQaProbe, "QA threshold must never credit Diamonds");
    console.log("PASS accelerated Live reward QA: 60-second dedicated reviewer threshold, duplicate heartbeat dedupe, no entitlement and no wallet credit");
    const rewardId = String(rewardBootstrap.liveRewards[0].id);
    const duplicateClaims = await Promise.all([
      rooms.claimLiveReward(rewardHost, rewardId),
      rooms.claimLiveReward(rewardHost, rewardId),
    ]);
    assert.deepEqual(
      duplicateClaims
        .map((claim) => claim.creditedDiamonds)
        .sort((a, b) => a - b),
      [0, 3500],
    );
    rewardBootstrap = await product.mobileBootstrap(rewardHost);
    assert.equal(
      rewardBootstrap.wallet.diamonds,
      rewardDiamondsBefore + 3500,
      "Claim must credit exactly once after a double request",
    );
    assert.equal(rewardBootstrap.liveRewards[0].status, "claimed");
    const [claimedLedgers] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count, SUM(amount) amount FROM ledger_transactions WHERE destination_id = ? AND transaction_type = 'HOST_HOURLY_DIAMONDS'",
      [rewardHost.userId],
    );
    assert.equal(Number(claimedLedgers[0].count), 1);
    assert.equal(Number(claimedLedgers[0].amount), 3500);

    async function finalizedRewardFor(seconds: number) {
      const roomCode = `REWARD${seconds}${Date.now()}`;
      const roomId = randomUUID();
      await root.execute(
        "INSERT INTO live_rooms (id, room_code, host_application_user_id, agency_account_id, room_type, title, category, language_code, privacy, seat_count, theme_index, theme_enabled, country_code, status) VALUES (?, ?, ?, ?, 'FACE', 'QA Exact Reward', 'Talk', 'Hindi', 'PUBLIC', 0, 0, FALSE, 'IN', 'ACTIVE')",
        [roomId, roomCode, rewardHost.userId, qaAgency.accountId],
      );
      await root.execute(
        "INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted) VALUES (?, ?, 'OWNER', 'HOST', FALSE)",
        [roomId, rewardHost.userId],
      );
      await root.execute(
        "INSERT INTO live_session_accounting (id, room_id, host_application_user_id, room_type, started_at, media_segment_seconds, valid_media_seconds, reward_rule_id) SELECT ?, ?, ?, 'FACE', CURRENT_TIMESTAMP(3), ?, ?, id FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE ORDER BY effective_from DESC LIMIT 1",
        [randomUUID(), roomId, rewardHost.userId, seconds, seconds],
      );
      return rooms.finalizeLiveSession(rewardHost, roomCode);
    }
    const partialHour = await finalizedRewardFor(3599);
    assert.equal(
      partialHour.rewardCoins,
      0,
      "59 continuous minutes must earn zero Diamonds",
    );
    assert.equal(
      partialHour.eligibleSeconds,
      0,
      "an unfinished hour must not carry over",
    );
    const twoHours = await finalizedRewardFor(7200);
    assert.equal(
      twoHours.rewardCoins,
      0,
      "additional qualifying hours on the same business day must not create another reward",
    );
    assert.equal(twoHours.eligibleSeconds, 7200);
    rewardBootstrap = await product.mobileBootstrap(rewardHost);
    const twoHourClaims = rewardBootstrap.liveRewards.filter(
      (reward: { status: string }) => reward.status === "unclaimed",
    );
    assert.equal(twoHourClaims.length, 0);
    assert.equal(
      rewardBootstrap.wallet.diamonds,
      rewardDiamondsBefore + 3500,
      "additional same-day hours must not change Diamonds",
    );
    const claimAll = await rooms.claimAllLiveRewards(rewardHost);
    assert.equal(claimAll.creditedDiamonds, 0);
    assert.equal(
      (await rooms.claimAllLiveRewards(rewardHost)).creditedDiamonds,
      0,
      "Claim All retry must be idempotent",
    );
    assert.equal(
      (await product.mobileBootstrap(rewardHost)).wallet.diamonds,
      rewardDiamondsBefore + 3500,
    );

    const maleRewardHost = await user("QA Male Reward Host", "MALE");
    maleRewardHost.agencyAccountId = qaAgency.accountId;
    await root.execute(
      "UPDATE application_users SET agency_account_id = ? WHERE id = ?",
      [qaAgency.accountId, maleRewardHost.userId],
    );
    await root.execute(
      "UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?",
      [qaAgency.accountId, maleRewardHost.userId],
    );
    const maleLiveCode = `MALELIVE${Date.now()}`;
    await product.createRoom(maleRewardHost, {
      roomCode: maleLiveCode,
      kind: "face",
      title: "QA Male Live",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await root.execute(
      `UPDATE live_session_accounting
       SET media_publishing = TRUE, last_media_heartbeat_at = CURRENT_TIMESTAMP(3),
           media_segment_seconds = 3600, valid_media_seconds = 3600
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)`,
      [maleLiveCode],
    );
    const maleDiamondsBefore = (await product.mobileBootstrap(maleRewardHost))
      .wallet.diamonds;
    // A forged client identity value cannot influence the authoritative DB
    // gender retained in the reward settlement audit transaction.
    const manipulatedMaleIdentity = {
      ...maleRewardHost,
      gender: "FEMALE" as const,
    };
    const maleProgress = await rooms.refreshRoomPresence(
      manipulatedMaleIdentity,
      maleLiveCode,
      true,
    );
    assert.equal(
      maleProgress.active,
      true,
      "male Hosts must be able to stream normally",
    );
    assert.equal(maleProgress.liveRewardProgress?.dailyRewardEarned, true);
    assert.equal(maleProgress.liveRewardProgress?.rewardEligible, false);
    assert.equal(maleProgress.liveRewardProgress?.rewardDiamondsPerHour, 3500);
    assert.equal(
      (await rooms.finalizeLiveSession(manipulatedMaleIdentity, maleLiveCode))
        .rewardCoins,
      3500,
    );
    assert.equal(
      (await product.mobileBootstrap(maleRewardHost)).wallet.diamonds,
      maleDiamondsBefore,
    );
    const [maleDecisions] = await root.query<RowDataPacket[]>(
      `SELECT authoritative_gender, eligible, reward_diamonds
       FROM live_hour_reward_decisions
       WHERE host_application_user_id = ?`,
      [maleRewardHost.userId],
    );
    assert.deepEqual(
      maleDecisions.map((row) => [
        row.authoritative_gender,
        Number(row.eligible),
        Number(row.reward_diamonds),
      ]),
      [["MALE", 1, 3500]],
    );
    const [maleRewardLedger] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM ledger_transactions WHERE destination_id = ? AND transaction_type = 'HOST_HOURLY_DIAMONDS'",
      [maleRewardHost.userId],
    );
    assert.equal(
      Number(maleRewardLedger[0].count),
      0,
      "earning stays claimable and must not auto-credit the wallet",
    );
    assert.equal(
      (await rooms.claimAllLiveRewards(maleRewardHost)).creditedDiamonds,
      3500,
    );
    assert.equal(
      (await product.mobileBootstrap(maleRewardHost)).wallet.diamonds,
      maleDiamondsBefore + 3500,
    );
    console.log(
      "PASS claimable Live rewards: earned balance unchanged; individual/double Claim and Claim All credit once; male and female Hosts receive the same daily first-hour reward; forged client gender ignored",
    );

    const staleRewardHost = await user("QA Stale Reward Host");
    staleRewardHost.agencyAccountId = qaAgency.accountId;
    await root.execute(
      "UPDATE application_users SET agency_account_id = ? WHERE id = ?",
      [qaAgency.accountId, staleRewardHost.userId],
    );
    await root.execute(
      "UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?",
      [qaAgency.accountId, staleRewardHost.userId],
    );
    const staleRoomId = randomUUID();
    const staleRoomCode = `STALE${Date.now()}`;
    await root.execute(
      "INSERT INTO live_rooms (id, room_code, host_application_user_id, agency_account_id, room_type, title, status) VALUES (?, ?, ?, ?, 'FACE', 'QA Stale Reward', 'ACTIVE')",
      [staleRoomId, staleRoomCode, staleRewardHost.userId, qaAgency.accountId],
    );
    await root.execute(
      "INSERT INTO live_room_members (room_id, application_user_id, room_role, media_role, muted, last_seen_at) VALUES (?, ?, 'OWNER', 'HOST', TRUE, CURRENT_TIMESTAMP(3) - INTERVAL 6 MINUTE)",
      [staleRoomId, staleRewardHost.userId],
    );
    await root.execute(
      "INSERT INTO live_session_accounting (id, room_id, host_application_user_id, room_type, started_at, last_media_heartbeat_at, media_segment_seconds, valid_media_seconds, reward_rule_id) SELECT ?, ?, ?, 'FACE', CURRENT_TIMESTAMP(3) - INTERVAL 2 HOUR, CURRENT_TIMESTAMP(3) - INTERVAL 6 MINUTE, 7200, 7200, id FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE ORDER BY effective_from DESC LIMIT 1",
      [randomUUID(), staleRoomId, staleRewardHost.userId],
    );
    const [beforeCleanup] = await root.query<RowDataPacket[]>(
      "SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [staleRewardHost.userId],
    );
    await product.mobileBootstrap(staleRewardHost);
    const [cleanup] = await root.query<RowDataPacket[]>(
      "SELECT status, reward_coins FROM live_session_accounting WHERE room_id = ?",
      [staleRoomId],
    );
    assert.equal(
      cleanup[0].status,
      "FINALIZED",
      "stale Face rooms must settle, never VOID earned hours",
    );
    assert.equal(Number(cleanup[0].reward_coins), 3500);
    const afterCleanup = await product.mobileBootstrap(staleRewardHost);
    const staleDiamondsBefore = Number(
      beforeCleanup[0]?.available_balance ?? 0,
    );
    assert.equal(
      afterCleanup.wallet.diamonds,
      staleDiamondsBefore,
      "cleanup must create claimable hours without auto-crediting them",
    );
    assert.equal(
      afterCleanup.liveRewards
        .filter((reward: { status: string }) => reward.status === "unclaimed")
        .reduce(
          (sum: number, reward: { amount: number }) =>
            sum + Number(reward.amount),
          0,
        ),
      3500,
    );
    assert.equal(
      (await rooms.claimAllLiveRewards(staleRewardHost)).creditedDiamonds,
      3500,
    );
    assert.equal(
      (await product.mobileBootstrap(staleRewardHost)).wallet.diamonds,
      staleDiamondsBefore + 3500,
    );
    console.log(
      "PASS launch regressions: muted Face camera, 90s reconnect, stale-room earned entitlements, duplicate cleanup settlement",
    );

    const recoveryHost = await user("QA Recorded Reward Recovery");
    const recoverySessions: string[] = [];
    for (const seconds of [7200, 3599]) {
      const roomId = randomUUID();
      const accountingId = randomUUID();
      recoverySessions.push(accountingId);
      await root.execute(
        "INSERT INTO live_rooms (id, room_code, host_application_user_id, room_type, title, status) VALUES (?, ?, ?, 'FACE', 'QA Reward Recovery', 'ENDED')",
        [roomId, `REC${seconds}${Date.now()}`, recoveryHost.userId],
      );
      await root.execute(
        "INSERT INTO live_session_accounting (id, room_id, host_application_user_id, room_type, started_at, ended_at, media_segment_seconds, valid_media_seconds, reward_rule_id, status) SELECT ?, ?, ?, 'FACE', '2026-09-04 01:00:00', '2026-09-04 03:00:00', ?, ?, id, 'VOID' FROM host_reward_rules WHERE room_type = 'FACE' AND enabled = TRUE ORDER BY effective_from DESC LIMIT 1",
        [accountingId, roomId, recoveryHost.userId, seconds, seconds],
      );
    }
    const recoverySql = await readFile(
      "db/migrations/0053_recover_recorded_live_hours.sql",
      "utf8",
    );
    for (let retry = 0; retry < 2; retry++) {
      await root.beginTransaction();
      await root.query(recoverySql);
      await root.commit();
    }
    const [recoveredWallet] = await root.query<RowDataPacket[]>(
      "SELECT available_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [recoveryHost.userId],
    );
    assert.equal(
      Number(recoveredWallet[0].available_balance),
      7000,
      "recorded two-hour recovery must credit once even if migration is retried",
    );
    const [recoveredLedger] = await root.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM ledger_transactions WHERE destination_id = ? AND transaction_type = 'HOST_HOURLY_DIAMONDS'",
      [recoveryHost.userId],
    );
    assert.equal(Number(recoveredLedger[0].count), 1);
    const [partialRecovery] = await root.query<RowDataPacket[]>(
      "SELECT status, reward_coins FROM live_session_accounting WHERE id = ?",
      [recoverySessions[1]],
    );
    assert.equal(
      partialRecovery[0].status,
      "VOID",
      "an unfinished hour must not be invented as a recovery payment",
    );
    assert.equal(Number(partialRecovery[0].reward_coins), 0);
    console.log(
      "PASS recorded Live recovery: 7,000 Diamonds once, no payment for unfinished hours",
    );

    // The payout engine is retained for future use and still receives a full
    // regression run, while Play v1 keeps its authoritative public switch off.
    process.env.NAZRAA_TEST_CREATOR_CASH_WITHDRAWALS = "enabled";
    await global.nazraaPool!.execute(
      "UPDATE system_settings SET setting_value = JSON_SET(setting_value, '$.withdrawalEnabled', CAST('true' AS JSON), '$.creatorCashWithdrawalsEnabled', CAST('true' AS JSON)) WHERE setting_key = 'mobile.features'",
    );
    await root.execute(
      "INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND', 500000) ON DUPLICATE KEY UPDATE available_balance = 500000, reserved_balance = 0",
      [randomUUID(), rewardHost.userId],
    );
    const socialCoinsBeforeWithdrawal = (
      await product.mobileBootstrap(rewardHost)
    ).wallet.coins;
    await assert.rejects(
      product.createWithdrawalRequest(rewardHost, 1000, {
        type: "UPI",
        accountHolderName: "QA Reward Host",
        upiId: "qareward@upi",
      }),
      /exact 1,00,000/,
    );
    await assert.rejects(
      product.createWithdrawalRequest(rewardHost, 150000, {
        type: "UPI",
        accountHolderName: "QA Reward Host",
        upiId: "qareward@upi",
      }),
      /exact 1,00,000/,
    );
    const upiWithdrawal = await product.createWithdrawalRequest(
      rewardHost,
      100000,
      {
        type: "UPI",
        accountHolderName: "QA Reward Host",
        upiId: "qareward@upi",
      },
    );
    const [upiRequestRows] = await root.query<RowDataPacket[]>(
      "SELECT id, payout_method_id FROM withdrawal_requests WHERE withdrawal_code = ?",
      [upiWithdrawal.id],
    );
    const [reservedWallet] = await root.query<RowDataPacket[]>(
      "SELECT available_balance, reserved_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [rewardHost.userId],
    );
    assert.deepEqual(
      [
        Number(reservedWallet[0].available_balance),
        Number(reservedWallet[0].reserved_balance),
      ],
      [400000, 100000],
    );
    assert.equal(
      (await product.mobileBootstrap(rewardHost)).wallet.coins,
      socialCoinsBeforeWithdrawal,
      "withdrawal must not touch social/game coins",
    );
    await operations.transitionWithdrawal({
      scope: master,
      withdrawalId: String(upiRequestRows[0].id),
      nextStatus: "APPROVED",
      reason: "QA verified UPI payout",
    });
    const [verifiedMethod] = await root.query<RowDataPacket[]>(
      "SELECT verified FROM payout_methods WHERE id = ?",
      [upiRequestRows[0].payout_method_id],
    );
    assert.equal(Boolean(verifiedMethod[0].verified), true);
    await operations.transitionWithdrawal({
      scope: master,
      withdrawalId: String(upiRequestRows[0].id),
      nextStatus: "PROCESSING",
      reason: "QA payout processing",
    });
    await operations.transitionWithdrawal({
      scope: master,
      withdrawalId: String(upiRequestRows[0].id),
      nextStatus: "COMPLETED",
      reason: "QA payout complete",
      providerReference: "QA-UPI-001",
    });
    const [oneSlabRows] = await root.query<RowDataPacket[]>(
      "SELECT * FROM withdrawal_distribution_snapshots WHERE withdrawal_id = ?",
      [upiRequestRows[0].id],
    );
    assert.deepEqual(
      [
        Number(oneSlabRows[0].total_usd),
        Number(oneSlabRows[0].host_usd),
        Number(oneSlabRows[0].agency_usd),
        Number(oneSlabRows[0].super_admin_usd),
        Number(oneSlabRows[0].admin_usd),
        Number(oneSlabRows[0].bd_usd),
        Number(oneSlabRows[0].country_manager_usd),
        Number(oneSlabRows[0].company_usd),
      ],
      [11.7, 8, 1, 0.58, 0.18, 0.17, 0.35, 1.42],
    );
    assert.deepEqual(
      [
        Number(oneSlabRows[0].total_inr),
        Number(oneSlabRows[0].host_inr),
        Number(oneSlabRows[0].agency_inr),
      ],
      [1053, 720, 90],
    );
    assert.deepEqual(
      [
        Number(oneSlabRows[0].total_usd_cents_per_slab),
        Number(oneSlabRows[0].host_usd_cents_per_slab),
        Number(oneSlabRows[0].agency_usd_cents_per_slab),
        Number(oneSlabRows[0].super_admin_usd_cents_per_slab),
        Number(oneSlabRows[0].admin_usd_cents_per_slab),
        Number(oneSlabRows[0].bd_usd_cents_per_slab),
        Number(oneSlabRows[0].country_manager_usd_cents_per_slab),
        Number(oneSlabRows[0].company_usd_cents_per_slab),
      ],
      [1170, 800, 100, 58, 18, 17, 35, 142],
    );
    const [hierarchyRows] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id, admin_name, super_admin_name, country_manager_name FROM withdrawal_hierarchy_snapshots WHERE withdrawal_id = ?",
      [upiRequestRows[0].id],
    );
    assert.deepEqual(
      [
        String(hierarchyRows[0].agency_account_id),
        hierarchyRows[0].admin_name,
        hierarchyRows[0].super_admin_name,
        hierarchyRows[0].country_manager_name,
      ],
      [qaAgency.accountId, "QA Parent Admin", "QA Super Admin", "QA Country"],
    );
    const savedWithdrawal = await product.createWithdrawalRequest(
      rewardHost,
      200000,
      { payoutMethodId: String(upiRequestRows[0].payout_method_id) },
    );
    const [savedRows] = await root.query<RowDataPacket[]>(
      "SELECT id, payout_method_id FROM withdrawal_requests WHERE withdrawal_code = ?",
      [savedWithdrawal.id],
    );
    assert.equal(
      String(savedRows[0].payout_method_id),
      String(upiRequestRows[0].payout_method_id),
      "saved payout account must be reused",
    );
    for (const nextStatus of ["APPROVED", "PROCESSING", "COMPLETED"] as const)
      await operations.transitionWithdrawal({
        scope: master,
        withdrawalId: String(savedRows[0].id),
        nextStatus,
        reason: "QA two-slab payout",
        providerReference:
          nextStatus === "COMPLETED" ? "QA-UPI-002" : undefined,
      });
    const [twoSlabRows] = await root.query<RowDataPacket[]>(
      "SELECT total_usd, host_usd, agency_usd, total_inr, host_inr, agency_inr, slab_count FROM withdrawal_distribution_snapshots WHERE withdrawal_id = ?",
      [savedRows[0].id],
    );
    assert.deepEqual(
      [
        Number(twoSlabRows[0].slab_count),
        Number(twoSlabRows[0].total_usd),
        Number(twoSlabRows[0].host_usd),
        Number(twoSlabRows[0].agency_usd),
        Number(twoSlabRows[0].total_inr),
        Number(twoSlabRows[0].host_inr),
        Number(twoSlabRows[0].agency_inr),
      ],
      [2, 23.4, 16, 2, 2106, 1440, 180],
    );
    const agencyScope = await accounts.scopeFor(
      (await accounts.accountByManagementId(String(qaAgency.publicId)))!,
    );
    const agencyFinance =
      await withdrawalFinance.withdrawalFinance(agencyScope);
    const agencyHost = agencyFinance.hosts.find(
      (host) => host.publicId === rewardHost.publicId,
    );
    assert.equal(
      agencyFinance.agencies.length,
      1,
      "Agency finance scope must not expose another branch",
    );
    assert.deepEqual(
      [
        agencyHost?.totalWithdrawn,
        agencyHost?.hostPayoutInr,
        agencyHost?.agencyCommissionInr,
      ],
      [300000, 2160, 270],
    );
    const agencyCsv = await withdrawalFinance.agencyWithdrawalCsv(
      master,
      qaAgency.accountId,
    );
    assert.ok(
      agencyCsv.includes("Agency summary") &&
        agencyCsv.includes("Host balances") &&
        agencyCsv.includes("Withdrawal details"),
    );
    const bankWithdrawal = await product.createWithdrawalRequest(
      rewardHost,
      100000,
      {
        type: "BANK",
        accountHolderName: "QA Reward Host",
        accountNumber: "123456789012",
        ifsc: "HDFC0000123",
        bankName: "HDFC Bank",
      },
    );
    const [bankRows] = await root.query<RowDataPacket[]>(
      "SELECT id FROM withdrawal_requests WHERE withdrawal_code = ?",
      [bankWithdrawal.id],
    );
    await operations.transitionWithdrawal({
      scope: master,
      withdrawalId: String(bankRows[0].id),
      nextStatus: "REJECTED",
      reason: "QA rejection release test",
    });
    const [releasedWallet] = await root.query<RowDataPacket[]>(
      "SELECT available_balance, reserved_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [rewardHost.userId],
    );
    assert.equal(Number(releasedWallet[0].reserved_balance), 0);
    const resetResult = await monthlyReset.runMonthlyHostEarningsReset(
      new Date("2030-11-01T00:00:00.000Z"),
    );
    assert.equal(resetResult.status, "completed");
    assert.ok(resetResult.expiredAmount > 0);
    assert.equal(
      (
        await monthlyReset.runMonthlyHostEarningsReset(
          new Date("2030-11-01T06:00:00.000Z"),
        )
      ).status,
      "already_completed",
    );
    const [resetWallet] = await root.query<RowDataPacket[]>(
      "SELECT available_balance, reserved_balance FROM wallet_balances WHERE owner_id = ? AND asset_type = 'DIAMOND'",
      [rewardHost.userId],
    );
    assert.deepEqual(
      [
        Number(resetWallet[0].available_balance),
        Number(resetWallet[0].reserved_balance),
      ],
      [0, 0],
    );
    delete process.env.NAZRAA_TEST_CREATOR_CASH_WITHDRAWALS;
    await global.nazraaPool!.execute(
      "UPDATE system_settings SET setting_value = JSON_SET(setting_value, '$.withdrawalEnabled', CAST('false' AS JSON), '$.creatorCashWithdrawalsEnabled', CAST('false' AS JSON)) WHERE setting_key = 'mobile.features'",
    );
    await assert.rejects(
      product.createWithdrawalRequest(rewardHost, 100000, {
        payoutMethodId: String(upiRequestRows[0].payout_method_id),
      }),
      /not available in this version/,
    );
    console.log(
      "PASS retained withdrawal infrastructure: historical payout paths tested; Play-v1 user switch restored off and enforced",
    );

    const ownerExit = await rooms.leaveLiveRoom(owner, roomCode);
    assert.equal(ownerExit.transferredTo, roomAdmin.publicId);
    const [transferredRoom] = await root.query<RowDataPacket[]>(
      "SELECT host_application_user_id FROM live_rooms WHERE room_code = ?",
      [roomCode],
    );
    assert.equal(
      String(transferredRoom[0].host_application_user_id),
      roomAdmin.userId,
    );
    await root.execute(
      "UPDATE live_session_accounting SET started_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)",
      [roomCode],
    );
    const partyFinalized = await rooms.finalizeLiveSession(roomAdmin, roomCode);
    assert.equal(partyFinalized.rewardCoins, 0);
    assert.equal(
      (await rooms.finalizeLiveSession(roomAdmin, roomCode)).alreadyFinalized,
      true,
    );
    console.log(
      "PASS room lifecycle: Owner Exit transfers an active Party to an authorized Room Admin; Close finalizes once, removes discovery, Party hourly reward stays zero",
    );

    const agencyInput = {
      name: "QA Uploaded Agency",
      ownerName: "QA Applicant",
      countryCode: "IN",
      whatsappE164: "+919000000001",
      aadhaar: "123456789012",
      parentCode: String(parent.publicId),
      documentDataUrl: photo,
      documentName: "proof-1.png",
      additionalDocuments: [
        { dataUrl: photo, name: "proof-2.png" },
        { dataUrl: photo, name: "proof-3.png" },
      ],
      logoDataUrl: photo,
    };
    await assert.rejects(
      social.applyToCreateAgency(stranger, {
        ...agencyInput,
        additionalDocuments: [],
      }),
    );
    await assert.rejects(
      social.applyToCreateAgency(stranger, {
        ...agencyInput,
        logoDataUrl: undefined,
      }),
    );
    await social.applyToCreateAgency(stranger, agencyInput);
    const application = (await social.agencyApplicationsForUser(stranger)).find(
      (entry) => entry.type === "create",
    )!;
    const [agenciesBeforeReview] = await root.query<RowDataPacket[]>(
      "SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?",
      [stranger.userId],
    );
    assert.equal(
      agenciesBeforeReview.length,
      0,
      "submitting must not create an Agency",
    );
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT aadhaar_encrypted, aadhaar_last4, logo_byte_size FROM agency_creation_applications WHERE id = ?",
      [application.id],
    );
    assert.ok(rows[0].aadhaar_encrypted);
    assert.equal(rows[0].aadhaar_last4, "9012");
    assert.ok(rows[0].logo_byte_size > 0);
    const pending = (await agencies.listAgencyApplications(parentScope)).find(
      (entry) => entry.id === application.id,
    )!;
    assert.equal(pending.documentCount, 3);
    await assert.rejects(
      agencies.reviewAgencyCreation({
        scope: parentScope,
        applicationId: application.id,
        decision: "APPROVED",
        reason: "QA non-Master cannot approve",
      }),
      /Only Master/,
    );
    await agencies.reviewAgencyCreation({
      scope: master,
      applicationId: application.id,
      decision: "APPROVED",
      reason: "QA Master verified three protected documents",
    });
    const [documents] = await root.query<RowDataPacket[]>(
      "SELECT document.id, document.document_type FROM private_documents document JOIN agency_creation_applications application ON application.approved_agency_account_id = document.owner_id WHERE application.id = ? ORDER BY document.document_type",
      [application.id],
    );
    assert.equal(documents.length, 3);
    assert.deepEqual(
      documents.map((document) => document.document_type),
      ["AADHAAR_BACK", "AADHAAR_FRONT", "AADHAAR_SELFIE"],
    );
    const [createdAgencyRows] = await root.query<RowDataPacket[]>(
      "SELECT id, public_id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?",
      [stranger.userId],
    );
    assert.equal(createdAgencyRows.length, 1);
    assert.match(String(createdAgencyRows[0].public_id), /^\d{6}$/);
    const createdAgencyId = String(createdAgencyRows[0].id);
    const createdAgencyPublicId = String(createdAgencyRows[0].public_id);
    const agencyOwner = {
      ...stranger,
      role: "AGENCY_OWNER" as const,
      agencyAccountId: createdAgencyId,
    };
    await root.execute(
      "UPDATE application_users SET agency_account_id = NULL WHERE id = ?",
      [stranger.userId],
    );
    await root.execute(
      "UPDATE host_profiles SET agency_account_id = NULL WHERE application_user_id = ?",
      [stranger.userId],
    );
    await assert.rejects(
      social.applyToCreateAgency(stranger, {
        ...agencyInput,
        name: "Forbidden Second Agency",
      }),
      /already own/,
      "an Agency Owner must not be able to submit a second creation request even if a stale membership link is missing",
    );
    await assert.rejects(
      social.applyToJoinAgency(stranger, createdAgencyPublicId),
      /already own/,
      "an Agency Owner must not be able to join another Agency even if a stale membership link is missing",
    );
    const agencyOwnerLiveCode = `OWNERLIVE${Date.now()}`;
    await product.createRoom(agencyOwner, {
      roomCode: agencyOwnerLiveCode,
      kind: "face",
      title: "QA Female Agency Owner Live",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    const [agencyOwnerLive] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM live_rooms WHERE room_code = ?",
      [agencyOwnerLiveCode],
    );
    assert.equal(
      String(agencyOwnerLive[0].agency_account_id),
      createdAgencyId,
      "an owner's own active Agency authorizes Face Live even when legacy membership links are missing",
    );
    await root.execute(
      `UPDATE live_session_accounting SET media_segment_seconds = 3600,
         valid_media_seconds = 3600, media_publishing = TRUE,
         last_media_heartbeat_at = CURRENT_TIMESTAMP(3)
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)`,
      [agencyOwnerLiveCode],
    );
    const femaleOwnerDiamondsBefore = (
      await product.mobileBootstrap(agencyOwner)
    ).wallet.diamonds;
    assert.equal(
      (await rooms.finalizeLiveSession(agencyOwner, agencyOwnerLiveCode))
        .rewardCoins,
      3500,
      "a female Agency Owner receives the same authoritative completed-hour reward",
    );
    const femaleOwnerRewards = await product.mobileBootstrap(agencyOwner);
    assert.equal(femaleOwnerRewards.wallet.diamonds, femaleOwnerDiamondsBefore);
    assert.equal(
      femaleOwnerRewards.liveRewards.filter(
        (reward: { status: string }) => reward.status === "unclaimed",
      ).length,
      1,
    );
    assert.equal(
      (await rooms.claimAllLiveRewards(agencyOwner)).creditedDiamonds,
      3500,
    );
    assert.equal(
      (await product.mobileBootstrap(agencyOwner)).wallet.diamonds,
      femaleOwnerDiamondsBefore + 3500,
    );
    await root.execute(
      "UPDATE application_users SET agency_account_id = ? WHERE id = ?",
      [createdAgencyId, stranger.userId],
    );
    await root.execute(
      "UPDATE host_profiles SET agency_account_id = ? WHERE application_user_id = ?",
      [createdAgencyId, stranger.userId],
    );
    const directoryEntry = await social.searchAgency(createdAgencyPublicId);
    assert.equal(directoryEntry.results[0]?.owner?.id, stranger.publicId);
    assert.equal(directoryEntry.results[0]?.owner?.name, stranger.fullName);
    const nameDirectory = await social.searchAgency(
      `  ${String(directoryEntry.results[0]?.name).toUpperCase()}  `,
    );
    assert.equal(
      nameDirectory.results[0]?.id,
      createdAgencyPublicId,
      "Agency names must be case-insensitive and whitespace-normalized",
    );

    const joiner = await user("QA Agency Joiner");
    await social.applyToJoinAgency(joiner, createdAgencyPublicId);
    const firstJoin = (await social.agencyApplicationsForUser(joiner)).find(
      (entry) => entry.type === "join" && entry.status === "pending",
    )!;
    const [pendingMembership] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM application_users WHERE id = ?",
      [joiner.userId],
    );
    assert.equal(
      pendingMembership[0].agency_account_id,
      null,
      "pending request must not map a host",
    );
    assert.equal(
      (await social.agencyOwnerSnapshot(agencyOwner)).joinRequests[0]?.id,
      firstJoin.id,
    );
    await social.reviewOwnAgencyJoin(agencyOwner, {
      applicationId: firstJoin.id,
      decision: "REJECTED",
      reason: "QA first request rejected",
    });
    assert.equal(
      (await social.agencyApplicationsForUser(joiner)).find(
        (entry) => entry.id === firstJoin.id,
      )?.status,
      "rejected",
    );

    const rejectedRetry = await social.applyToJoinAgency(
      joiner,
      createdAgencyPublicId,
    );
    assert.equal(rejectedRetry.id, firstJoin.id);
    assert.equal(
      rejectedRetry.status,
      "rejected",
      "a rejected application retry must return its authoritative state without inserting a duplicate",
    );
    const acceptedJoiner = await user("QA Accepted Agency Joiner");
    await social.applyToJoinAgency(acceptedJoiner, createdAgencyPublicId);
    const secondJoin = (
      await social.agencyApplicationsForUser(acceptedJoiner)
    ).find((entry) => entry.type === "join" && entry.status === "pending")!;
    await social.reviewOwnAgencyJoin(agencyOwner, {
      applicationId: secondJoin.id,
      decision: "APPROVED",
    });
    const [joinedUser] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM application_users WHERE id = ?",
      [acceptedJoiner.userId],
    );
    const [joinedHost] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM host_profiles WHERE application_user_id = ?",
      [acceptedJoiner.userId],
    );
    assert.equal(joinedUser[0].agency_account_id, createdAgencyId);
    assert.equal(joinedHost[0].agency_account_id, createdAgencyId);
    assert.equal(
      (await social.agencyOwnerSnapshot(agencyOwner)).hosts[0]?.user.id,
      acceptedJoiner.publicId,
    );
    await assert.rejects(
      social.applyToJoinAgency(acceptedJoiner, createdAgencyPublicId),
      /must remove you/,
    );
    await assert.rejects(
      social.applyToCreateAgency(acceptedJoiner, {
        ...agencyInput,
        name: "Blocked Joined Agency",
      }),
      /already linked/,
    );

    await social.removeOwnAgencyHost(agencyOwner, {
      targetPublicId: acceptedJoiner.publicId,
      reason: "QA membership lifecycle test",
    });
    const [removedUser] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM application_users WHERE id = ?",
      [acceptedJoiner.userId],
    );
    const [removedHost] = await root.query<RowDataPacket[]>(
      "SELECT agency_account_id FROM host_profiles WHERE application_user_id = ?",
      [acceptedJoiner.userId],
    );
    const [removedMembership] = await root.query<RowDataPacket[]>(
      "SELECT status, ended_at, end_reason FROM agency_membership_applications WHERE id = ?",
      [secondJoin.id],
    );
    assert.equal(removedUser[0].agency_account_id, null);
    assert.equal(removedHost[0].agency_account_id, null);
    assert.equal(removedMembership[0].status, "REMOVED");
    assert.ok(removedMembership[0].ended_at);

    const rejectedAgencyInput = {
      ...agencyInput,
      name: "QA Rejected Agency",
      ownerName: joiner.fullName,
      whatsappE164: "+919000000002",
    };
    await social.applyToCreateAgency(joiner, rejectedAgencyInput);
    const rejectedCreation = (
      await social.agencyApplicationsForUser(joiner)
    ).find((entry) => entry.type === "create" && entry.status === "pending")!;
    await agencies.reviewAgencyCreation({
      scope: master,
      applicationId: rejectedCreation.id,
      decision: "REJECTED",
      reason: "QA rejection creates no Agency",
    });
    const [rejectedAgencyRows] = await root.query<RowDataPacket[]>(
      "SELECT id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?",
      [joiner.userId],
    );
    assert.equal(rejectedAgencyRows.length, 0);

    const otherOwner = await user("QA Other Agency Owner", "MALE");
    await social.applyToCreateAgency(otherOwner, {
      ...agencyInput,
      name: "QA Other Agency",
      ownerName: otherOwner.fullName,
      whatsappE164: "+919000000003",
    });
    const otherCreation = (
      await social.agencyApplicationsForUser(otherOwner)
    ).find((entry) => entry.type === "create" && entry.status === "pending")!;
    await agencies.reviewAgencyCreation({
      scope: master,
      applicationId: otherCreation.id,
      decision: "APPROVED",
      reason: "QA create second owned Agency",
    });
    const [otherAgencyRows] = await root.query<RowDataPacket[]>(
      "SELECT id, public_id FROM platform_accounts WHERE role = 'AGENCY' AND application_user_id = ?",
      [otherOwner.userId],
    );
    const otherAgencyOwner = {
      ...otherOwner,
      role: "AGENCY_OWNER" as const,
      agencyAccountId: String(otherAgencyRows[0].id),
    };
    const maleOwnerLiveCode = `MALEOWNERLIVE${Date.now()}`;
    await product.createRoom(otherAgencyOwner, {
      roomCode: maleOwnerLiveCode,
      kind: "face",
      title: "QA Male Agency Owner Live",
      category: "Talk",
      language: "Hindi",
      privacy: "public",
      seatCount: 0,
      themeIndex: 0,
      themeEnabled: false,
      countryCode: "IN",
    });
    await root.execute(
      `UPDATE live_session_accounting SET media_segment_seconds = 3600,
         valid_media_seconds = 3600, media_publishing = TRUE,
         last_media_heartbeat_at = CURRENT_TIMESTAMP(3)
       WHERE room_id = (SELECT id FROM live_rooms WHERE room_code = ?)`,
      [maleOwnerLiveCode],
    );
    assert.equal(
      (
        await rooms.finalizeLiveSession(
          { ...otherAgencyOwner, gender: "FEMALE" },
          maleOwnerLiveCode,
        )
      ).rewardCoins,
      3500,
      "a male Agency Owner receives the same authoritative completed-hour reward",
    );
    assert.equal(
      (await product.mobileBootstrap(otherAgencyOwner)).liveRewards.filter(
        (reward: { status: string }) => reward.status === "unclaimed",
      ).length,
      1,
    );
    const otherAgencyPublicId = String(otherAgencyRows[0].public_id);
    await social.applyToJoinAgency(joiner, otherAgencyPublicId);
    assert.equal(
      (await social.agencyApplicationsForUser(joiner)).some(
        (entry) =>
          entry.type === "join" &&
          entry.agencyId === otherAgencyPublicId &&
          entry.status === "pending",
      ),
      true,
    );
    console.log(
      "PASS Agency lifecycle: owners remain Hosts; own Agency authorizes Live; male and female owners get the same once-daily 3,500 reward; membership lifecycle and Master approval preserved",
    );

    if (process.env.NAZRAA_QA_KEEP === "1") {
      const fixtures = [];
      for (const [index, identity] of [owner, guest, roomAdmin].entries()) {
        const token = `nazraa-local-core-qa-token-${index}-2026`;
        await root.execute(
          "INSERT INTO mobile_sessions (id, application_user_id, token_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY))",
          [
            randomUUID(),
            identity.userId,
            createHash("sha256").update(token).digest("hex"),
          ],
        );
        fixtures.push({ ...identity, token });
      }
      await writeFile(
        "/tmp/nazraa-core-qa.json",
        JSON.stringify({ database, roomCode, fixtures }),
      );
      keep = true;
      console.log(
        `QA fixtures retained: ${database}; /tmp/nazraa-core-qa.json`,
      );
    }
  } finally {
    await global.nazraaPool?.end();
    if (!keep) await root.query(`DROP DATABASE \`${database}\``);
    await root.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
