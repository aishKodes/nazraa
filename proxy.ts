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
  if (path === "/api/v1/config" || path === "/api/internal/health") {
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
