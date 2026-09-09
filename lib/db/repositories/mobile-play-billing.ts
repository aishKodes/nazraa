import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { consumeGooglePlayProductPurchase, verifyGooglePlayProductPurchase } from "@/lib/services/google-play-billing";

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function transactionCode() {
  return `GPL-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function verifyGooglePlayCoinPurchase(identity: MobileIdentity, input: {
  productId: string;
  purchaseToken: string;
}) {
  const [packageRows] = await db().query<(RowDataPacket & { id: string; coin_amount: number })[]>(
    "SELECT id, coin_amount FROM coin_packages WHERE play_product_id = ? AND active = TRUE LIMIT 1",
    [input.productId],
  );
  if (!packageRows[0]) throw new Error("This Coin package is not available.");
  const provider = await verifyGooglePlayProductPurchase(input.productId, input.purchaseToken);
  const hashedToken = tokenHash(input.purchaseToken);
  const delivery = await withTransaction(async (connection) => {
    const [packages] = await connection.query<(RowDataPacket & { id: string; coin_amount: number })[]>(
      "SELECT id, coin_amount FROM coin_packages WHERE play_product_id = ? AND active = TRUE LIMIT 1 FOR UPDATE",
      [input.productId],
    );
    const coinPackage = packages[0];
    if (!coinPackage) throw new Error("This Coin package is not available.");
    await connection.execute(
      `INSERT IGNORE INTO google_play_coin_purchases
        (id, application_user_id, coin_package_id, product_id, purchase_token_hash, order_id,
         purchase_time_ms, purchase_state, acknowledgement_state, consumption_state, status,
         coin_amount, provider_payload, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?, CURRENT_TIMESTAMP(3))`,
      [randomUUID(), identity.userId, coinPackage.id, input.productId, hashedToken,
        provider.orderId ?? null, provider.purchaseTimeMillis == null ? null : Number(provider.purchaseTimeMillis),
        provider.purchaseState ?? null, provider.acknowledgementState ?? null,
        provider.consumptionState ?? null, Number(coinPackage.coin_amount), JSON.stringify(provider)],
    );
    const [purchases] = await connection.query<(RowDataPacket & {
      id: string; application_user_id: string; product_id: string; coin_amount: number;
      status: string; ledger_transaction_id: string | null;
    })[]>(
      "SELECT id, application_user_id, product_id, coin_amount, status, ledger_transaction_id FROM google_play_coin_purchases WHERE purchase_token_hash = ? LIMIT 1 FOR UPDATE",
      [hashedToken],
    );
    const purchase = purchases[0];
    if (!purchase || purchase.application_user_id !== identity.userId || purchase.product_id !== input.productId) {
      throw new Error("This Google Play purchase is already linked to another account.");
    }
    if (purchase.ledger_transaction_id) {
      return { purchaseId: purchase.id, coins: Number(purchase.coin_amount), alreadyDelivered: true };
    }
    await connection.execute(
      "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'COIN')",
      [randomUUID(), identity.userId],
    );
    const [wallets] = await connection.query<(RowDataPacket & { id: string })[]>(
      "SELECT id FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' LIMIT 1 FOR UPDATE",
      [identity.userId],
    );
    if (!wallets[0]) throw new Error("Your Coin wallet is temporarily unavailable.");
    const ledgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type,
         source_type, source_id, destination_type, destination_id, amount, status, reason, metadata)
       VALUES (?, ?, ?, 'COIN', 'GOOGLE_PLAY_COIN_PURCHASE', 'GOOGLE_PLAY', NULL,
               'APPLICATION_USER', ?, ?, 'COMPLETED', 'Google Play Coin purchase', ?)`,
      [ledgerId, transactionCode(), `google-play:${hashedToken}`, identity.userId,
        Number(coinPackage.coin_amount), JSON.stringify({ productId: input.productId, orderId: provider.orderId ?? null })],
    );
    await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [Number(coinPackage.coin_amount), wallets[0].id]);
    await connection.execute(
      "UPDATE google_play_coin_purchases SET status = 'DELIVERED_PENDING_CONSUME', ledger_transaction_id = ?, delivered_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [ledgerId, purchase.id],
    );
    return { purchaseId: purchase.id, coins: Number(coinPackage.coin_amount), alreadyDelivered: false };
  });

  try {
    await consumeGooglePlayProductPurchase(input.productId, input.purchaseToken);
    await db().execute(
      "UPDATE google_play_coin_purchases SET status = 'CONSUMED', consumed_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [delivery.purchaseId],
    );
  } catch (error) {
    // Delivery is already durable and idempotent. Keep a reconciliable state;
    // a retry can safely consume without granting Coins twice.
    console.error("Google Play purchase consumption pending", error);
  }
  return { verified: true, delivered: true, coins: delivery.coins, alreadyDelivered: delivery.alreadyDelivered };
}
