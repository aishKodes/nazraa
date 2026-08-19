import "server-only";

import { randomUUID } from "crypto";
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

function operationCode(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

async function audit(connection: PoolConnection, input: {
  scope: Scope;
  action: string;
  module: string;
  targetType: string;
  targetId: string;
  reason: string;
  previous?: object;
  next?: object;
}) {
  await connection.execute(
    `INSERT INTO audit_logs
      (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), input.scope.account.id, input.scope.account.role, input.action, input.module,
      input.targetType, input.targetId, input.previous ? JSON.stringify(input.previous) : null,
      input.next ? JSON.stringify(input.next) : null, input.reason],
  );
}

function orderScope(scope: Scope) {
  if (scope.account.role === "COIN_SELLER" || scope.account.role === "AGENCY") {
    return { clause: "request.seller_account_id = ?", values: [scope.account.id] };
  }
  return scopeWhere(scope, "request.seller_account_id");
}

export async function listCoinCommerce(scope: Scope) {
  const filter = orderScope(scope);
  const [packageRows, sellerRows, supportRows, orderRows] = await Promise.all([
    db().query<(RowDataPacket & { id: string; public_id: number; name: string; badge_label: string | null; coin_amount: number; display_price: number | null; currency: string | null; active: number; sort_order: number })[]>(
      "SELECT id, public_id, name, badge_label, coin_amount, display_price, currency, active, sort_order FROM coin_packages ORDER BY active DESC, sort_order, coin_amount",
    ),
    db().query<(RowDataPacket & { id: string; public_id: number; full_name: string; role: string; country_code: string | null; verification_status: string | null; business_whatsapp_e164: string | null; whatsapp_public: number | null; availability_status: string | null; supported_region: string | null })[]>(
      `SELECT account.id, account.public_id, account.full_name, account.role, account.country_code,
              profile.verification_status, profile.business_whatsapp_e164, profile.whatsapp_public,
              profile.availability_status, profile.supported_region
       FROM platform_accounts account
       LEFT JOIN seller_profiles profile ON profile.account_id = account.id
       WHERE account.role IN ('AGENCY','COIN_SELLER') AND account.status = 'ACTIVE'
       ORDER BY account.role, account.full_name`,
    ),
    db().query<(RowDataPacket & { seller_account_id: string; coin_package_id: string })[]>(
      "SELECT seller_account_id, coin_package_id FROM seller_package_support WHERE active = TRUE",
    ),
    db().query<(RowDataPacket & { id: string; public_id: number; user_public_id: number; user_name: string; seller_name: string; package_name: string; coin_amount: number; status: string; review_note: string | null; created_at: string; updated_at: string })[]>(
      `SELECT request.id, request.public_id, user.public_id user_public_id, user.full_name user_name,
              seller.full_name seller_name, package.name package_name, request.coin_amount,
              request.status, request.review_note, request.created_at, request.updated_at
       FROM coin_purchase_requests request
       INNER JOIN application_users user ON user.id = request.application_user_id
       INNER JOIN platform_accounts seller ON seller.id = request.seller_account_id
       INNER JOIN coin_packages package ON package.id = request.coin_package_id
       WHERE ${filter.clause}
       ORDER BY request.created_at DESC LIMIT 150`,
      filter.values,
    ),
  ]);
  const packageSupport = new Map<string, string[]>();
  for (const row of supportRows[0]) {
    const ids = packageSupport.get(row.seller_account_id) ?? [];
    ids.push(row.coin_package_id);
    packageSupport.set(row.seller_account_id, ids);
  }
  return {
    packages: packageRows[0].map((row) => ({ id: row.id, publicId: String(row.public_id), name: row.name, badge: row.badge_label, coins: Number(row.coin_amount), price: row.display_price == null ? null : Number(row.display_price), currency: row.currency, active: Boolean(row.active), sortOrder: Number(row.sort_order) })),
    sellers: sellerRows[0].map((row) => ({ id: row.id, publicId: String(row.public_id), name: row.full_name, role: row.role, country: row.country_code, verification: row.verification_status ?? "UNVERIFIED", whatsapp: row.business_whatsapp_e164, whatsappPublic: Boolean(row.whatsapp_public), availability: row.availability_status ?? "OFFLINE", region: row.supported_region, packageIds: packageSupport.get(row.id) ?? [] })),
    orders: orderRows[0].map((row) => ({ id: row.id, publicId: String(row.public_id), userPublicId: String(row.user_public_id), userName: row.user_name, sellerName: row.seller_name, packageName: row.package_name, coins: Number(row.coin_amount), status: row.status, reviewNote: row.review_note, createdAt: row.created_at, updatedAt: row.updated_at })),
  };
}

export async function createCoinPackage(input: { scope: Scope; name: string; badge?: string; coins: number; price?: number; currency?: string; sortOrder: number }) {
  const id = randomUUID();
  await withTransaction(async (connection) => {
    await connection.execute(
      "INSERT INTO coin_packages (id, name, badge_label, coin_amount, display_price, currency, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, input.name, input.badge || null, input.coins, input.price ?? null, input.currency || null, input.sortOrder, input.scope.account.id],
    );
    await audit(connection, { scope: input.scope, action: "coin_package.create", module: "commerce", targetType: "coin_package", targetId: id, reason: "Created sellable coin package", next: { name: input.name, coins: input.coins, price: input.price, currency: input.currency } });
  });
}

export async function updateCoinPackage(input: { scope: Scope; packageId: string; name: string; badge?: string; coins: number; price?: number; currency: string; sortOrder: number; reason: string }) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>("SELECT name, badge_label, coin_amount, display_price, currency, sort_order FROM coin_packages WHERE id = ? FOR UPDATE", [input.packageId]);
    if (!rows[0]) throw new Error("Coin package was not found.");
    await connection.execute(
      "UPDATE coin_packages SET name = ?, badge_label = ?, coin_amount = ?, display_price = ?, currency = ?, sort_order = ? WHERE id = ?",
      [input.name, input.badge || null, input.coins, input.price ?? null, input.currency, input.sortOrder, input.packageId],
    );
    await audit(connection, { scope: input.scope, action: "coin_package.update", module: "commerce", targetType: "coin_package", targetId: input.packageId, reason: input.reason, previous: rows[0], next: { name: input.name, badge: input.badge, coins: input.coins, price: input.price, currency: input.currency, sortOrder: input.sortOrder } });
  });
}

export async function setCoinPackageActive(input: { scope: Scope; packageId: string; active: boolean }) {
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { active: number })[]>("SELECT active FROM coin_packages WHERE id = ? FOR UPDATE", [input.packageId]);
    if (!rows[0]) throw new Error("Coin package was not found.");
    await connection.execute("UPDATE coin_packages SET active = ? WHERE id = ?", [input.active, input.packageId]);
    await audit(connection, { scope: input.scope, action: "coin_package.status", module: "commerce", targetType: "coin_package", targetId: input.packageId, reason: input.active ? "Enabled package" : "Disabled package", previous: { active: Boolean(rows[0].active) }, next: { active: input.active } });
  });
}

export async function updateSellerProfile(input: {
  scope: Scope;
  sellerId: string;
  verification: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  whatsapp?: string;
  whatsappPublic: boolean;
  availability: "AVAILABLE" | "OFFLINE";
  region?: string;
  packageIds: string[];
  reason: string;
}) {
  const sellerScope = scopeWhere(input.scope, "id");
  if (input.whatsapp && !/^\+[1-9]\d{7,14}$/.test(input.whatsapp)) throw new Error("WhatsApp must use E.164 format, for example +919876543210.");
  if (input.whatsappPublic && !input.whatsapp) throw new Error("Add an approved business WhatsApp number before publishing it.");
  await withTransaction(async (connection) => {
    const [accounts] = await connection.query<(RowDataPacket & { id: string; role: string })[]>(
      `SELECT id, role FROM platform_accounts WHERE id = ? AND role IN ('AGENCY','COIN_SELLER') AND status = 'ACTIVE' AND ${sellerScope.clause} FOR UPDATE`,
      [input.sellerId, ...sellerScope.values],
    );
    if (!accounts[0]) throw new Error("Seller was not found in your permitted hierarchy.");
    if (input.packageIds.length) {
      const placeholders = input.packageIds.map(() => "?").join(",");
      const [packages] = await connection.query<RowDataPacket[]>(`SELECT id FROM coin_packages WHERE id IN (${placeholders}) AND active = TRUE`, input.packageIds);
      if (packages.length !== new Set(input.packageIds).size) throw new Error("One or more selected packages are invalid or disabled.");
    }
    await connection.execute(
      `INSERT INTO seller_profiles
        (account_id, verification_status, available_for_sales, business_whatsapp_e164, whatsapp_public, availability_status, supported_region)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE verification_status = VALUES(verification_status),
         available_for_sales = VALUES(available_for_sales), business_whatsapp_e164 = VALUES(business_whatsapp_e164),
         whatsapp_public = VALUES(whatsapp_public), availability_status = VALUES(availability_status), supported_region = VALUES(supported_region)`,
      [input.sellerId, input.verification, input.verification === "VERIFIED" && input.availability === "AVAILABLE", input.whatsapp || null, input.whatsappPublic, input.availability, input.region || null],
    );
    await connection.execute("DELETE FROM seller_package_support WHERE seller_account_id = ?", [input.sellerId]);
    for (const packageId of new Set(input.packageIds)) {
      await connection.execute("INSERT INTO seller_package_support (seller_account_id, coin_package_id, active) VALUES (?, ?, TRUE)", [input.sellerId, packageId]);
    }
    await audit(connection, { scope: input.scope, action: "seller.configure", module: "commerce", targetType: "platform_account", targetId: input.sellerId, reason: input.reason, next: { verification: input.verification, whatsappPublic: input.whatsappPublic, availability: input.availability, packageIds: input.packageIds } });
  });
}

const orderTransitions: Record<string, string[]> = {
  PENDING_CONTACT: ["PAYMENT_PENDING", "SELLER_REVIEWING", "REJECTED", "CANCELLED"],
  PAYMENT_PENDING: ["SELLER_REVIEWING", "REJECTED", "CANCELLED"],
  SELLER_REVIEWING: ["COMPLETED", "REJECTED", "CANCELLED"],
};

export async function transitionCoinOrder(input: { scope: Scope; orderId: string; nextStatus: string; note: string }) {
  const filter = orderScope(input.scope);
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; public_id: number; status: string; application_user_id: string; seller_account_id: string; coin_amount: number })[]>(
      `SELECT request.id, request.public_id, request.status, request.application_user_id, request.seller_account_id, request.coin_amount
       FROM coin_purchase_requests request WHERE request.id = ? AND ${filter.clause} FOR UPDATE`,
      [input.orderId, ...filter.values],
    );
    const order = rows[0];
    if (!order) throw new Error("Coin order was not found in your permitted scope.");
    if (!orderTransitions[order.status]?.includes(input.nextStatus)) throw new Error(`Cannot move this ${order.status.toLowerCase().replaceAll("_", " ")} order to ${input.nextStatus.toLowerCase().replaceAll("_", " ")}.`);
    let ledgerId: string | null = null;
    if (input.nextStatus === "COMPLETED") {
      await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'PLATFORM_ACCOUNT', ?, 'COIN'), (?, 'APPLICATION_USER', ?, 'COIN')", [randomUUID(), order.seller_account_id, randomUUID(), order.application_user_id]);
      const [sellerWallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE", [order.seller_account_id]);
      const [userWallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>("SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE", [order.application_user_id]);
      const sellerWallet = sellerWallets[0]; const userWallet = userWallets[0];
      if (!sellerWallet || !userWallet) throw new Error("The seller or user wallet could not be loaded.");
      if (Number(sellerWallet.available_balance) < Number(order.coin_amount)) throw new Error("Seller coin inventory is too low to fulfill this order.");
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance - ? WHERE id = ?", [order.coin_amount, sellerWallet.id]);
      await connection.execute("UPDATE wallet_balances SET available_balance = available_balance + ? WHERE id = ?", [order.coin_amount, userWallet.id]);
      ledgerId = randomUUID();
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
         VALUES (?, ?, ?, 'COIN', 'COIN_PURCHASE_FULFILLED', 'PLATFORM_ACCOUNT', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, ?, ?)`,
        [ledgerId, operationCode("BUY"), `coin-order:${order.id}`, order.seller_account_id, order.application_user_id, order.coin_amount, input.note, input.scope.account.id, JSON.stringify({ orderPublicId: String(order.public_id) })],
      );
    }
    await connection.execute(
      "UPDATE coin_purchase_requests SET status = ?, review_note = ?, completed_ledger_transaction_id = ?, completed_by = ? WHERE id = ?",
      [input.nextStatus, input.note, ledgerId, input.nextStatus === "COMPLETED" ? input.scope.account.id : null, order.id],
    );
    await connection.execute(
      "INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'COIN_ORDER', ?, ?, 'wallet/orders')",
      [randomUUID(), order.application_user_id, input.nextStatus === "COMPLETED" ? "Coins added" : "Coin order updated", `Order ${order.public_id} is now ${input.nextStatus.toLowerCase().replaceAll("_", " ")}.`],
    );
    await audit(connection, { scope: input.scope, action: "coin_order.transition", module: "commerce", targetType: "coin_purchase_request", targetId: order.id, reason: input.note, previous: { status: order.status }, next: { status: input.nextStatus, ledgerId } });
    return String(order.public_id);
  });
}

