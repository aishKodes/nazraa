import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateMobileRequest, mobileCan } from "@/lib/auth/mobile-session";
import { publicMobileConfig } from "@/lib/db/repositories/mobile";
import {
  createCoinPurchaseRequest,
  createPayoutMethod,
  createRoom,
  createWithdrawalRequest,
  mobileBootstrap,
  sendGift,
  setFollow,
} from "@/lib/db/repositories/mobile-product";
import {
  claimDailyReward,
  exchangeDiamonds,
  finalizeLiveSession,
  joinLiveRoom,
  leaveLiveRoom,
  roomPublishingDecision,
  setRoomAdmin,
  submitAutomaticFaceVerification,
  updateMobileProfile,
} from "@/lib/db/repositories/mobile-completion";
import { ZegoTokenService } from "@/lib/services/zego-token-service";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ message: error instanceof Error ? error.message : "Request failed." }, { status, headers: { "Cache-Control": "no-store" } });
}

function selectResource(resource: string, bootstrap: Awaited<ReturnType<typeof mobileBootstrap>>) {
  if (resource === "bootstrap") return bootstrap;
  const keys: Record<string, string[]> = {
    auth: ["profile", "role", "permissions", "accessPolicy"], profile: ["profile", "accessPolicy"], wallet: ["wallet", "transactions", "minimumWithdrawal", "diamondConversionRule", "diamondExchangeHistory"],
    rooms: ["rooms"], live: ["rooms"], party: ["rooms"], face: ["faceVerificationStatus"],
    agency: ["agency"], host: ["hostProfile"], banners: ["banners", "announcements"],
    withdrawals: ["withdrawalRequests", "payoutMethods", "minimumWithdrawal"], notifications: ["announcements"],
    levels: ["consumptionLevel", "anchorIncomeLevel"], gifts: ["gifts"],
    "coin-packages": ["coinPackages"], "coin-sellers": ["coinSellers"], "coin-orders": ["coinPurchaseRequests"],
    "daily-rewards": ["dailyRewards"], "diamond-exchange": ["diamondConversionRule", "diamondExchangeHistory"],
    "host-rewards": ["hostRewardHistory", "policies", "accessPolicy"], policies: ["policies"],
    leaderboards: ["leaderboards"], discovery: ["discovery"],
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
  const identity = await authenticateMobileRequest(request);
  if (!identity) return errorResponse(new Error("Unauthorized."), 401);
  try {
    const payload = selectResource(resource, await mobileBootstrap(identity));
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } }) : errorResponse(new Error("Mobile resource not found."), 404);
  } catch (error) { return errorResponse(error, 503); }
}

export async function POST(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  const identity = await authenticateMobileRequest(request);
  if (!identity) return errorResponse(new Error("Unauthorized."), 401);
  try {
    const body = await request.json();
    if (resource === "coin-orders") {
      if (!mobileCan(identity, "coin_orders.create")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ packageId: z.string().regex(/^\d+$/), sellerId: z.string().regex(/^\d+$/) }).parse(body);
      return NextResponse.json(await createCoinPurchaseRequest(identity, parsed.packageId, parsed.sellerId), { status: 201 });
    }
    if (resource === "withdrawals") {
      if (!mobileCan(identity, "withdrawals.create")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ amount: z.number().int().positive(), payoutMethodId: z.string().uuid() }).parse(body);
      return NextResponse.json(await createWithdrawalRequest(identity, parsed.amount, parsed.payoutMethodId), { status: 201 });
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
        countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
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
    if (resource === "diamond-exchange") {
      if (!mobileCan(identity, "diamonds.exchange")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ diamonds: z.number().int().positive() }).parse(body);
      return NextResponse.json(await exchangeDiamonds(identity, parsed.diamonds), { status: 201 });
    }
    if (resource === "rooms") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), kind: z.enum(["live", "party", "face"]) }).parse(body);
      const permission = parsed.kind === "party" ? "rooms.create.party" : "rooms.create.live";
      if (!mobileCan(identity, permission)) return errorResponse(new Error("Your role cannot start this room type."), 403);
      if (parsed.kind === "face" && identity.faceVerificationStatus !== "VERIFIED") return errorResponse(new Error("Verified Face Live access is required."), 403);
      return NextResponse.json(await createRoom(identity, parsed), { status: 201 });
    }
    if (resource === "room-join") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await joinLiveRoom(identity, parsed.roomCode));
    }
    if (resource === "room-leave") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await leaveLiveRoom(identity, parsed.roomCode));
    }
    if (resource === "room-admins") {
      if (!mobileCan(identity, "rooms.manage.own")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80), targetPublicId: z.string().regex(/^\d+$/), makeAdmin: z.boolean() }).parse(body);
      return NextResponse.json(await setRoomAdmin(identity, parsed));
    }
    if (resource === "live-end") {
      const parsed = z.object({ roomCode: z.string().trim().min(3).max(80) }).parse(body);
      return NextResponse.json(await finalizeLiveSession(identity, parsed.roomCode));
    }
    if (resource === "gifts") {
      if (!mobileCan(identity, "gifts.send")) return errorResponse(new Error("Forbidden."), 403);
      const parsed = z.object({ giftId: z.string().trim().min(1).max(80), recipient: z.string().trim().min(1).max(120), quantity: z.number().int().min(1).max(99) }).parse(body);
      return NextResponse.json(await sendGift(identity, parsed));
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
