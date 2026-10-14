import "server-only";

import { OAuth2Client } from "google-auth-library";

export type VerifiedGoogleIdentity = {
  subject: string;
  email: string;
  name: string;
  picture?: string;
};

const client = new OAuth2Client();

function audiences() {
  return (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? process.env.GOOGLE_WEB_CLIENT_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function googleIdentityConfigured() {
  return audiences().length > 0;
}
export function googleWebIdentityClientId() {
  const configured=process.env.GOOGLE_WEB_CLIENT_ID?.trim();
  if(configured)return configured;
  // Existing public web client used by the production Android Google flow.
  // Use it only when the backend already accepts that audience.
  const current='615422217131-egglgb8ad3vuo71ule0j23v6o93klek1.apps.googleusercontent.com';
  return audiences().includes(current)?current:'';
}

export async function verifyGoogleIdentity(idToken: string, expectedNonce?: string): Promise<VerifiedGoogleIdentity> {
  const acceptedAudiences = audiences();
  if (!acceptedAudiences.length) throw new Error("Google Sign-In is not configured on the Nazraa server.");
  const ticket = await client.verifyIdToken({ idToken, audience: acceptedAudiences });
  const payload = ticket.getPayload();
  if(expectedNonce && (payload as {nonce?:string} | undefined)?.nonce!==expectedNonce) throw new Error("Sign-in expired. Please try again.");
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Use a verified Google account to continue.");
  }
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split("@")[0],
    picture: payload.picture,
  };
}
