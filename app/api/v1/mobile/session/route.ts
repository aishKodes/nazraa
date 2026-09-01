import { NextResponse } from "next/server";
import { z } from "zod";
import { createDevelopmentMobileSession, createGoogleMobileSession, revokeMobileSession } from "@/lib/auth/mobile-session";
import { mobileCountryCodeSchema } from "@/lib/mobile-countries";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const google = z.object({
      idToken: z.string().min(100).max(10_000),
      deviceLabel: z.string().trim().max(120).optional(),
      deviceId: z.string().trim().min(8).max(200).optional(),
      profile: z.object({
        fullName: z.string().trim().min(2).max(120),
        countryCode: z.string().trim().toUpperCase().pipe(mobileCountryCodeSchema),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
          const date = new Date(`${value}T00:00:00.000Z`);
          return !Number.isNaN(date.getTime()) && date < new Date();
        }, "Choose a valid date of birth."),
        gender: z.enum(["FEMALE", "MALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]),
        whatsappE164: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
        languageCode: z.string().trim().min(2).max(16).optional(),
        avatarUrl: z.string().url().optional(),
      }).optional(),
    }).safeParse(body);
    if (google.success) {
      const result = await createGoogleMobileSession(google.data);
      return NextResponse.json(result, { status: result.requiresProfile ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    const development = z.object({
      developmentProfile: z.literal(true),
      fullName: z.string().trim().min(2).max(120),
      countryCode: z.string().trim().toUpperCase().pipe(mobileCountryCodeSchema),
      deviceLabel: z.string().trim().max(120).optional(),
      deviceId: z.string().trim().min(8).max(200).optional(),
    }).safeParse(body);
    if (!development.success) return NextResponse.json({ message: "Google Sign-In is required." }, { status: 400 });
    return NextResponse.json(await createDevelopmentMobileSession(development.data), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Mobile session creation failed", error);
    return NextResponse.json({ message: "Nazraa could not complete sign-in. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  await revokeMobileSession(request);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
