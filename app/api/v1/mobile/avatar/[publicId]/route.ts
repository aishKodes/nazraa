import { NextResponse } from "next/server";
import { avatarForPublicId } from "@/lib/db/repositories/mobile-completion";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await context.params;
  if (!/^\d+$/.test(publicId)) return NextResponse.json({ message: "Avatar not found." }, { status: 404 });
  const avatar = await avatarForPublicId(publicId);
  if (!avatar) return NextResponse.json({ message: "Avatar not found." }, { status: 404 });
  return new NextResponse(new Uint8Array(avatar.image_data), {
    headers: {
      "Content-Type": avatar.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
