import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Host applications are retired. Every Nazraa application user is host-enabled automatically; Live modes follow the central access policy." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
