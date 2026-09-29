import { NextResponse, type NextRequest } from "next/server";

/**
 * Cutover-only fence for the old Vercel runtime. Some apparently read-only
 * mobile/game routes reconcile or settle state, so the entire old /api tree
 * must stop before the final database snapshot. Static pages stay reachable.
 * This is dormant unless explicitly enabled in the Vercel deployment.
 */
export function proxy(request: NextRequest) {
  if (process.env.NAZRAA_CUTOVER_FREEZE !== "1") {
    return NextResponse.next();
  }
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  // Existing signed APKs still use nazraa.vercel.app. During cutover, forward
  // only their public mobile API to the *one* new authority. Keep cron,
  // provider webhooks, Control APIs and server actions fenced on Vercel.
  // The bridge is a separate switch so a failed parity check can leave the
  // old runtime in maintenance without accidentally writing the stale DB.
  // The VPS now owns Control reads as well as writes. Leaving the old
  // dashboard readable would show stale balances/moderation state despite
  // its actions being fenced. Existing operators should sign in on the
  // authoritative origin; the public marketing/download pages stay here.
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (path === "/login" || path === "/dashboard" || path.startsWith("/dashboard/"))
  ) {
    const destination = new URL(path + request.nextUrl.search, "https://api.nazraa.pixtra.site");
    const response = NextResponse.redirect(destination, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const bridgeReady = process.env.NAZRAA_LEGACY_BRIDGE === "1";
  const bridgeable = path.startsWith("/api/v1/") || path.startsWith("/api/public/");
  if (bridgeReady && bridgeable) {
    const destination = new URL(request.nextUrl.pathname + request.nextUrl.search, "https://api.nazraa.pixtra.site");
    const response = NextResponse.rewrite(destination);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  // The existing LiveKit VM still posts signed media evidence to this
  // hostname. Forward that one POST unchanged until its server-side webhook
  // destination can be moved; signature validation happens at the VPS API.
  if (
    process.env.NAZRAA_LIVEKIT_WEBHOOK_BRIDGE === "1" &&
    path === "/api/internal/livekit/webhook" &&
    request.method === "POST"
  ) {
    const destination = new URL(path, "https://api.nazraa.pixtra.site");
    return NextResponse.rewrite(destination);
  }
  if (path === "/api/internal/health") {
    return NextResponse.next();
  }
  // Control actions are Next Server Actions posted to page paths, not /api.
  // Fence them as well or Control could write the old database after the dump.
  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.next();
  }
  return NextResponse.json(
    {
      code: "TEMPORARY_MAINTENANCE",
      message: "Nazraa is updating its service. Please try again shortly.",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "180" },
    },
  );
}

export const config = { matcher: ["/:path*"] };
