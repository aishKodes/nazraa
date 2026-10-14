import "server-only";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { verifyGoogleIdentity } from "./google-identity";
import {
  PayoutError,
  assertHostPayoutEligibility,
} from "@/lib/db/repositories/host-payouts";
const sessionCookie = "nazraa_host_payout_session",
  csrfCookie = "nazraa_host_payout_csrf",
  nonceCookie = "nazraa_host_payout_nonce";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
function key() {
  const v = process.env.SESSION_SECRET;
  if (!v || v.length < 32)
    throw new Error("Host portal authentication is unavailable.");
  return new TextEncoder().encode(v);
}
export function assertPortalOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Use configured application origin, never trust forwarded Host headers.
  const allowed =
    process.env.NODE_ENV === "production"
      ? [
          "https://nazralive.in",
          "https://www.nazralive.in",
          "https://api.nazraa.pixtra.site",
        ]
      : ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (!origin || !allowed.includes(origin))
    throw new PayoutError("This request is not permitted.");
}
export async function portalChallenge() {
  const c = await cookies(),
    csrf = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url");
  c.set(csrfCookie, csrf, { ...cookieOptions, maxAge: 8 * 3600 });
  c.set(nonceCookie, nonce, { ...cookieOptions, maxAge: 600 });
  return { csrf, nonce };
}
export async function assertPortalCsrf(request: Request) {
  assertPortalOrigin(request);
  const expected = (await cookies()).get(csrfCookie)?.value;
  if (!expected || request.headers.get("x-nazraa-csrf") !== expected)
    throw new PayoutError("This page has expired. Refresh and try again.");
}
export async function loginHostPayout(idToken: string) {
  const c = await cookies(),
    nonce = c.get(nonceCookie)?.value;
  if (!nonce) throw new PayoutError("Sign-in expired. Refresh and try again.");
  const google = await verifyGoogleIdentity(idToken, nonce);
  const [users] = await db().query<RowDataPacket[]>(
    `SELECT id FROM application_users WHERE google_subject=? AND account_status='ACTIVE'`,
    [google.subject],
  );
  if (!users[0])
    throw new PayoutError(
      "Sign in with the Google account used in your existing Nazraa account.",
    );
  const userId = String(users[0].id);
  await assertHostPayoutEligibility(userId);
  const token = await new SignJWT({ purpose: "HOST_PAYOUT" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setAudience("nazraa-host-payout")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key());
  c.set(sessionCookie, token, { ...cookieOptions, maxAge: 8 * 3600 });
  c.delete(nonceCookie);
  return userId;
}
export async function hostPayoutIdentity() {
  try {
    const token = (await cookies()).get(sessionCookie)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, key(), {
      audience: "nazraa-host-payout",
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "HOST_PAYOUT" || !payload.sub) return null;
    const [rows] = await db().query<RowDataPacket[]>(
      "SELECT id FROM application_users WHERE id=? AND account_status='ACTIVE'",
      [payload.sub],
    );
    return rows[0] ? String(rows[0].id) : null;
  } catch {
    return null;
  }
}
export async function logoutHostPayout() {
  const c = await cookies();
  c.delete(sessionCookie);
  c.delete(csrfCookie);
  c.delete(nonceCookie);
}
