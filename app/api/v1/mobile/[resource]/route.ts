import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  authenticateMobileRequest,
  mobileCan,
  MobileAccessDeniedError,
} from "@/lib/auth/mobile-session";
import { publicMobileConfig } from "@/lib/db/repositories/mobile";
import {
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
  claimAllLiveRewards,
  claimLiveReward,
  clearRoomChat,
  closePkSession,
  recordFacePresenceAutoStop,
  requestLiveCoHost,
  respondLiveCoHost,
  respondPkSession,
  endLiveCoHost,
  activatePkSession,
  createPkSession,
  exchangeDiamonds,
  finalizeLiveSession,
  joinLiveRoom,
  kickRoomMember,
  listRoomBlockedUsers,
  leaveLiveRoom,
  markMobileNotificationsRead,
  mobileDailyRewardsSnapshot,
  mobileFaceVerificationSnapshot,
  refreshRoomPresence,
  refreshRoomMediaBootstrap,
  refreshLiveRoomAudienceCount,
  sendRoomChat,
  sendRoomInteraction,
  setRoomAdmin,
  setRoomMemberMuted,
  updateRoomSettings,
  unblockRoomMember,
  submitAutomaticFaceVerification,
  updateMobileProfile,
} from "@/lib/db/repositories/mobile-completion";
import { ZegoTokenService } from "@/lib/services/zego-token-service";
import {
  discoveryPosts,
  privateMessagingForUser,
  respondToPrivateRequest,
  searchPrivateMessageRecipients,
  socialDirectory,
} from "@/lib/db/repositories/mobile-social";
import { actOnRoomSeat } from "@/lib/db/repositories/mobile-seats";
import {
  applyToCreateAgency,
  applyToJoinAgency,
  createDiscoveryPost,
  deleteDiscoveryPost,
  markPrivateConversationRead,
  removeOwnAgencyHost,
  reportDiscoveryPost,
  reportPrivateMessage,
  reviewOwnAgencyJoin,
  searchAgency,
  sendPrivateMessage,
  setPrivateMessageBlock,
  verifyAgencyParent,
} from "@/lib/db/repositories/mobile-social";
import {
  claimVipDailyReward,
  purchaseVipTier,
  rocketSnapshot,
} from "@/lib/db/repositories/mobile-rewards";
import {
  expireEndedVipMemberships,
  purchaseMallCosmetic,
  setCosmeticEquipped,
} from "@/lib/db/repositories/mobile-cosmetics";
import { mobileCountryCodeSchema } from "@/lib/mobile-countries";
import { isDatabaseAvailabilityError } from "@/lib/db/pool";
import { syncZegoRoomMixer } from "@/lib/services/zego-stream-mixing-service";
import { authorizeRoomRtc } from "@/lib/services/room-media-authority";
import { assertCreatorCashWithdrawalsEnabled } from "@/lib/services/mobile-feature-policy";
import { verifyGooglePlayCoinPurchase } from "@/lib/db/repositories/mobile-play-billing";
import { traceMobileRequest } from "@/lib/observability/mobile-latency-context";
import { persistMobileLatency } from "@/lib/observability/mobile-latency-store";
import {
  classifyFaceLiveStartFailure,
  recordFaceLiveStartOutcome,
} from "@/lib/observability/face-live-start-outcomes";
import {
  acceptCurrentPolicies,
  assertCurrentPoliciesAccepted,
  deleteAuthenticatedAccount,
  submitSafetyReport,
} from "@/lib/db/repositories/mobile-safety";

export const dynamic = "force-dynamic";

// These routes run on the media critical path and can be called every two
// seconds while a room is open. Cosmetic reads already enforce their own
// expiry predicates, so a global membership-cleanup write here is redundant
// and turns join/presence into an avoidable database waterfall.
const mediaCriticalResources = new Set([
  "room-join",
  "room-presence",
  "room-media-bootstrap",
]);

function scheduleMixerSync(roomCode: string) {
  after(async () => {
    try {
      await syncZegoRoomMixer(roomCode);
    } catch {
      /* Strict paid-routing viewers remain pending; room APIs stay available. */
    }
  });
}

function scheduleRoomJoinMaintenance(roomCode: string) {
  after(async () => {
    await Promise.allSettled([
      syncZegoRoomMixer(roomCode),
      refreshLiveRoomAudienceCount(roomCode),
    ]);
  });
}

