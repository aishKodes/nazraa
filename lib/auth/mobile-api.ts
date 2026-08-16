import "server-only";
import { timingSafeEqual } from "crypto";

export function mobileApiAuthorized(request: Request) {
  const expected = process.env.MOBILE_API_KEY;
  if (!expected) return false;
  const supplied = request.headers.get("x-mobile-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
