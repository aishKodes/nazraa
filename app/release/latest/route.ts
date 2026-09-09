import { NextResponse } from "next/server";
import { latestPublicRelease } from "@/lib/release/latest-release";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(latestPublicRelease, {
    headers: {
      "Cache-Control":
        "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
