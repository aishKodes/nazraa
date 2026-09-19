import { NextResponse } from "next/server";
import { latestPublicRelease } from "@/lib/release/latest-release";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(latestPublicRelease, {
    headers: {
      // This endpoint drives the in-app release gate. A stale edge response
      // can direct a user to the previous APK after a signed release has
      // already been published, so correctness is more important than this
      // tiny JSON response's cache hit rate.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
