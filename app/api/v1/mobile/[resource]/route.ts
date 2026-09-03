import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateMobileRequest, mobileCan } from "@/lib/auth/mobile-session";
import { publicMobileConfig } from "@/lib/db/repositories/mobile";
import {
  createCoinPurchaseRequest,
  activeRoomPage,
  createPayoutMethod,
  createRoom,
  createWithdrawalRequest,
  gameRoundHistory,
  gameRoundLeaderboard,
  gameSocialState,
  gameSharedRoundState,
  mobileBootstrap,
  sendGift,
  placeSharedGameBets,
  settleGameRound,
  setFollow,
} from "@/lib/db/repositories/mobile-product";
import {
  claimDailyReward,
  clearRoomChat,
  closePkSession,
  recordFacePresenceAutoStop,
  requestLiveCoHost,
  respondLiveCoHost,
  endLiveCoHost,
  createPkSession,
  exchangeDiamonds,
  finalizeLiveSession,
  joinLiveRoom,
  kickRoomMember,
  leaveLiveRoom,
  markMobileNotificationsRead,
  refreshRoomPresence,
  roomPublishingDecision,
  sendRoomChat,
  sendRoomInteraction,
  setRoomAdmin,
  setRoomMemberMuted,
  updateRoomSettings,
  submitAutomaticFaceVerification,
  updateMobileProfile,
} from "@/lib/db/repositories/mobile-completion";
import { ZegoTokenService } from "@/lib/services/zego-token-service";
import { discoveryPosts, privateMessagingForUser, respondToPrivateRequest, searchPrivateMessageRecipients, socialDirectory } from "@/lib/db/repositories/mobile-social";
import { actOnRoomSeat } from "@/lib/db/repositories/mobile-seats";
import { applyToCreateAgency, applyToJoinAgency, createDiscoveryPost, deleteDiscoveryPost, markPrivateConversationRead, removeOwnAgencyHost, reportDiscoveryPost, reportPrivateMessage, reviewOwnAgencyJoin, searchAgency, sendPrivateMessage, setPrivateMessageBlock, verifyAgencyParent } from "@/lib/db/repositories/mobile-social";
import { claimVipDailyReward, purchaseVipTier, rocketSnapshot } from "@/lib/db/repositories/mobile-rewards";
import { mobileCountryCodeSchema } from "@/lib/mobile-countries";
import { isDatabaseAvailabilityError } from "@/lib/db/pool";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  const transientDatabaseFailure = isDatabaseAvailabilityError(error);
  const rawMessage = error instanceof Error ? error.message : "Request failed.";
  const internalDatabaseFailure =
    /collation|sql|unknown column|database|er_[a-z_]+/i.test(rawMessage) ||
    (typeof error === "object" && error !== null && "code" in error);
  const hideInternalDetails = transientDatabaseFailure || internalDatabaseFailure || status >= 500;
  if (hideInternalDetails) console.error("Mobile API request failed", error);
  return NextResponse.json(
    { message: hideInternalDetails ? "Nazraa is reconnecting to the server. Please retry." : rawMessage },
    { status: transientDatabaseFailure || internalDatabaseFailure ? 503 : status, headers: { "Cache-Control": "no-store", ...(hideInternalDetails ? { "Retry-After": "2" } : {}) } },
  );
}

