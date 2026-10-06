import "server-only";

import { MobileAccessDeniedError } from "@/lib/auth/mobile-session";

export function faceLiveSuspensionError(
  expiresAtValue: Date | string,
  remainingSecondsValue: number,
) {
  const expiresAt = new Date(expiresAtValue).toISOString();
  const remainingSeconds = Math.max(1, Math.ceil(remainingSecondsValue));
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.max(1, Math.ceil((remainingSeconds % 3600) / 60));
  const remaining = hours > 0
    ? `${hours}h ${minutes}m`
    : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const eligibleAt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(expiresAt));
  return new MobileAccessDeniedError(
    "FACE_LIVE_TEMPORARILY_SUSPENDED",
    `Face Live temporarily unavailable. You can start again in ${remaining} (at ${eligibleAt} IST).`,
    { expiresAt, remainingSeconds },
  );
}
