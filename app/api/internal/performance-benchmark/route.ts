import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isPerformanceCanaryOperation, runPerformanceCanary } from "@/lib/observability/performance-canary";

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
    const body = await request.json() as { operation?: unknown };
    const operation = typeof body.operation === "string" ? body.operation : "";
    if (!isPerformanceCanaryOperation(operation)) {
      return NextResponse.json({ message: "Invalid operation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await runPerformanceCanary(operation), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Performance canary probe failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ message: "Benchmark service is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
