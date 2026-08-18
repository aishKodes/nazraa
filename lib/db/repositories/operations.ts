import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopeWhere } from "@/lib/db/repositories/accounts";
import type { Scope } from "@/types/platform";

function code(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

async function audit(
  connection: Parameters<Parameters<typeof withTransaction>[0]>[0],
  values: { actorId: string; actorRole: string; action: string; module: string; targetType: string; targetId?: string; previous?: object; next?: object; reason?: string },
) {
  await connection.execute(
    `INSERT INTO audit_logs (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), values.actorId, values.actorRole, values.action, values.module, values.targetType, values.targetId ?? null, values.previous ? JSON.stringify(values.previous) : null, values.next ? JSON.stringify(values.next) : null, values.reason ?? null],
  );
}

export async function transferCoins(input: { scope: Scope; recipientId: string; amount: number; reason: string; idempotencyKey: string }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter a whole coin amount greater than zero.");
  if (input.reason.trim().length < 5) throw new Error("A clear transfer reason is required.");

  return withTransaction(async (connection) => {
    const recipientScope = scopeWhere(input.scope, "agency_account_id");
    const [recipients] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>(
      `SELECT id, full_name FROM application_users WHERE id = ? AND ${recipientScope.clause} LIMIT 1`,
      [input.recipientId, ...recipientScope.values],
    );
    const recipient = recipients[0];
    if (!recipient) throw new Error("Recipient was not found in your permitted hierarchy.");

    // Ensure both wallet rows exist before locking them. The unique owner/asset index makes this idempotent.
    await connection.execute(
      `INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES
        (?, 'PLATFORM_ACCOUNT', ?, 'COIN', 0), (?, 'APPLICATION_USER', ?, 'COIN', 0)`,
      [randomUUID(), input.scope.account.id, randomUUID(), recipient.id],
    );
    const [senderRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      `SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE`,
      [input.scope.account.id],
    );
    const [recipientRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      `SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE`,
      [recipient.id],
    );
    const sender = senderRows[0];
    const receiver = recipientRows[0];
    if (!sender || !receiver) throw new Error("Wallets could not be loaded.");
    const senderBefore = Number(sender.available_balance);
    const recipientBefore = Number(receiver.available_balance);
    if (senderBefore < input.amount) throw new Error("Your available coin inventory is too low for this transfer.");
    const senderAfter = senderBefore - input.amount;
    const recipientAfter = recipientBefore + input.amount;

    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [senderAfter, sender.id]);
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [recipientAfter, receiver.id]);

    const transferCode = code("CTX");
    const debitLedgerId = randomUUID();
    const creditLedgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
       VALUES (?, ?, ?, 'COIN', 'ADMIN_TRANSFER_DEBIT', 'PLATFORM_ACCOUNT', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, ?, ?)`,
      [debitLedgerId, `${transferCode}-D`, input.idempotencyKey, input.scope.account.id, recipient.id, input.amount, input.reason.trim(), input.scope.account.id, JSON.stringify({ transferCode, balanceBefore: senderBefore, balanceAfter: senderAfter })],
    );
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
       VALUES (?, ?, 'COIN', 'ADMIN_TRANSFER_CREDIT', 'PLATFORM_ACCOUNT', ?, 'APPLICATION_USER', ?, ?, 'COMPLETED', ?, ?, ?)`,
      [creditLedgerId, `${transferCode}-C`, input.scope.account.id, recipient.id, input.amount, input.reason.trim(), input.scope.account.id, JSON.stringify({ transferCode, balanceBefore: recipientBefore, balanceAfter: recipientAfter, counterpartLedgerId: debitLedgerId })],
    );
    const transferId = randomUUID();
    await connection.execute(
      `INSERT INTO coin_transfers (id, transfer_code, sender_account_id, recipient_application_user_id, amount, sender_before, sender_after, recipient_before, recipient_after, ledger_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transferId, transferCode, input.scope.account.id, recipient.id, input.amount, senderBefore, senderAfter, recipientBefore, recipientAfter, debitLedgerId],
    );
    await connection.execute(
      `INSERT INTO mobile_notifications
        (id, application_user_id, notification_type, title, message, action_target)
       VALUES (?, ?, 'COIN_CREDIT', 'Coins credited', ?, 'wallet')`,
      [randomUUID(), recipient.id, `${input.amount.toLocaleString("en-US")} coins were added to your Nazraa wallet. Reference ${transferCode}.`],
    );
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "coin.transfer", module: "wallet", targetType: "application_user", targetId: recipient.id,
      previous: { senderBalance: senderBefore, recipientBalance: recipientBefore }, next: { senderBalance: senderAfter, recipientBalance: recipientAfter, transferCode }, reason: input.reason.trim(),
    });
    return { transferCode, recipientName: recipient.full_name, senderBefore, senderAfter, recipientBefore, recipientAfter };
  });
}

