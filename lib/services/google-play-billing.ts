import "server-only";

import { GoogleAuth } from "google-auth-library";

const androidPublisherScope = "https://www.googleapis.com/auth/androidpublisher";
const packageName = "com.nazraa.live";

type ProductPurchase = {
  orderId?: string;
  purchaseTimeMillis?: string;
  purchaseState?: number;
  consumptionState?: number;
  acknowledgementState?: number;
  purchaseType?: number;
  obfuscatedExternalAccountId?: string;
  regionCode?: string;
};

function credentials() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw Object.assign(
      new Error("Coin purchases are still being configured. Please try again later."),
      { code: "PLAY_BILLING_NOT_CONFIGURED" },
    );
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw Object.assign(
      new Error("Coin purchases are still being configured. Please try again later."),
      { code: "PLAY_BILLING_NOT_CONFIGURED" },
    );
  }
}

async function client() {
  const auth = new GoogleAuth({ credentials: credentials(), scopes: [androidPublisherScope] });
  return auth.getClient();
}

export async function verifyGooglePlayProductPurchase(productId: string, purchaseToken: string) {
  try {
    const authClient = await client();
    const response = await authClient.request<ProductPurchase>({
      method: "GET",
      url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`,
    });
    const purchase = response.data;
    if (purchase.purchaseState !== 0) {
      throw Object.assign(new Error("This Google Play purchase is not complete."), { code: "PLAY_PURCHASE_NOT_COMPLETE" });
    }
    return purchase;
  } catch (error) {
    if (error instanceof Error && ["PLAY_BILLING_NOT_CONFIGURED", "PLAY_PURCHASE_NOT_COMPLETE"].includes(String((error as Error & { code?: string }).code))) {
      throw error;
    }
    console.error("Google Play purchase verification failed", error);
    throw Object.assign(
      new Error("We couldn't confirm this Google Play purchase yet. Please try again."),
      { code: "PLAY_PURCHASE_VERIFICATION_FAILED" },
    );
  }
}

export async function consumeGooglePlayProductPurchase(productId: string, purchaseToken: string) {
  const authClient = await client();
  await authClient.request({
    method: "POST",
    url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`,
  });
}
