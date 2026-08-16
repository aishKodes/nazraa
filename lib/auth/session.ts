import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { SessionAccount } from "@/types/platform";

const cookieName = "nazraa_control_session";
const encoder = new TextEncoder();

function sessionKey() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return encoder.encode(value);
}

export async function createSession(account: SessionAccount) {
  const token = await new SignJWT({ ...account })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(sessionKey());
  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function getSession(): Promise<SessionAccount | null> {
  try {
    const token = (await cookies()).get(cookieName)?.value;
    if (!token) return null;
    const verified = await jwtVerify(token, sessionKey());
    const { id, role, roleCode, fullName } = verified.payload;
    if (typeof id !== "string" || typeof role !== "string" || typeof roleCode !== "string" || typeof fullName !== "string") return null;
    return { id, role: role as SessionAccount["role"], roleCode, fullName };
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(cookieName);
}
