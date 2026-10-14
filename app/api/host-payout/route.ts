import { NextResponse } from "next/server";
import { googleWebIdentityClientId } from "@/lib/auth/google-identity";
import { z } from "zod";
import {
  assertPortalCsrf,
  hostPayoutIdentity,
  loginHostPayout,
  logoutHostPayout,
  portalChallenge,
} from "@/lib/auth/host-payout-session";
import {
  hostPayoutPage,
  PayoutError,
  requestHostPayout,
  saveHostPayoutAccount,
} from "@/lib/db/repositories/host-payouts";
const reply = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function GET() {
  try {
    const challenge = await portalChallenge(),
      userId = await hostPayoutIdentity();
    return reply({
      challenge,
      googleClientId: googleWebIdentityClientId(),
      data: userId ? await hostPayoutPage(userId) : null,
    });
  } catch (e) {
    return reply(
      {
        message:
          e instanceof PayoutError
            ? e.message
            : "Host payouts are temporarily unavailable. Please retry.",
      },
      400,
    );
  }
}
export async function POST(request: Request) {
  try {
    await assertPortalCsrf(request);
    const body = await request.json();
    if (body.action === "login") {
      const parsed = z
        .object({ credential: z.string().min(100).max(10000) })
        .parse(body);
      const userId = await loginHostPayout(parsed.credential);
      return reply({ data: await hostPayoutPage(userId) });
    }
    if (body.action === "logout") {
      await logoutHostPayout();
      return reply({ ok: true });
    }
    const userId = await hostPayoutIdentity();
    if (!userId)
      return reply({ message: "Sign in to your Nazraa Host account." }, 401);
    if (body.action === "account") {
      const parsed = z
        .object({
          type: z.enum(["BANK", "UPI"]),
          displayName: z.string().min(2).max(120),
          destination: z.string().min(4).max(190),
        })
        .parse(body);
      return reply(await saveHostPayoutAccount(userId, parsed));
    }
    if (body.action === "request") {
      const parsed = z
        .object({
          amount: z.number().int().positive().safe(),
          payoutMethodId: z.string().uuid(),
          idempotencyKey: z.string().min(16).max(100),
        })
        .parse(body);
      return reply(await requestHostPayout(userId, parsed));
    }
    return reply({ message: "Choose a valid payout action." }, 400);
  } catch (e) {
    return reply(
      {
        message:
          e instanceof PayoutError
            ? e.message
            : e instanceof z.ZodError
              ? "Please check the entered payout details."
              : "This action could not be completed. Please retry.",
      },
      400,
    );
  }
}