export async function listFaceVerificationRequests(scope: Scope) {
  const filter = scopeWhere(scope, "user.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; public_id: number; user_public_id: number; full_name: string; country_code: string | null; status: string; selfie_document_id: string | null; provider: string | null; liveness_score: number | null; match_score: number | null; agency_face_live_authorized: number; super_admin_face_live_authorized: number; review_reason: string | null; created_at: string; reviewed_at: string | null })[]>(
    `SELECT request.id, request.public_id, user.public_id user_public_id, user.full_name, user.country_code,
            request.status, request.selfie_document_id, request.provider, request.liveness_score, request.match_score,
            user.agency_face_live_authorized, user.super_admin_face_live_authorized,
            request.review_reason, request.created_at, request.reviewed_at
     FROM face_verification_requests request
     INNER JOIN application_users user ON user.id = request.application_user_id
     WHERE ${filter.clause} ORDER BY FIELD(request.status, 'PROCESSING','RETRY','DUPLICATE','PENDING','REJECTED','VERIFIED'), request.created_at DESC LIMIT 150`,
    filter.values,
  );
  return rows.map((row) => ({ id: row.id, publicId: String(row.public_id), userPublicId: String(row.user_public_id), fullName: row.full_name, country: row.country_code, status: row.status, documentId: row.selfie_document_id, provider: row.provider, livenessScore: row.liveness_score == null ? null : Number(row.liveness_score), matchScore: row.match_score == null ? null : Number(row.match_score), agencyAuthorized: Boolean(row.agency_face_live_authorized), superAdminAuthorized: Boolean(row.super_admin_face_live_authorized), reviewReason: row.review_reason, createdAt: row.created_at, reviewedAt: row.reviewed_at }));
}