function errorResponse(error: unknown, status = 400) {
  const accessDenied = error instanceof MobileAccessDeniedError;
  const transientDatabaseFailure = isDatabaseAvailabilityError(error);
  const rawMessage = error instanceof Error ? error.message : "Request failed.";
  const errorCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  const safeClientCode =
    errorCode === "POLICY_ACCEPTANCE_REQUIRED" ? errorCode : "";
  const responseStatus = accessDenied ? 403 : safeClientCode ? 428 : status;
  const internalDatabaseFailure =
    /collation|sql|unknown column|database|er_[a-z_]+/i.test(rawMessage) ||
    errorCode.startsWith("ER_") ||
    [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "EPIPE",
      "PROTOCOL_CONNECTION_LOST",
    ].includes(errorCode);
  const hideInternalDetails =
    transientDatabaseFailure ||
    internalDatabaseFailure ||
    responseStatus >= 500;
  if (hideInternalDetails) console.error("Mobile API request failed", error);
  return NextResponse.json(
    {
      message: hideInternalDetails
        ? "Nazraa is reconnecting to the server. Please retry."
        : rawMessage,
      ...(accessDenied
        ? { code: error.accessCode }
        : safeClientCode
          ? { code: safeClientCode }
          : {}),
    },
    {
      status:
        transientDatabaseFailure || internalDatabaseFailure
          ? 503
          : responseStatus,
      headers: {
        "Cache-Control": "no-store",
        ...(hideInternalDetails ? { "Retry-After": "2" } : {}),
      },
    },
  );
}