export async function adjustPlatformCoinInventory(input: { scope: Scope; accountId: string; direction: "ADD" | "REMOVE"; amount: number; reason: string; idempotencyKey: string }) {
  if (input.scope.account.role !== "MASTER") throw new Error("Only the Master can allocate platform coin inventory.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter a whole coin amount greater than zero.");
  if (input.reason.trim().length < 5) throw new Error("A clear allocation reason is required.");
  return withTransaction(async (connection) => {
    const [accounts] = await connection.query<(RowDataPacket & { id: string; role: string; full_name: string })[]>(
      "SELECT id, role, full_name FROM platform_accounts WHERE id = ? AND role IN ('MASTER','ADMIN','AGENCY','COIN_SELLER') AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [input.accountId],
    );
    const account = accounts[0];
    if (!account) throw new Error("Choose an active Master, Admin, or Coin Seller account.");
    await connection.execute(
      "INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES (?, 'PLATFORM_ACCOUNT', ?, 'COIN', 0)",
      [randomUUID(), account.id],
    );
    const [wallets] = await connection.query<(RowDataPacket & { id: string; available_balance: number })[]>(
      "SELECT id, available_balance FROM wallet_balances WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id = ? AND asset_type = 'COIN' FOR UPDATE",
      [account.id],
    );
    const wallet = wallets[0];
    if (!wallet) throw new Error("The account wallet could not be loaded.");
    const before = Number(wallet.available_balance);
    const after = input.direction === "ADD" ? before + input.amount : before - input.amount;
    if (after < 0) throw new Error("The account does not have enough inventory to remove that amount.");
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [after, wallet.id]);
    const transactionCode = code("INV");
    await connection.execute(
      `INSERT INTO ledger_transactions (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
       VALUES (?, ?, ?, 'COIN', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      [randomUUID(), transactionCode, input.idempotencyKey, input.direction === "ADD" ? "MASTER_INVENTORY_ALLOCATION" : "MASTER_INVENTORY_REMOVAL", input.direction === "ADD" ? "PLATFORM_CONTROL" : "PLATFORM_ACCOUNT", input.direction === "ADD" ? null : account.id, input.direction === "ADD" ? "PLATFORM_ACCOUNT" : "PLATFORM_CONTROL", input.direction === "ADD" ? account.id : null, input.amount, input.reason.trim(), input.scope.account.id, JSON.stringify({ balanceBefore: before, balanceAfter: after, targetRole: account.role })],
    );
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "coin.inventory_adjust", module: "wallet", targetType: "platform_account", targetId: account.id,
      previous: { coinInventory: before }, next: { coinInventory: after, direction: input.direction, transactionCode }, reason: input.reason.trim(),
    });
    return { transactionCode, accountName: account.full_name, before, after };
  });
}

const withdrawalTransitions: Record<string, string[]> = {
  PENDING: ["UNDER_REVIEW", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "CANCELLED"],
};

export async function transitionWithdrawal(input: { scope: Scope; withdrawalId: string; nextStatus: string; reason: string; providerReference?: string }) {
  if (!input.reason.trim()) throw new Error("A review reason is required.");
  if (input.nextStatus === "COMPLETED" && (input.providerReference?.trim().length ?? 0) < 3) throw new Error("A payout provider reference is required before completion.");
  return withTransaction(async (connection) => {
    const filter = scopeWhere(input.scope, "agency_account_id");
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: string; amount: number; application_user_id: string; withdrawal_code: string })[]>(
      `SELECT id, status, amount, application_user_id, withdrawal_code FROM withdrawal_requests WHERE id = ? AND ${filter.clause} FOR UPDATE`,
      [input.withdrawalId, ...filter.values],
    );
    const request = rows[0];
    if (!request) throw new Error("Withdrawal was not found in your permitted hierarchy.");
    if (!withdrawalTransitions[request.status]?.includes(input.nextStatus)) {
      throw new Error(`Cannot move a ${request.status.toLowerCase()} withdrawal to ${input.nextStatus.toLowerCase()}.`);
    }
    const terminal = ["COMPLETED", "REJECTED", "CANCELLED"].includes(input.nextStatus);
    let walletBefore: { available: number; reserved: number } | undefined;
    let walletAfter: { available: number; reserved: number } | undefined;
    if (terminal) {
      await connection.execute("INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type) VALUES (?, 'APPLICATION_USER', ?, 'DIAMOND')", [randomUUID(), request.application_user_id]);
      const [walletRows] = await connection.query<(RowDataPacket & { id: string; available_balance: number; reserved_balance: number })[]>("SELECT id, available_balance, reserved_balance FROM wallet_balances WHERE owner_type = 'APPLICATION_USER' AND owner_id = ? AND asset_type = 'DIAMOND' FOR UPDATE", [request.application_user_id]);
      const wallet = walletRows[0]; const amount = Number(request.amount);
      if (!wallet || Number(wallet.reserved_balance) < amount) throw new Error("Reserved host earnings do not cover this withdrawal. Reconcile the wallet before changing to a final status.");
      walletBefore = { available: Number(wallet.available_balance), reserved: Number(wallet.reserved_balance) };
      const release = input.nextStatus !== "COMPLETED";
      walletAfter = { available: walletBefore.available + (release ? amount : 0), reserved: walletBefore.reserved - amount };
      await connection.execute("UPDATE wallet_balances SET available_balance = ?, reserved_balance = ? WHERE id = ?", [walletAfter.available, walletAfter.reserved, wallet.id]);
      await connection.execute(
        `INSERT INTO ledger_transactions
          (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
         VALUES (?, ?, ?, 'DIAMOND', ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
        [randomUUID(), code(input.nextStatus === "COMPLETED" ? "PAY" : "REL"), `withdrawal:${request.id}:${input.nextStatus}`, input.nextStatus === "COMPLETED" ? "WITHDRAWAL_PAID" : "WITHDRAWAL_RELEASED", input.nextStatus === "COMPLETED" ? "APPLICATION_USER" : "WITHDRAWAL_RESERVE", request.application_user_id, input.nextStatus === "COMPLETED" ? "PAYOUT_PROVIDER" : "APPLICATION_USER", input.nextStatus === "COMPLETED" ? null : request.application_user_id, amount, input.reason.trim(), input.scope.account.id, JSON.stringify({ withdrawalCode: request.withdrawal_code, balanceBefore: walletBefore, balanceAfter: walletAfter })],
      );
    }
    await connection.execute(
      `UPDATE withdrawal_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3), review_reason = ?, provider_reference = COALESCE(?, provider_reference) WHERE id = ?`,
      [input.nextStatus, input.scope.account.id, input.reason.trim(), input.providerReference?.trim() || null, request.id],
    );
    await connection.execute(
      `INSERT INTO withdrawal_status_history (id, withdrawal_id, from_status, to_status, actor_account_id, reason) VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), request.id, request.status, input.nextStatus, input.scope.account.id, input.reason.trim()],
    );
    await connection.execute("INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target) VALUES (?, ?, 'WITHDRAWAL', 'Withdrawal updated', ?, 'wallet/withdrawals')", [randomUUID(), request.application_user_id, `${request.withdrawal_code} is now ${input.nextStatus.toLowerCase().replaceAll("_", " ")}.`]);
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "withdrawal.transition", module: "withdrawals", targetType: "withdrawal", targetId: request.id,
      previous: { status: request.status, wallet: walletBefore }, next: { status: input.nextStatus, wallet: walletAfter }, reason: input.reason.trim(),
    });
    return { previousStatus: request.status, nextStatus: input.nextStatus };
  });
}

export async function createTemporaryLiveRestriction(input: { scope: Scope; applicationUserId: string; reason: string }) {
  if (input.reason.trim().length < 5) throw new Error("Provide a specific moderation reason.");
  const permitted = scopeWhere(input.scope, "agency_account_id");
  const [users] = await db().query<(RowDataPacket & { id: string; full_name: string })[]>(
    `SELECT id, full_name FROM application_users WHERE id = ? AND ${permitted.clause} LIMIT 1`,
    [input.applicationUserId, ...permitted.values],
  );
  if (!users[0]) throw new Error("User was not found in your permitted scope.");
  return withTransaction(async (connection) => {
    const restrictionId = randomUUID();
    await connection.execute(
      `INSERT INTO moderation_restrictions (id, application_user_id, restriction_type, ends_at, reason, actor_account_id)
       VALUES (?, ?, 'TEMP_LIVE_BAN', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 2 HOUR), ?, ?)`,
      [restrictionId, input.applicationUserId, input.reason.trim(), input.scope.account.id],
    );
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "moderation.temp_live_ban", module: "moderation", targetType: "application_user", targetId: input.applicationUserId,
      next: { durationHours: 2 }, reason: input.reason.trim(),
    });
    return { restrictionId, userName: users[0].full_name };
  });
}

export async function listWithdrawals(scope: Scope) {
  const filter = scopeWhere(scope, "w.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; withdrawal_code: string; full_name: string; external_user_id: string; amount: number; currency: string; status: string; requested_at: string; payout_method_masked: string | null })[]>(
    `SELECT w.id, w.withdrawal_code, u.full_name, u.external_user_id, w.amount, w.currency, w.status, w.requested_at, w.payout_method_masked
     FROM withdrawal_requests w INNER JOIN application_users u ON u.id = w.application_user_id
     WHERE ${filter.clause} ORDER BY w.requested_at DESC LIMIT 100`, filter.values,
  );
  return rows.map((row) => ({ id: row.id, code: row.withdrawal_code, fullName: row.full_name, externalUserId: row.external_user_id, amount: Number(row.amount), currency: row.currency, status: row.status, requestedAt: row.requested_at, payout: row.payout_method_masked }));
}

export async function listRooms(scope: Scope) {
  const filter = scopeWhere(scope, "r.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; room_code: string; room_type: string; status: string; audience_count: number; started_at: string; full_name: string; external_user_id: string; application_user_id: string })[]>(
    `SELECT r.id, r.room_code, r.room_type, r.status, r.audience_count, r.started_at, u.full_name, u.external_user_id, u.id application_user_id
     FROM live_rooms r INNER JOIN application_users u ON u.id = r.host_application_user_id
     WHERE ${filter.clause} ORDER BY r.started_at DESC LIMIT 100`, filter.values,
  );
  return rows.map((row) => ({ id: row.id, roomCode: row.room_code, roomType: row.room_type, status: row.status, audience: Number(row.audience_count), startedAt: row.started_at, hostName: row.full_name, hostExternalId: row.external_user_id, applicationUserId: row.application_user_id }));
}

export async function listAudit(scope: Scope) {
  const filter = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.actor_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; action: string; module: string; target_type: string; reason: string | null; created_at: string; full_name: string | null; role: string | null })[]>(
    `SELECT a.id, a.action, a.module, a.target_type, a.reason, a.created_at, p.full_name, p.role
     FROM audit_logs a LEFT JOIN platform_accounts p ON p.id = a.actor_account_id
     WHERE ${filter.clause} ORDER BY a.created_at DESC LIMIT 100`, filter.values,
  );
  return rows.map((row) => ({ id: row.id, action: row.action, module: row.module, targetType: row.target_type, reason: row.reason, createdAt: row.created_at, actorName: row.full_name ?? "System", actorRole: row.role }));
}

export async function listRiskFlags(scope: Scope) {
  const filter = scopeWhere(scope, "u.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; severity: string; status: string; rule_key: string; summary: string; created_at: string; full_name: string | null; external_user_id: string | null })[]>(
    `SELECT r.id, r.severity, r.status, r.rule_key, r.summary, r.created_at, u.full_name, u.external_user_id
     FROM risk_flags r LEFT JOIN application_users u ON u.id = r.application_user_id
     WHERE ${filter.clause} ORDER BY FIELD(r.severity, 'HIGH', 'MEDIUM', 'LOW'), r.created_at DESC LIMIT 100`, filter.values,
  );
  return rows.map((row) => ({ id: row.id, severity: row.severity, status: row.status, ruleKey: row.rule_key, summary: row.summary, createdAt: row.created_at, name: row.full_name, externalUserId: row.external_user_id }));
}

export async function updateRiskFlag(input: { scope: Scope; flagId: string; status: "REVIEWING" | "RESOLVED"; reason: string }) {
  const filter = scopeWhere(input.scope, "u.agency_account_id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: string })[]>(
      `SELECT r.id, r.status FROM risk_flags r LEFT JOIN application_users u ON u.id = r.application_user_id WHERE r.id = ? AND ${filter.clause} FOR UPDATE`, [input.flagId, ...filter.values],
    );
    if (!rows[0]) throw new Error("Risk flag was not found in your scope.");
    await connection.execute("UPDATE risk_flags SET status = ?, resolved_by = IF(? = 'RESOLVED', ?, resolved_by), resolved_at = IF(? = 'RESOLVED', CURRENT_TIMESTAMP(3), resolved_at) WHERE id = ?", [input.status, input.status, input.scope.account.id, input.status, input.flagId]);
    await audit(connection, { actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "risk.status_change", module: "risk", targetType: "risk_flag", targetId: input.flagId, previous: { status: rows[0].status }, next: { status: input.status }, reason: input.reason });
  });
}

export async function updateRoomStatus(input: { scope: Scope; roomId: string; status: "ACTIVE" | "LOCKED" | "ENDED"; reason: string }) {
  const filter = scopeWhere(input.scope, "agency_account_id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: string })[]>(`SELECT id, status FROM live_rooms WHERE id = ? AND ${filter.clause} FOR UPDATE`, [input.roomId, ...filter.values]);
    if (!rows[0] || !["ACTIVE", "LOCKED"].includes(rows[0].status)) throw new Error("Only an active or locked room in your scope can be changed.");
    if (rows[0].status === input.status || (rows[0].status === "LOCKED" && input.status === "LOCKED")) throw new Error("Choose a valid new room status.");
    await connection.execute("UPDATE live_rooms SET status = ?, ended_at = IF(? = 'ENDED', CURRENT_TIMESTAMP(3), ended_at) WHERE id = ?", [input.status, input.status, input.roomId]);
    await audit(connection, { actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "room.status_change", module: "rooms", targetType: "live_room", targetId: input.roomId, previous: { status: rows[0].status }, next: { status: input.status }, reason: input.reason });
  });
}