export async function listPayoutMethodReviews(scope: Scope) {
  const filter = scopeWhere(scope, "user.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; user_public_id: number; full_name: string; method_type: string; display_name: string; masked_destination: string; verified: number; active: number; created_at: string })[]>(
    `SELECT method.id, user.public_id user_public_id, user.full_name, method.method_type,
            method.display_name, method.masked_destination, method.verified, method.active, method.created_at
     FROM payout_methods method INNER JOIN application_users user ON user.id = method.application_user_id
     WHERE ${filter.clause} ORDER BY method.verified ASC, method.created_at DESC LIMIT 150`,
    filter.values,
  );
  return rows.map((row) => ({ id: row.id, userPublicId: String(row.user_public_id), fullName: row.full_name, type: row.method_type, displayName: row.display_name, maskedDestination: row.masked_destination, verified: Boolean(row.verified), active: Boolean(row.active), createdAt: row.created_at }));
}

export async function reviewPayoutMethod(input: { scope: Scope; methodId: string; decision: "VERIFIED" | "REJECTED"; reason: string }) {
  const filter = scopeWhere(input.scope, "user.agency_account_id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; verified: number; active: number })[]>(
      `SELECT method.id, method.application_user_id, method.verified, method.active
       FROM payout_methods method INNER JOIN application_users user ON user.id = method.application_user_id
       WHERE method.id = ? AND ${filter.clause} FOR UPDATE`,
      [input.methodId, ...filter.values],
    );
    const method = rows[0];
    if (!method) throw new Error("Payout method was not found in your permitted scope.");
    await connection.execute("UPDATE payout_methods SET verified = ?, active = ? WHERE id = ?", [input.decision === "VERIFIED", input.decision === "VERIFIED", method.id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'PAYOUT_METHOD', ?, ?, 'wallet/withdrawals')", [randomUUID(), method.application_user_id, input.decision === "VERIFIED" ? "Payout method verified" : "Payout method rejected", input.reason]);
    await audit(connection, { scope: input.scope, action: "payout_method.review", module: "withdrawals", targetType: "payout_method", targetId: method.id, reason: input.reason, previous: { verified: Boolean(method.verified), active: Boolean(method.active) }, next: { verified: input.decision === "VERIFIED", active: input.decision === "VERIFIED" } });
  });
}