function selectResource(
  resource: string,
  bootstrap: Awaited<ReturnType<typeof mobileBootstrap>>,
) {
  if (resource === "bootstrap") return bootstrap;
  const keys: Record<string, string[]> = {
    auth: ["profile", "role", "permissions", "accessPolicy"],
    profile: ["profile", "accessPolicy"],
    wallet: [
      "wallet",
      "transactions",
      "minimumWithdrawal",
      "diamondConversionRule",
      "diamondExchangeHistory",
    ],
    rooms: ["rooms"],
    live: ["rooms"],
    party: ["rooms"],
    face: ["faceVerificationStatus"],
    agency: ["agency", "agencyApplications"],
    host: ["hostProfile"],
    banners: ["banners", "announcements"],
    withdrawals: ["withdrawalRequests", "payoutMethods", "minimumWithdrawal"],
    notifications: ["announcements"],
    levels: ["consumptionLevel", "anchorIncomeLevel"],
    gifts: ["gifts", "mallCatalog", "cosmeticEntitlements"],
    "coin-packages": ["coinPackages"],
    "coin-sellers": ["coinSellers"],
    "coin-orders": ["coinPurchaseRequests"],
    "daily-rewards": ["dailyRewards", "liveRewards"],
    "diamond-exchange": ["diamondConversionRule", "diamondExchangeHistory"],
    "host-rewards": [
      "hostRewardRules",
      "hostRewardHistory",
      "liveRewards",
      "policies",
      "accessPolicy",
    ],
    policies: ["policies"],
    leaderboards: ["leaderboards"],
    discovery: ["discovery"],
    vip: ["vip"],
    pk: ["pkStreak"],
  };
  const selected = keys[resource];
  if (!selected) return null;
  return Object.fromEntries(
    selected.map((key) => [key, bootstrap[key as keyof typeof bootstrap]]),
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  const traced = await traceMobileRequest(`GET:${resource}`, async () => {
    if (resource === "config") {
      try {
        return NextResponse.json(await publicMobileConfig(), {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          },
        });
      } catch {
        return NextResponse.json(
          { gifts: [], banners: [], notifications: [], settings: {} },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    try {
      const identity = await authenticateMobileRequest(request);
      if (!identity) return errorResponse(new Error("Unauthorized."), 401);
      // These screens are opened and refreshed independently.  They used to
      // materialize the full Home bootstrap before selecting two fields,
      // which made a status-only read wait behind discovery/catalog queries.
      if (resource === "daily-rewards") {
        return NextResponse.json(await mobileDailyRewardsSnapshot(identity), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (resource === "face") {
        return NextResponse.json(await mobileFaceVerificationSnapshot(identity), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (!mediaCriticalResources.has(resource))
        await expireEndedVipMemberships();
      if (resource === "rooms") {
        const after = z
          .string()
          .min(3)
          .max(80)
          .optional()
          .parse(new URL(request.url).searchParams.get("after") ?? undefined);
        return NextResponse.json(
          { rooms: await activeRoomPage(after) },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "discovery-posts") {
        const after = z
          .string()
          .uuid()
          .optional()
          .parse(new URL(request.url).searchParams.get("after") ?? undefined);
        return NextResponse.json(
          { posts: await discoveryPosts(identity, after) },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "private-messages") {
        const before = z
          .string()
          .uuid()
          .optional()
          .parse(new URL(request.url).searchParams.get("before") ?? undefined);
        return NextResponse.json(
          await privateMessagingForUser(identity, before),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "private-message-directory") {
        const query = z
          .string()
          .trim()
          .min(2)
          .max(80)
          .parse(new URL(request.url).searchParams.get("q"));
        return NextResponse.json(
          await searchPrivateMessageRecipients(identity, query),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "social-directory") {
        const parameters = new URL(request.url).searchParams;
        const targetPublicId = z
          .string()
          .regex(/^\d+$/)
          .parse(parameters.get("publicId"));
        const kind = z
          .enum(["followers", "following"])
          .parse(parameters.get("kind"));
        const after = z
          .string()
          .regex(/^\d+$/)
          .optional()
          .parse(parameters.get("after") ?? undefined);
        return NextResponse.json(
          await socialDirectory(identity, { targetPublicId, kind, after }),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "game-rounds") {
        const parameters = new URL(request.url).searchParams;
        const game = z
          .enum([
            "teen_patti_pro",
            "luck77",
            "bounty_football",
            "jungle_hunt",
            "greedy_king",
            "greedy_lion",
          ])
          .parse(parameters.get("game"));
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .parse(parameters.get("limit") ?? undefined);
        return NextResponse.json(
          await gameRoundHistory(identity, game, limit),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "game-state") {
        const game = z
          .enum([
            "teen_patti_pro",
            "luck77",
            "greedy_lion",
            "greedy_king",
            "bounty_football",
          ])
          .parse(new URL(request.url).searchParams.get("game"));
        return NextResponse.json(await gameSharedRoundState(identity, game), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (resource === "game-social") {
        const game = z
          .enum([
            "teen_patti_pro",
            "luck77",
            "bounty_football",
            "jungle_hunt",
            "greedy_king",
            "greedy_lion",
          ])
          .parse(new URL(request.url).searchParams.get("game"));
        return NextResponse.json(await gameSocialState(game), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (resource === "game-leaderboard") {
        const parameters = new URL(request.url).searchParams;
        const game = z
          .enum([
            "teen_patti_pro",
            "luck77",
            "bounty_football",
            "jungle_hunt",
            "greedy_king",
            "greedy_lion",
          ])
          .parse(parameters.get("game"));
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .parse(parameters.get("limit") ?? undefined);
        const period = z
          .enum(["round", "daily", "weekly", "monthly"])
          .default("daily")
          .parse(parameters.get("period") ?? undefined);
        return NextResponse.json(
          await gameRoundLeaderboard(game, limit, period),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (resource === "rocket") {
        const roomCode = z
          .string()
          .trim()
          .min(3)
          .max(80)
          .parse(new URL(request.url).searchParams.get("roomCode"));
        return NextResponse.json(await rocketSnapshot(identity, roomCode), {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (resource === "room-blocks") {
        const roomCode = z
          .string()
          .trim()
          .min(3)
          .max(80)
          .parse(new URL(request.url).searchParams.get("roomCode"));
        return NextResponse.json(
          await listRoomBlockedUsers(identity, roomCode),
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const payload = selectResource(resource, await mobileBootstrap(identity));
      return payload
        ? NextResponse.json(payload, {
            headers: { "Cache-Control": "private, no-store" },
          })
        : errorResponse(new Error("Mobile resource not found."), 404);
    } catch (error) {
      return errorResponse(error, 503);
    }
  });
  after(() => persistMobileLatency(traced.trace));
  return traced.response;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ resource: string }> },
) {
  const { resource } = await context.params;
  const traced = await traceMobileRequest(`POST:${resource}`, async () => {
    try {
      const identity = await authenticateMobileRequest(request);
      if (!identity) return errorResponse(new Error("Unauthorized."), 401);
      if (!mediaCriticalResources.has(resource)) {
        await expireEndedVipMemberships();
      }
      const body = await request.json();
      if (resource === "room-seat") {
        const parsed = z
          .object({
            roomCode: z.string().min(3).max(80),
            action: z.enum([
              "request",
              "accept",
              "reject",
              "assign",
              "leave",
              "lock",
              "unlock",
            ]),
            seatIndex: z.number().int().min(0).max(19).optional(),
            targetPublicId: z.string().regex(/^\d+$/).optional(),
          })
          .parse(body);
        const result = await actOnRoomSeat(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "private-message-request") {
        const parsed = z
          .object({
            targetPublicId: z.string().regex(/^\d+$/),
            accept: z.boolean(),
          })
          .parse(body);
        return NextResponse.json(
          await respondToPrivateRequest(identity, parsed),
        );
      }
      if (resource === "coin-orders") {
        return errorResponse(
          new Error(
            "Coin purchases in this app are available only through Google Play.",
          ),
          410,
        );
      }
      if (resource === "play-purchase-verify") {
        const parsed = z
          .object({
            productId: z
              .string()
              .trim()
              .regex(/^[a-zA-Z0-9._]+$/)
              .max(120),
            purchaseToken: z.string().trim().min(16).max(4096),
          })
          .parse(body);
        return NextResponse.json(
          await verifyGooglePlayCoinPurchase(identity, parsed),
          { status: 201 },
        );
      }
      if (resource === "withdrawals") {
        await assertCreatorCashWithdrawalsEnabled();
        if (!mobileCan(identity, "withdrawals.create"))
          return errorResponse(new Error("Forbidden."), 403);
        const payout = z.discriminatedUnion("type", [
          z.object({
            type: z.literal("UPI"),
            accountHolderName: z.string().trim().min(2).max(100),
            upiId: z
              .string()
              .trim()
              .regex(/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/),
          }),
          z.object({
            type: z.literal("BANK"),
            accountHolderName: z.string().trim().min(2).max(100),
            accountNumber: z.string().regex(/^\d{6,24}$/),
            ifsc: z
              .string()
              .trim()
              .toUpperCase()
              .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
            bankName: z.string().trim().min(2).max(100),
          }),
        ]);
        const parsed = z
          .union([
            z.object({
              amount: z.number().int().positive(),
              payoutMethodId: z.string().uuid(),
            }),
            z.object({ amount: z.number().int().positive(), payout }),
          ])
          .parse(body);
        return NextResponse.json(
          await createWithdrawalRequest(
            identity,
            parsed.amount,
            "payoutMethodId" in parsed
              ? { payoutMethodId: parsed.payoutMethodId }
              : parsed.payout,
          ),
          { status: 201 },
        );
      }
      if (resource === "payout-methods") {
        await assertCreatorCashWithdrawalsEnabled();
        if (!mobileCan(identity, "wallet.read"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            type: z.enum(["UPI", "BANK"]),
            displayName: z.string().trim().min(2).max(100),
            destination: z.string().trim().min(4).max(190),
          })
          .parse(body);
        return NextResponse.json(await createPayoutMethod(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "follows") {
        const parsed = z
          .object({
            type: z.enum(["user", "agency"]),
            publicId: z.string().regex(/^\d+$/),
            followed: z.boolean(),
          })
          .parse(body);
        return NextResponse.json(
          await setFollow(
            identity,
            parsed.type,
            parsed.publicId,
            parsed.followed,
          ),
        );
      }
      if (resource === "profile") {
        if (!mobileCan(identity, "profile.update"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            displayName: z.string().trim().min(2).max(120),
            bio: z.string().trim().max(280).default(""),
            gender: z.enum([
              "FEMALE",
              "MALE",
              "NON_BINARY",
              "PREFER_NOT_TO_SAY",
            ]),
            countryCode: z
              .string()
              .trim()
              .toUpperCase()
              .pipe(mobileCountryCodeSchema),
            languageCode: z.string().trim().min(2).max(16),
            whatsappE164: z
              .string()
              .trim()
              .regex(/^\+[1-9]\d{7,14}$/),
            avatarDataUrl: z.string().max(1_500_000).optional(),
          })
          .parse(body);
        return NextResponse.json(await updateMobileProfile(identity, parsed));
      }
      if (resource === "policy-acceptance") {
        const parsed = z
          .object({
            termsVersion: z.string().trim().min(1).max(32),
            communityGuidelinesVersion: z.string().trim().min(1).max(32),
          })
          .parse(body);
        return NextResponse.json(await acceptCurrentPolicies(identity, parsed));
      }
      if (resource === "account-deletion") {
        const parsed = z
          .object({ confirmation: z.literal("DELETE") })
          .parse(body);
        void parsed;
        return NextResponse.json(await deleteAuthenticatedAccount(identity));
      }
      if (resource === "safety-report") {
        const parsed = z
          .object({
            clientReportId: z.string().uuid(),
            reportType: z.enum([
              "PROFILE",
              "USER",
              "HOST",
              "ROOM",
              "CONTENT",
              "DIRECT_MESSAGE",
              "CHILD_SAFETY",
              "COPYRIGHT",
            ]),
            reasonCode: z
              .string()
              .trim()
              .regex(/^[a-z0-9_-]+$/)
              .max(80),
            reasonDetail: z.string().trim().max(500).optional(),
            targetPublicId: z.string().regex(/^\d+$/).optional(),
            roomCode: z.string().trim().min(3).max(80).optional(),
            contentId: z.string().uuid().optional(),
            messageId: z.string().uuid().optional(),
            evidenceMetadata: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(body);
        return NextResponse.json(await submitSafetyReport(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "daily-rewards") {
        if (!mobileCan(identity, "daily_rewards.claim"))
          return errorResponse(new Error("Forbidden."), 403);
        return NextResponse.json(await claimDailyReward(identity), {
          status: 201,
        });
      }
      if (resource === "live-reward-claim") {
        const parsed = z.object({ rewardId: z.string().uuid() }).parse(body);
        return NextResponse.json(
          await claimLiveReward(identity, parsed.rewardId),
        );
      }
      if (resource === "live-rewards-claim-all") {
        return NextResponse.json(await claimAllLiveRewards(identity));
      }
      if (resource === "vip-purchase") {
        const parsed = z
          .object({ tier: z.number().int().min(1).max(5) })
          .parse(body);
        return NextResponse.json(await purchaseVipTier(identity, parsed.tier), {
          status: 201,
        });
      }
      if (resource === "vip-claim") {
        return NextResponse.json(await claimVipDailyReward(identity), {
          status: 201,
        });
      }
      if (resource === "mall-purchase") {
        const parsed = z
          .object({
            itemId: z
              .string()
              .trim()
              .regex(/^[a-z0-9_]+$/)
              .max(80),
            clientRequestId: z.string().uuid(),
          })
          .parse(body);
        return NextResponse.json(await purchaseMallCosmetic(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "mall-equip") {
        const parsed = z
          .object({ entitlementId: z.string().uuid(), equipped: z.boolean() })
          .parse(body);
        return NextResponse.json(await setCosmeticEquipped(identity, parsed));
      }
      if (resource === "notifications-read") {
        return NextResponse.json(await markMobileNotificationsRead(identity));
      }
      if (resource === "diamond-exchange") {
        if (!mobileCan(identity, "diamonds.exchange"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({ diamonds: z.number().int().positive() })
          .parse(body);
        return NextResponse.json(
          await exchangeDiamonds(identity, parsed.diamonds),
          { status: 201 },
        );
      }
      if (resource === "agency-search") {
        const parsed = z
          .object({ query: z.string().trim().min(2).max(120) })
          .parse(body);
        return NextResponse.json(await searchAgency(parsed.query));
      }
      if (resource === "agency-join") {
        const parsed = z
          .object({ publicId: z.string().regex(/^\d{6}$/) })
          .parse(body);
        return NextResponse.json(
          await applyToJoinAgency(identity, parsed.publicId),
          { status: 201 },
        );
      }
      if (resource === "agency-membership-review") {
        const parsed = z
          .object({
            applicationId: z.string().uuid(),
            decision: z.enum(["APPROVED", "REJECTED"]),
            reason: z.string().trim().max(500).optional(),
          })
          .parse(body);
        return NextResponse.json(await reviewOwnAgencyJoin(identity, parsed));
      }
      if (resource === "agency-host-remove") {
        const parsed = z
          .object({
            targetPublicId: z.string().regex(/^\d+$/),
            reason: z.string().trim().min(3).max(500),
          })
          .parse(body);
        return NextResponse.json(await removeOwnAgencyHost(identity, parsed));
      }
      if (resource === "agency-parent-verify") {
        const parsed = z
          .object({ publicId: z.string().regex(/^\d{6}$/) })
          .parse(body);
        return NextResponse.json(await verifyAgencyParent(parsed.publicId));
      }
      if (resource === "agency-apply") {
        const parsed = z
          .object({
            name: z.string().trim().min(3).max(120),
            ownerName: z.string().trim().min(2).max(120),
            countryCode: z
              .string()
              .trim()
              .toUpperCase()
              .pipe(mobileCountryCodeSchema),
            whatsappE164: z
              .string()
              .trim()
              .regex(/^\+[1-9]\d{7,14}$/),
            aadhaar: z
              .string()
              .transform((value) => value.replace(/\D/g, ""))
              .pipe(z.string().regex(/^\d{12}$/)),
            parentCode: z.string().regex(/^\d{6}$/),
            documentDataUrl: z.string().max(2_850_000),
            documentName: z.string().trim().min(1).max(255),
            additionalDocuments: z
              .array(
                z.object({
                  dataUrl: z.string().min(1).max(950_000),
                  name: z.string().trim().min(1).max(255),
                }),
              )
              .length(
                2,
                "Upload Aadhaar front, Aadhaar back, and a selfie holding Aadhaar.",
              ),
            logoDataUrl: z
              .string()
              .min(1, "Agency logo is required.")
              .max(1_500_000),
          })
          .parse(body);
        return NextResponse.json(await applyToCreateAgency(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "discovery-posts") {
        await assertCurrentPoliciesAccepted(identity);
        const parsed = z
          .object({
            caption: z.string().trim().max(500),
            photoDataUrl: z.string().min(1).max(2_100_000).optional(),
          })
          .refine(
            (value) => value.caption.length > 0 || value.photoDataUrl,
            "Write something or add a photo.",
          )
          .parse(body);
        return NextResponse.json(await createDiscoveryPost(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "discovery-delete") {
        const parsed = z.object({ postId: z.string().uuid() }).parse(body);
        return NextResponse.json(
          await deleteDiscoveryPost(identity, parsed.postId),
        );
      }
      if (resource === "discovery-report") {
        const parsed = z
          .object({
            postId: z.string().uuid(),
            reason: z.string().trim().min(3).max(500),
          })
          .parse(body);
        return NextResponse.json(await reportDiscoveryPost(identity, parsed));
      }
      if (resource === "private-messages") {
        await assertCurrentPoliciesAccepted(identity);
        const parsed = z
          .object({
            recipientPublicId: z.string().regex(/^\d+$/),
            body: z.string().trim().min(1).max(1000),
            clientMessageId: z.string().uuid(),
          })
          .parse(body);
        return NextResponse.json(await sendPrivateMessage(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "private-message-block") {
        const parsed = z
          .object({
            targetPublicId: z.string().regex(/^\d+$/),
            blocked: z.boolean(),
          })
          .parse(body);
        return NextResponse.json(
          await setPrivateMessageBlock(identity, parsed),
        );
      }
      if (resource === "private-message-read") {
        const parsed = z
          .object({ targetPublicId: z.string().regex(/^\d+$/) })
          .parse(body);
        return NextResponse.json(
          await markPrivateConversationRead(identity, parsed.targetPublicId),
        );
      }
      if (resource === "private-message-report") {
        const parsed = z
          .object({
            messageId: z.string().uuid(),
            reason: z.string().trim().min(3).max(500),
          })
          .parse(body);
        return NextResponse.json(await reportPrivateMessage(identity, parsed));
      }
      if (resource === "rooms") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            kind: z.enum(["party", "face"]),
            title: z.string().trim().min(3).max(80),
            category: z.string().trim().min(2).max(40),
            language: z.string().trim().min(2).max(32),
            privacy: z.enum(["public", "followers", "locked"]),
            seatCount: z.number().int().min(0).max(20),
            themeIndex: z.number().int().min(0).max(20),
            themeEnabled: z.boolean().default(false),
            countryCode: z
              .string()
              .trim()
              .toUpperCase()
              .pipe(mobileCountryCodeSchema)
              .optional(),
            photoDataUrl: z.string().max(2_100_000).optional(),
            faceBackgroundDataUrl: z.string().max(2_100_000).optional(),
            password: z
              .string()
              .regex(/^(\d{4}|\d{6}|\d{10})$/)
              .optional(),
          })
          .refine(
            (value) => value.kind !== "party" || Boolean(value.photoDataUrl),
            "Add a room photo before starting a Party.",
          )
          .parse(body);
        const faceStart = parsed.kind === "face";
        try {
          await assertCurrentPoliciesAccepted(identity);
          const permission =
            parsed.kind === "party" ? "rooms.create.party" : "rooms.create.live";
          if (!mobileCan(identity, permission)) {
            if (faceStart)
              after(() => recordFaceLiveStartOutcome("FAILURE", "ELIGIBILITY"));
            return errorResponse(
              new Error("Your role cannot start this room type."),
              403,
            );
          }
          if (
            parsed.kind === "face" &&
            identity.faceVerificationStatus !== "VERIFIED"
          ) {
            after(() => recordFaceLiveStartOutcome("FAILURE", "VERIFICATION"));
            return errorResponse(
              new Error("Verified Face Live access is required."),
              403,
            );
          }
          const result = await createRoom(identity, parsed);
          // The Host will confirm publishing in its first presence heartbeat. A
          // best-effort sync here is still useful for room types whose publisher
          // signal is already present, and never delays room creation.
          scheduleMixerSync(parsed.roomCode);
          if (faceStart) after(() => recordFaceLiveStartOutcome("SUCCESS"));
          return NextResponse.json(result, { status: 201 });
        } catch (error) {
          if (faceStart) {
            const category = classifyFaceLiveStartFailure(error);
            after(() => recordFaceLiveStartOutcome("FAILURE", category));
          }
          throw error;
        }
      }
      if (resource === "room-join") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            password: z
              .string()
              .regex(/^(\d{4}|\d{6}|\d{10})$/)
              .optional(),
            includeMediaBootstrap: z.boolean().optional(),
            preferredPassivePlaybackProtocol: z.enum(["hls", "flv"]).optional(),
          })
          .parse(body);
        const result = await joinLiveRoom(
          identity,
          parsed.roomCode,
          parsed.password,
          parsed.includeMediaBootstrap
            ? {
                preferredFacePlaybackProtocol:
                  parsed.preferredPassivePlaybackProtocol,
              }
            : undefined,
        );
        // Face passive playback needs only this compact, authorization-backed
        // media snapshot. Returning it from the join request eliminates the
        // second cold Vercel-to-MySQL request before HLS can start. Party and
        // all existing callers retain their original response shape/cost.
        if (parsed.includeMediaBootstrap) {
          scheduleRoomJoinMaintenance(parsed.roomCode);
          return NextResponse.json(result);
        }
        scheduleRoomJoinMaintenance(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "room-leave") {
        const parsed = z
          .object({ roomCode: z.string().trim().min(3).max(80) })
          .parse(body);
        const result = await leaveLiveRoom(identity, parsed.roomCode);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "room-presence") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            mediaPublishing: z.boolean().optional(),
            preferredPassivePlaybackProtocol: z.enum(["hls", "flv"]).optional(),
            runtimeDiagnostics: z
              .object({
                connectionPhase: z.enum([
                  "idle",
                  "connecting",
                  "connected",
                  "reconnecting",
                  "failed",
                  "ended",
                ]),
                reconnectCount: z.number().int().min(0).max(1000),
                publishing: z.boolean(),
                playbackActive: z.boolean(),
                lastTerminalErrorCategory: z
                  .string()
                  .trim()
                  .min(1)
                  .max(64)
                  .nullable()
                  .optional(),
                activeSpeakers: z.number().int().min(0).max(10000),
                passiveViewers: z.number().int().min(0).max(100000),
                animationQueueLength: z.number().int().min(0).max(100),
                messageDeliveryLatencyMs: z
                  .number()
                  .int()
                  .min(0)
                  .max(300000)
                  .nullable()
                  .optional(),
              })
              .optional(),
          })
          .parse(body);
        const result = await refreshRoomPresence(
          identity,
          parsed.roomCode,
          parsed.mediaPublishing,
          parsed.runtimeDiagnostics,
          parsed.preferredPassivePlaybackProtocol,
        );
        // A room presence response is on the critical tap-to-first-frame path.
        // Do not make it wait for a remote mixer command and then run the
        // expensive presence transaction again. The response already reports
        // the authoritative safe state (`streamingPending`) while the output is
        // starting, and the client performs a tightly bounded readiness retry.
        // This preserves the no-passive-RTC invariant without turning one media
        // transition into a refresh → ZEGO API → refresh waterfall.
        // An actively publishing Host is the signal used to pre-warm the Face
        // CDN output. Do this after the response so host controls never wait on
        // ZEGO, and retain the existing pending-output trigger for audiences.
        if (
          parsed.mediaPublishing === true ||
          (result.active && result.mediaDelivery?.mode === "streamingPending")
        ) {
          scheduleMixerSync(parsed.roomCode);
        }
        return NextResponse.json(result);
      }
      if (resource === "room-media-bootstrap") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            preferredPassivePlaybackProtocol: z.enum(["hls", "flv"]).optional(),
          })
          .parse(body);
        const result = await refreshRoomMediaBootstrap(
          identity,
          parsed.roomCode,
          parsed.preferredPassivePlaybackProtocol,
        );
        if (
          result.active &&
          result.mediaDelivery?.mode === "streamingPending"
        ) {
          scheduleMixerSync(parsed.roomCode);
        }
        return NextResponse.json(result);
      }
      if (resource === "room-admins") {
        if (!mobileCan(identity, "rooms.manage.own"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
            makeAdmin: z.boolean(),
          })
          .parse(body);
        const result = await setRoomAdmin(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "room-kick") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
            reason: z.string().trim().max(500).optional(),
          })
          .parse(body);
        const result = await kickRoomMember(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "room-blocks") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
          })
          .parse(body);
        return NextResponse.json(await unblockRoomMember(identity, parsed));
      }
      if (resource === "room-microphone") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
            muted: z.boolean(),
          })
          .parse(body);
        const result = await setRoomMemberMuted(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "room-interactions") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
            interactionKey: z
              .string()
              .trim()
              .regex(/^[a-z0-9_-]{2,40}$/),
          })
          .parse(body);
        return NextResponse.json(await sendRoomInteraction(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "pk-sessions") {
        const parsed = z
          .object({
            sourceRoomCode: z.string().trim().min(3).max(80),
            targetRoomCode: z.string().trim().min(3).max(80),
            mode: z.string().trim().min(2).max(32),
            durationMinutes: z.number().int(),
          })
          .parse(body);
        return NextResponse.json(await createPkSession(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "pk-start") {
        const parsed = z.object({ sessionId: z.string().uuid() }).parse(body);
        const result = await activatePkSession(identity, parsed.sessionId);
        scheduleMixerSync(result.sourceRoomCode);
        scheduleMixerSync(result.targetRoomCode);
        return NextResponse.json(result);
      }
      if (resource === "pk-response") {
        const parsed = z
          .object({ sessionId: z.string().uuid(), accept: z.boolean() })
          .parse(body);
        const result = await respondPkSession(identity, parsed);
        scheduleMixerSync(result.sourceRoomCode);
        scheduleMixerSync(result.targetRoomCode);
        return NextResponse.json(result);
      }
      if (resource === "pk-end") {
        const parsed = z
          .object({ sessionId: z.string().uuid(), completed: z.boolean() })
          .parse(body);
        const result = await closePkSession(identity, parsed);
        scheduleMixerSync(result.sourceRoomCode);
        scheduleMixerSync(result.targetRoomCode);
        return NextResponse.json(result);
      }
      if (resource === "face-presence") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            consecutiveFailures: z.number().int().min(1).max(30),
          })
          .parse(body);
        return NextResponse.json(
          await recordFacePresenceAutoStop(identity, parsed),
          { status: 201 },
        );
      }
      if (resource === "room-settings") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            themeIndex: z.number().int().min(0).max(20).optional(),
            themeEnabled: z.boolean().optional(),
            pkRequestsEnabled: z.boolean().optional(),
            audioJoinRequestsEnabled: z.boolean().optional(),
            chatLocked: z.boolean().optional(),
            password: z
              .string()
              .regex(/^(\d{4}|\d{6}|\d{10})$/)
              .optional(),
            removePassword: z.boolean().default(false),
            topPublicId: z.string().regex(/^\d+$/).optional(),
            resetTopDp: z.boolean().default(false),
          })
          .parse(body);
        return NextResponse.json(await updateRoomSettings(identity, parsed));
      }
      if (resource === "room-chat") {
        await assertCurrentPoliciesAccepted(identity);
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            body: z.string().trim().min(1).max(500),
            clientMessageId: z.string().uuid().optional(),
          })
          .parse(body);
        return NextResponse.json(await sendRoomChat(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "room-chat-clear") {
        const parsed = z
          .object({ roomCode: z.string().trim().min(3).max(80) })
          .parse(body);
        return NextResponse.json(
          await clearRoomChat(identity, parsed.roomCode),
        );
      }
      if (resource === "live-cohost-request") {
        const parsed = z
          .object({ roomCode: z.string().trim().min(3).max(80) })
          .parse(body);
        return NextResponse.json(
          await requestLiveCoHost(identity, parsed.roomCode),
          { status: 201 },
        );
      }
      if (resource === "live-cohost-response") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/),
            accept: z.boolean(),
          })
          .parse(body);
        const result = await respondLiveCoHost(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "live-cohost-end") {
        const parsed = z
          .object({
            roomCode: z.string().trim().min(3).max(80),
            targetPublicId: z.string().regex(/^\d+$/).optional(),
          })
          .parse(body);
        const result = await endLiveCoHost(identity, parsed);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "live-end") {
        const parsed = z
          .object({ roomCode: z.string().trim().min(3).max(80) })
          .parse(body);
        const result = await finalizeLiveSession(identity, parsed.roomCode);
        scheduleMixerSync(parsed.roomCode);
        return NextResponse.json(result);
      }
      if (resource === "gifts") {
        if (!mobileCan(identity, "gifts.send"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            clientGiftId: z.string().uuid(),
            roomCode: z.string().trim().min(3).max(80),
            giftId: z.string().trim().min(1).max(80),
            recipientPublicId: z.string().regex(/^\d+$/),
            quantity: z.number().int().min(1).max(99),
          })
          .parse(body);
        return NextResponse.json(await sendGift(identity, parsed));
      }
      if (resource === "game-wallet") {
        return errorResponse(
          new Error(
            "Direct game wallet changes are disabled. Use an authoritative game round.",
          ),
          410,
        );
      }
      if (resource === "game-rounds") {
        if (!mobileCan(identity, "wallet.read"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            clientRoundId: z.string().uuid(),
            game: z.enum([
              "teen_patti_pro",
              "luck77",
              "bounty_football",
              "jungle_hunt",
              "greedy_king",
              "greedy_lion",
            ]),
            bets: z.record(
              z.string().regex(/^[a-z0-9_]+$/),
              z.number().int().nonnegative().max(50_000_000),
            ),
          })
          .parse(body);
        return NextResponse.json(await settleGameRound(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "game-bets") {
        if (!mobileCan(identity, "wallet.read"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            requestId: z.string().uuid(),
            roundId: z.string().uuid(),
            game: z.enum([
              "teen_patti_pro",
              "luck77",
              "greedy_lion",
              "greedy_king",
              "bounty_football",
            ]),
            bets: z.record(
              z.string().regex(/^[a-z0-9_]+$/),
              z.number().int().nonnegative().max(50_000_000),
            ),
          })
          .parse(body);
        return NextResponse.json(await placeSharedGameBets(identity, parsed), {
          status: 201,
        });
      }
      if (resource === "face") {
        if (!mobileCan(identity, "face.submit"))
          return errorResponse(new Error("Forbidden."), 403);
        const parsed = z
          .object({
            // Keep the JSON request below Vercel's function payload ceiling while
            // accepting the larger JPEGs produced by existing Android releases.
            framesBase64: z
              .array(z.string().min(1000).max(4_000_000))
              .length(1),
            consentVersion: z.literal("nazraa-biometric-1.0"),
            clientSubmissionId: z.string().uuid(),
          })
          .parse(body);
        return NextResponse.json(
          await submitAutomaticFaceVerification(identity, parsed),
          { status: 201 },
        );
      }
      if (resource === "zego-token") {
        const parsed = z
          .object({
            roomId: z.string().trim().min(1).max(80),
            publish: z.boolean(),
          })
          .parse(body);
        const authorization = await authorizeRoomRtc(identity, {
          roomCode: parsed.roomId,
          canPublish: parsed.publish,
        });
        return NextResponse.json({
          ...new ZegoTokenService().generateRoomToken({
            userId: identity.publicId,
            roomId: parsed.roomId,
            canPublish: parsed.publish,
            ttlSeconds: authorization.ttlSeconds,
            streamId: authorization.streamId,
          }),
          mediaRole: authorization.mediaRole,
          publishMode: authorization.publishMode,
        });
      }
      return errorResponse(new Error("Mobile mutation not found."), 404);
    } catch (error) {
      return errorResponse(error);
    }
  });
  after(() => persistMobileLatency(traced.trace));
  return traced.response;
}
