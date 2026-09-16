import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isPerformanceCanaryOperation, runPerformanceCanary } from "@/lib/observability/performance-canary";
import { roomMediaDeliveryDiagnostics } from "@/lib/db/repositories/mobile-completion";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.NAZRAA_BENCHMARK_KEY;
  const actual = request.headers.get("x-nazraa-benchmark-key") ?? "";
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as { operation?: unknown; roomCode?: unknown };
    const operation = typeof body.operation === "string" ? body.operation : "";
    // This protected probe is deliberately restricted to the existing
    // secret-free diagnostic. It makes a pending CDN route observable during
    // controlled QA without expanding the public/mobile API surface.
    if (operation === "media-delivery-diagnostic") {
      const roomCode = typeof body.roomCode === "string" ? body.roomCode.trim() : "";
      if (!/^[A-Z0-9_-]{3,80}$/i.test(roomCode)) {
        return NextResponse.json({ message: "Invalid operation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      const diagnostic = await roomMediaDeliveryDiagnostics(roomCode);
      return diagnostic
        ? NextResponse.json(diagnostic, { headers: { "Cache-Control": "no-store" } })
        : NextResponse.json({ message: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (!isPerformanceCanaryOperation(operation)) {
      return NextResponse.json({ message: "Invalid operation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await runPerformanceCanary(operation), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Performance canary probe failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ message: "Benchmark service is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