export async function reviewFaceVerification(input: { scope: Scope; requestId: string; decision: "VERIFIED" | "REJECTED"; reason: string }) {
  const filter = scopeWhere(input.scope, "user.agency_account_id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; application_user_id: string; selfie_document_id: string; status: string })[]>(
      `SELECT request.id, request.application_user_id, request.selfie_document_id, request.status
       FROM face_verification_requests request INNER JOIN application_users user ON user.id = request.application_user_id
       WHERE request.id = ? AND ${filter.clause} FOR UPDATE`,
      [input.requestId, ...filter.values],
    );
    const request = rows[0];
    if (!request) throw new Error("Face verification request was not found in your permitted scope.");
    if (request.status !== "PENDING") throw new Error("Only a pending face verification can be reviewed.");
    await connection.execute("UPDATE face_verification_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ? WHERE id = ?", [input.decision, input.scope.account.id, input.reason, request.id]);
    await connection.execute("UPDATE application_users SET face_verification_status = ? WHERE id = ?", [input.decision, request.application_user_id]);
    await connection.execute("UPDATE private_documents SET verification_status = ? WHERE id = ?", [input.decision, request.selfie_document_id]);
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'FACE_VERIFICATION', ?, ?, 'face')", [randomUUID(), request.application_user_id, input.decision === "VERIFIED" ? "Face verification approved" : "Face verification needs attention", input.decision === "VERIFIED" ? "Your Face Live verification is active." : input.reason]);
    await audit(connection, { scope: input.scope, action: "face_verification.review", module: "face_verification", targetType: "face_verification_request", targetId: request.id, reason: input.reason, previous: { status: request.status }, next: { status: input.decision } });
  });
}

export async function saveCommerceSettings(input: { scope: Scope; minimumWithdrawal: number; whatsappMessageTemplate: string; supportUrl?: string; withdrawalPortalUrl?: string }) {
  const value = { coinPurchaseMethod: "AGENCY_WHATSAPP", whatsappMessageTemplate: input.whatsappMessageTemplate, minimumWithdrawal: input.minimumWithdrawal, supportUrl: input.supportUrl || "", withdrawalPortalUrl: input.withdrawalPortalUrl || "" };
  await withTransaction(async (connection) => {
    await connection.execute(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES ('mobile.commerce', ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify(value), input.scope.account.id],
    );
    await audit(connection, { scope: input.scope, action: "settings.mobile_commerce", module: "settings", targetType: "system_setting", targetId: input.scope.account.id, reason: "Updated mobile commerce settings", next: value });
  });
}
