import { NextResponse, type NextRequest } from "next/server";

// Dormant until the source database is frozen for the single-writer VPS cutover.
export function proxy(request: NextRequest) {
  if (process.env.NAZRAA_CUTOVER_FREEZE !== "1") return NextResponse.next();

  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api/");
  const bridgeReady = process.env.NAZRAA_LEGACY_BRIDGE === "1";
  const bridgeable = path.startsWith("/api/v1/") || path.startsWith("/api/public/");
  if (bridgeReady && bridgeable) {
    const destination = new URL(
      request.nextUrl.pathname + request.nextUrl.search,
      "https://api.nazraa.pixtra.site",
    );
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
  if (path === "/api/internal/health") return NextResponse.next();
  // Control Server Actions post to page paths and must also be fenced.
  if (!isApi && (request.method === "GET" || request.method === "HEAD")) {
    return NextResponse.next();
  }
  return NextResponse.json(
    { code: "TEMPORARY_MAINTENANCE", message: "Nazraa is updating its service. Please try again shortly." },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "180" } },
  );
}

export const config = { matcher: ["/:path*"] };
