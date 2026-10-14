/** Bounded web requests for the payout pages; never expose transport/JSON errors. */
export class PayoutUiError extends Error {}
export function payoutUiMessage(error: unknown, fallback: string) {
  return error instanceof PayoutUiError ? error.message : fallback;
}
export async function payoutJsonRequest<T = unknown>(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<T> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const value = await response.json();
    if (!response.ok) {
      const message = value && typeof value.message === "string" ? value.message : "";
      const safe = message.length > 0 && message.length <= 280 &&
        !/sqlstate|mysql|exception|stack trace|https?:\/\/|\bjson\b|\btoken\b|HTTP\s*\d{3}/i.test(message);
      throw new PayoutUiError(safe ? message : fallback);
    }
    if (!value || typeof value !== "object") throw new PayoutUiError(fallback);
    return value as T;
  } catch (error) {
    if (error instanceof PayoutUiError) throw error;
    throw new PayoutUiError(fallback);
  }
}