function selectResource(resource: string, bootstrap: Awaited<ReturnType<typeof mobileBootstrap>>) {
  if (resource === "bootstrap") return bootstrap;
  const keys: Record<string, string[]> = {
    auth: ["profile", "role", "permissions", "accessPolicy"], profile: ["profile", "accessPolicy"], wallet: ["wallet", "transactions", "minimumWithdrawal", "diamondConversionRule", "diamondExchangeHistory"],
    rooms: ["rooms"], live: ["rooms"], party: ["rooms"], face: ["faceVerificationStatus"],
    agency: ["agency", "agencyApplications"], host: ["hostProfile"], banners: ["banners", "announcements"],
    withdrawals: ["withdrawalRequests", "payoutMethods", "minimumWithdrawal"], notifications: ["announcements"],
    levels: ["consumptionLevel", "anchorIncomeLevel"], gifts: ["gifts", "mallCatalog"],
    "coin-packages": ["coinPackages"], "coin-sellers": ["coinSellers"], "coin-orders": ["coinPurchaseRequests"],
    "daily-rewards": ["dailyRewards"], "diamond-exchange": ["diamondConversionRule", "diamondExchangeHistory"],
    "host-rewards": ["hostRewardRules", "hostRewardHistory", "policies", "accessPolicy"], policies: ["policies"],
    leaderboards: ["leaderboards"], discovery: ["discovery"], vip: ["vip"], pk: ["pkStreak"],
  };
  const selected = keys[resource];
  if (!selected) return null;
  return Object.fromEntries(selected.map((key) => [key, bootstrap[key as keyof typeof bootstrap]]));
}

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  if (resource === "config") {
    try { return NextResponse.json(await publicMobileConfig(), { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }); }
    catch { return NextResponse.json({ gifts: [], banners: [], notifications: [], settings: {} }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  }
  try {
    const identity = await authenticateMobileRequest(request);
    if (!identity) return errorResponse(new Error("Unauthorized."), 401);
    if (resource === "rooms") {
      const after = z.string().min(3).max(80).optional().parse(new URL(request.url).searchParams.get("after") ?? undefined);
      return NextResponse.json({ rooms: await activeRoomPage(after) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "discovery-posts") {
      const after = z.string().uuid().optional().parse(new URL(request.url).searchParams.get("after") ?? undefined);
      return NextResponse.json({ posts: await discoveryPosts(after) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "private-messages") {
      const before = z.string().uuid().optional().parse(new URL(request.url).searchParams.get("before") ?? undefined);
      return NextResponse.json(await privateMessagingForUser(identity, before), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "private-message-directory") {
      const query = z.string().trim().min(2).max(80).parse(new URL(request.url).searchParams.get("q"));
      return NextResponse.json(await searchPrivateMessageRecipients(identity, query), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "social-directory") {
      const parameters = new URL(request.url).searchParams;
      const targetPublicId = z.string().regex(/^\d+$/).parse(parameters.get("publicId"));
      const kind = z.enum(["followers", "following"]).parse(parameters.get("kind"));
      const after = z.string().regex(/^\d+$/).optional().parse(parameters.get("after") ?? undefined);
      return NextResponse.json(await socialDirectory(identity, { targetPublicId, kind, after }), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "game-rounds") {
      const parameters = new URL(request.url).searchParams;
      const game = z.enum(["teen_patti_pro", "luck77", "bounty_football", "jungle_hunt", "greedy_king", "greedy_lion"]).parse(parameters.get("game"));
      const limit = z.coerce.number().int().min(1).max(20).default(10).parse(parameters.get("limit") ?? undefined);
      return NextResponse.json(await gameRoundHistory(identity, game, limit), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "game-state") {
      const game = z.enum(["teen_patti_pro", "luck77", "greedy_lion", "greedy_king", "bounty_football"]).parse(new URL(request.url).searchParams.get("game"));
      return NextResponse.json(await gameSharedRoundState(identity, game), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "game-social") {
      const game = z.enum(["teen_patti_pro", "luck77", "bounty_football", "jungle_hunt", "greedy_king", "greedy_lion"]).parse(new URL(request.url).searchParams.get("game"));
      return NextResponse.json(await gameSocialState(game), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "game-leaderboard") {
      const parameters = new URL(request.url).searchParams;
      const game = z.enum(["teen_patti_pro", "luck77", "bounty_football", "jungle_hunt", "greedy_king", "greedy_lion"]).parse(parameters.get("game"));
      const limit = z.coerce.number().int().min(1).max(20).default(10).parse(parameters.get("limit") ?? undefined);
      const period = z.enum(["round", "daily", "weekly", "monthly"]).default("daily").parse(parameters.get("period") ?? undefined);
      return NextResponse.json(await gameRoundLeaderboard(game, limit, period), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (resource === "rocket") {
      const roomCode = z.string().trim().min(3).max(80).parse(new URL(request.url).searchParams.get("roomCode"));
      return NextResponse.json(await rocketSnapshot(identity, roomCode), { headers: { "Cache-Control": "private, no-store" } });
    }
    const payload = selectResource(resource, await mobileBootstrap(identity));
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } }) : errorResponse(new Error("Mobile resource not found."), 404);
  } catch (error) { return errorResponse(error, 503); }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  try {
    const identity = await authenticateMobileRequest(request);
    if (!identity) return errorResponse(new Error("Unauthorized."), 401);
    const body = await request.json();
    if (resource === "room-seat") {
      const parsed = z.object({ roomCode: z.string().min(3).max(80), action: z.enum(["request", "accept", "reject", "assign", "leave", "lock", "unlock"]), seatIndex: z.number().int().min(0).max(19).optional(), targetPublicId: z.string().regex(/^\d+$/).optional() }).parse(body);
      return NextResponse.json(await actOnRoomSeat(identity, parsed));
    }
    if (resource === "private-message-request") {
      const parsed = z.object({ targetPublicId: z.string().regex(/^\d+$/), accept: z.boolean() }).parse(body);
      return NextResponse.json(await respondToPrivateRequest(identity, parsed));
    }
    if (resource === "coin-orders") {
      if (!mobileCan(identity, "coin_orders.create")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ packageId: z.string().regex(/^\d+$/), sellerId: z.string().regex(/^\d+$/) }).parse(body);
      return NextResponse.json(await createCoinPurchaseRequest(identity, parsed.packageId, parsed.sellerId), { status: 201 });
    }
    if (resource === "withdrawals") {
      if (!mobileCan(identity, "withdrawals.create")) return errorResponse(new Error("Forbidden."), 403);
      const payout = z.discriminatedUnion("type", [
        z.object({ type: z.literal("UPI"), accountHolderName: z.string().trim().min(2).max(100), upiId: z.string().trim().regex(/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/) }),
        z.object({ type: z.literal("BANK"), accountHolderName: z.string().trim().min(2).max(100), accountNumber: z.string().regex(/^\d{6,24}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/), bankName: z.string().trim().min(2).max(100) }),
      ]);
      const parsed = z.union([
        z.object({ amount: z.number().int().positive(), payoutMethodId: z.string().uuid() }),
        z.object({ amount: z.number().int().positive(), payout }),
      ]).parse(body);
      return NextResponse.json(await createWithdrawalRequest(identity, parsed.amount, "payoutMethodId" in parsed ? { payoutMethodId: parsed.payoutMethodId } : parsed.payout), { status: 201 });
    }
    if (resource === "payout-methods") {
      if (!mobileCan(identity, "wallet.read")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ type: z.enum(["UPI", "BANK"]), displayName: z.string().trim().min(2).max(100), destination: z.string().trim().min(4).max(190) }).parse(body);
      return NextResponse.json(await createPayoutMethod(identity, parsed), { status: 201 });
    }
    if (resource === "follows") {
      const parsed = z.object({ type: z.enum(["user", "agency"]), publicId: z.string().regex(/^\d+$/), followed: z.boolean() }).parse(body);
      return NextResponse.json(await setFollow(identity, parsed.type, parsed.publicId, parsed.followed));
    }
    if (resource === "profile") {
      if (!mobileCan(identity, "profile.update")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({
        displayName: z.string().trim().min(2).max(120),
        bio: z.string().trim().max(280).default(""),
        gender: z.enum(["FEMALE", "MALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]),
        countryCode: z.string().trim().toUpperCase().pipe(mobileCountryCodeSchema),
        languageCode: z.string().trim().min(2).max(16),
        whatsappE164: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
        avatarDataUrl: z.string().max(1_500_000).optional(),
      }).parse(body);
      return NextResponse.json(await updateMobileProfile(identity, parsed));
    }
    if (resource === "daily-rewards") {
      if (!mobileCan(identity, "daily_rewards.claim")) return errorResponse(new Error("Forbidden."), 403);
      return NextResponse.json(await claimDailyReward(identity), { status: 201 });
    }
    if (resource === "vip-purchase") {
      const parsed = z.object({ tier: z.number().int().min(1).max(5) }).parse(body);
      return NextResponse.json(await purchaseVipTier(identity, parsed.tier), { status: 201 });
    }
    if (resource === "vip-claim") {
      return NextResponse.json(await claimVipDailyReward(identity), { status: 201 });
    }
    if (resource === "notifications-read") {
      return NextResponse.json(await markMobileNotificationsRead(identity));
    }
    if (resource === "diamond-exchange") {
      if (!mobileCan(identity, "diamonds.exchange")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ diamonds: z.number().int().positive() }).parse(body);
      return NextResponse.json(await exchangeDiamonds(identity, parsed.diamonds), { status: 201 });
    }
    if (resource === "agency-search") {
      const parsed = z.object({ publicId: z.string().regex(/^\d{6}$/) }).parse(body);
      return NextResponse.json(await searchAgency(parsed.publicId));
    }
    if (resource === "agency-join") {
      const parsed = z.object({ publicId: z.string().regex(/^\d{6}$/) }).parse(body);
      return NextResponse.json(await applyToJoinAgency(identity, parsed.publicId), { status: 201 });
    }
    if (resource === "agency-membership-review") {
      const parsed = z.object({ applicationId: z.string().uuid(), decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().max(500).optional() }).parse(body);
      return NextResponse.json(await reviewOwnAgencyJoin(identity, parsed));
    }
    if (resource === "agency-host-remove") {
      const parsed = z.object({ targetPublicId: z.string().regex(/^\d+$/), reason: z.string().trim().min(3).max(500) }).parse(body);
      return NextResponse.json(await removeOwnAgencyHost(identity, parsed));
    }
    if (resource === "agency-parent-verify") {
      const parsed = z.object({ publicId: z.string().regex(/^\d{6}$/) }).parse(body);
      return NextResponse.json(await verifyAgencyParent(parsed.publicId));
    }
    if (resource === "agency-apply") {
      const parsed = z.object({
        name: z.string().trim().min(3).max(120),
        ownerName: z.string().trim().min(2).max(120),
        countryCode: z.string().trim().toUpperCase().pipe(mobileCountryCodeSchema),
        whatsappE164: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
        aadhaar: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{12}$/)),
        parentCode: z.string().regex(/^\d{6}$/),
        documentDataUrl: z.string().max(2_850_000),
        documentName: z.string().trim().min(1).max(255),
        additionalDocuments: z.array(z.object({ dataUrl: z.string().min(1).max(950_000), name: z.string().trim().min(1).max(255) })).length(2, "Upload Aadhaar front, Aadhaar back, and a selfie holding Aadhaar."),
        logoDataUrl: z.string().min(1, "Agency logo is required.").max(1_500_000),
      }).parse(body);
      return NextResponse.json(await applyToCreateAgency(identity, parsed), { status: 201 });
    }
    if (resource === "discovery-posts") {
      const parsed = z.object({ caption: z.string().trim().max(500), photoDataUrl: z.string().min(1).max(2_100_000).optional() }).refine((value) => value.caption.length > 0 || value.photoDataUrl, "Write something or add a photo.").parse(body);
      return NextResponse.json(await createDiscoveryPost(identity, parsed), { status: 201 });
    }
    if (resource === "discovery-delete") {
      const parsed = z.object({ postId: z.string().uuid() }).parse(body);
      return NextResponse.json(await deleteDiscoveryPost(identity, parsed.postId));
    }
    if (resource === "discovery-report") {
      const parsed = z.object({ postId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(body);
      return NextResponse.json(await reportDiscoveryPost(identity, parsed));
    }
    if (resource === "private-messages") {
      const parsed = z.object({ recipientPublicId: z.string().regex(/^\d+$/), body: z.string().trim().min(1).max(1000), clientMessageId: z.string().uuid() }).parse(body);
      return NextResponse.json(await sendPrivateMessage(identity, parsed), { status: 201 });
    }
    if (resource === "private-message-block") {
      const parsed = z.object({ targetPublicId: z.string().regex(/^\d+$/), blocked: z.boolean() }).parse(body);
      return NextResponse.json(await setPrivateMessageBlock(identity, parsed));
    }
    if (resource === "private-message-read") {
      const parsed = z.object({ targetPublicId: z.string().regex(/^\d+$/) }).parse(body);
      return NextResponse.json(await markPrivateConversationRead(identity, parsed.targetPublicId));
    }
    if (resource === "private-message-report") {
      const parsed = z.object({ messageId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(body);
      return NextResponse.json(await reportPrivateMessage(identity, parsed));
    }
    if (resource === "rooms") {
      const parsed = z.object({
        roomCode: z.string().trim().min(3).max(80),
        kind: z.enum(["live", "party", "face"]),
        title: z.string().trim().min(3).max(80),
        category: z.string().trim().min(2).max(40),
        language: z.string().trim().min(2).max(32),
        privacy: z.enum(["public", "followers", "locked"]),
        seatCount: z.number().int().min(0).max(20),
        themeIndex: z.number().int().min(0).max(20),
        themeEnabled: z.boolean().default(false),
        countryCode: z.string().trim().toUpperCase().pipe(mobileCountryCodeSchema).optional(),
        photoDataUrl: z.string().max(2_100_000).optional(),
        faceBackgroundDataUrl: z.string().max(2_100_000).optional(),
        password: z.string().regex(/^(\d{4}|\d{6}|\d{10})$/).optional(),
      }).refine((value) => value.kind !== "party" || Boolean(value.photoDataUrl), "Add a room photo before starting a Party.").parse(body);
      const permission = parsed.kind === "party" ? "rooms.create.party" : "rooms.create.live";
      if (!mobileCan(identity, permission)) return errorResponse(new Error("Your role cannot start this room type."), 403);
      if (parsed.kind === "face" && identity.faceVerificationStatus !== "VERIFIED") return errorResponse(new Error("Verified Face Live access is required."), 403);
      return NextResponse.json(await createRoom(identity, parsed), { status: 201 });
    }
    if (resource === "room-join") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), password: z.string().regex(/^(\d{4}|\d{6}|\d{10})$/).optional() }).parse(body);
      return NextResponse.json(await joinLiveRoom(identity, parsed.roomCode, parsed.password));
    }
    if (resource === "room-leave") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await leaveLiveRoom(identity, parsed.roomCode));
    }
    if (resource === "room-presence") {
      const parsed = z.object({
        roomCode: z.string().trim().min(3).max(80),
        mediaPublishing: z.boolean().optional(),
      }).parse(body);
      return NextResponse.json(await refreshRoomPresence(identity, parsed.roomCode, parsed.mediaPublishing));
    }
    if (resource === "room-admins") {
      if (!mobileCan(identity, "rooms.manage.own")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), targetPublicId: z.string().regex(/^\d+$/), makeAdmin: z.boolean() }).parse(body);
      return NextResponse.json(await setRoomAdmin(identity, parsed));
    }
    if (resource === "room-kick") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), targetPublicId: z.string().regex(/^\d+$/), block: z.boolean().default(false) }).parse(body);
      return NextResponse.json(await kickRoomMember(identity, parsed));
    }
    if (resource === "room-microphone") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), targetPublicId: z.string().regex(/^\d+$/), muted: z.boolean() }).parse(body);
      return NextResponse.json(await setRoomMemberMuted(identity, parsed));
    }
    if (resource === "room-interactions") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), targetPublicId: z.string().regex(/^\d+$/), interactionKey: z.string().trim().regex(/^[a-z0-9_-]{2,40}$/) }).parse(body);
      return NextResponse.json(await sendRoomInteraction(identity, parsed), { status: 201 });
    }
    if (resource === "pk-sessions") {
      const parsed = z.object({ sourceRoomCode: z.string().trim().min(3).max(80), targetRoomCode: z.string().trim().min(3).max(80), mode: z.string().trim().min(2).max(32), durationMinutes: z.number().int() }).parse(body);
      return NextResponse.json(await createPkSession(identity, parsed), { status: 201 });
    }
    if (resource === "pk-end") {
      const parsed = z.object({ sessionId: z.string().uuid(), completed: z.boolean() }).parse(body);
      return NextResponse.json(await closePkSession(identity, parsed));
    }
    if (resource === "face-presence") {
      const parsed = z.object({
        roomCode: z.string().trim().min(3).max(80),
        consecutiveFailures: z.number().int().min(1).max(30),
      }).parse(body);
      return NextResponse.json(await recordFacePresenceAutoStop(identity, parsed), { status: 201 });
    }
    if (resource === "room-settings") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), themeIndex: z.number().int().min(0).max(20).optional(), themeEnabled: z.boolean().optional(), pkRequestsEnabled: z.boolean().optional(), audioJoinRequestsEnabled: z.boolean().optional(), chatLocked: z.boolean().optional(), password: z.string().regex(/^(\d{4}|\d{6}|\d{10})$/).optional(), removePassword: z.boolean().default(false), topPublicId: z.string().regex(/^\d+$/).optional(), resetTopDp: z.boolean().default(false) }).parse(body);
      return NextResponse.json(await updateRoomSettings(identity, parsed));
    }
    if (resource === "room-chat") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), body: z.string().trim().min(1).max(500) }).parse(body);
      return NextResponse.json(await sendRoomChat(identity, parsed), { status: 201 });
    }
    if (resource === "room-chat-clear") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await clearRoomChat(identity, parsed.roomCode));
    }
    if (resource === "live-cohost-request") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await requestLiveCoHost(identity, parsed.roomCode), { status: 201 });
    }
    if (resource === "live-cohost-response") {
      const parsed = z.object({
        roomCode: z.string().trim().min(3).max(80),
        targetPublicId: z.string().regex(/^\d+$/),
        accept: z.boolean(),
      }).parse(body);
      return NextResponse.json(await respondLiveCoHost(identity, parsed));
    }
    if (resource === "live-cohost-end") {
      const parsed = z.object({
        roomCode: z.string().trim().min(3).max(80),
        targetPublicId: z.string().regex(/^\d+$/).optional(),
      }).parse(body);
      return NextResponse.json(await endLiveCoHost(identity, parsed));
    }
    if (resource === "live-end") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await finalizeLiveSession(identity, parsed.roomCode));
    }
    if (resource === "gifts") {
      if (!mobileCan(identity, "gifts.send")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ clientGiftId: z.string().uuid(), roomCode: z.string().trim().min(3).max(80), giftId: z.string().trim().min(1).max(80), recipientPublicId: z.string().regex(/^\d+$/), quantity: z.number().int().min(1).max(99) }).parse(body);
      return NextResponse.json(await sendGift(identity, parsed));
    }
    if (resource === "game-wallet") {
      return errorResponse(
        new Error("Direct game wallet changes are disabled. Use an authoritative game round."),
        410,
      );
    }
    if (resource === "game-rounds") {
      if (!mobileCan(identity, "wallet.read")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({
        clientRoundId: z.string().uuid(),
        game: z.enum(["teen_patti_pro", "luck77", "bounty_football", "jungle_hunt", "greedy_king", "greedy_lion"]),
        bets: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().int().nonnegative().max(50_000_000)),
      }).parse(body);
      return NextResponse.json(await settleGameRound(identity, parsed), { status: 201 });
    }
    if (resource === "game-bets") {
      if (!mobileCan(identity, "wallet.read")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({
        requestId: z.string().uuid(),
        roundId: z.string().uuid(),
        game: z.enum(["teen_patti_pro", "luck77", "greedy_lion", "greedy_king", "bounty_football"]),
        bets: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().int().nonnegative().max(50_000_000)),
      }).parse(body);
      return NextResponse.json(await placeSharedGameBets(identity, parsed), { status: 201 });
    }
    if (resource === "face") {
      if (!mobileCan(identity, "face.submit")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({
        framesBase64: z.array(z.string().min(1000).max(3_000_000)).length(1),
        consentVersion: z.literal("nazraa-biometric-1.0"),
      }).parse(body);
      return NextResponse.json(await submitAutomaticFaceVerification(identity, parsed), { status: 201 });
    }
    if (resource === "zego-token") {
      const parsed = z.object({ roomId: z.string().trim().min(1).max(80), publish: z.boolean() }).parse(body);
      if (parsed.publish) await roomPublishingDecision(identity, parsed.roomId);
      return NextResponse.json(new ZegoTokenService().generateRoomToken({ userId: identity.publicId, roomId: parsed.roomId, canPublish: parsed.publish }));
    }
    return errorResponse(new Error("Mobile mutation not found."), 404);
  } catch (error) { return errorResponse(error); }
}
