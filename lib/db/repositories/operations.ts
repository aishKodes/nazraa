import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { monitoringScopeWhere, scopeWhere } from "@/lib/db/repositories/accounts";
import type { PageRequest, PageResult, Scope } from "@/types/platform";
import { can } from "@/lib/auth/permissions";
import { finalizeWithdrawalDistribution } from "@/lib/db/repositories/withdrawal-economy";

function code(prefix: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function pageInput(input: PageRequest = {}) {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(50, Math.max(10, Math.trunc(input.pageSize ?? 25)));
  return { page, pageSize, offset: (page - 1) * pageSize };
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
  if (!can(input.scope.account.role, "coins.transfer")) throw new Error("Your role cannot transfer coins.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter a whole coin amount greater than zero.");
  if (input.reason.trim().length < 5) throw new Error("A clear transfer reason is required.");

  return withTransaction(async (connection) => {
    const [recipients] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>(
      `SELECT id, full_name FROM application_users
       WHERE id = ? AND account_status = 'ACTIVE' LIMIT 1`,
      [input.recipientId],
    );
    const recipient = recipients[0];
    if (!recipient) throw new Error("An active user matching this recipient was not found.");

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
  if (input.scope.account.role !== "MASTER") throw new Error("Only the Master can generate platform coin inventory.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter a whole coin amount greater than zero.");
  if (input.reason.trim().length < 5) throw new Error("A clear allocation reason is required.");
  return withTransaction(async (connection) => {
    const [accounts] = await connection.query<(RowDataPacket & { id: string; role: string; full_name: string })[]>(
      "SELECT id, role, full_name FROM platform_accounts WHERE id = ? AND id = ? AND role = 'MASTER' AND status = 'ACTIVE' LIMIT 1 FOR UPDATE",
      [input.accountId, input.scope.account.id],
    );
    const account = accounts[0];
    if (!account) throw new Error("Platform inventory can only be generated in the signed-in Master wallet.");
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

export async function allocatePlatformCoins(input: { scope: Scope; accountId: string; amount: number; reason: string; idempotencyKey: string }) {
  if (!can(input.scope.account.role, "coins.allocate")) throw new Error("Your role cannot allocate coins.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error("Enter a whole coin amount greater than zero.");
  if (input.reason.trim().length < 5) throw new Error("A clear allocation reason is required.");
  if (input.accountId === input.scope.account.id) throw new Error("Choose a downstream account.");
  const scoped = scopeWhere(input.scope, "id");
  return withTransaction(async (connection) => {
    const [targets] = await connection.query<(RowDataPacket & { id: string; role: string; full_name: string })[]>(
      `SELECT id, role, full_name FROM platform_accounts
       WHERE id = ? AND status = 'ACTIVE' AND removed_at IS NULL AND ${scoped.clause} LIMIT 1`,
      [input.accountId, ...scoped.values],
    );
    const target = targets[0];
    if (!target || target.role === "MASTER") throw new Error("Choose an active downstream account in your branch.");
    await connection.execute(
      `INSERT IGNORE INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance) VALUES
        (?, 'PLATFORM_ACCOUNT', ?, 'COIN', 0), (?, 'PLATFORM_ACCOUNT', ?, 'COIN', 0)`,
      [randomUUID(), input.scope.account.id, randomUUID(), target.id],
    );
    const [wallets] = await connection.query<(RowDataPacket & { id: string; owner_id: string; available_balance: number })[]>(
      `SELECT id, owner_id, available_balance FROM wallet_balances
       WHERE owner_type = 'PLATFORM_ACCOUNT' AND owner_id IN (?, ?) AND asset_type = 'COIN'
       ORDER BY owner_id FOR UPDATE`,
      [input.scope.account.id, target.id],
    );
    const sender = wallets.find((wallet) => wallet.owner_id === input.scope.account.id);
    const receiver = wallets.find((wallet) => wallet.owner_id === target.id);
    if (!sender || !receiver) throw new Error("Account wallets could not be loaded.");
    const senderBefore = Number(sender.available_balance);
    const receiverBefore = Number(receiver.available_balance);
    if (senderBefore < input.amount) throw new Error("Your available coin inventory is too low.");
    const senderAfter = senderBefore - input.amount;
    const receiverAfter = receiverBefore + input.amount;
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [senderAfter, sender.id]);
    await connection.execute("UPDATE wallet_balances SET available_balance = ? WHERE id = ?", [receiverAfter, receiver.id]);
    const transactionCode = code("ALLOC");
    await connection.execute(
      `INSERT INTO ledger_transactions
        (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id,
         destination_type, destination_id, amount, status, reason, actor_account_id, metadata)
       VALUES (?, ?, ?, 'COIN', 'ACCOUNT_ALLOCATION', 'PLATFORM_ACCOUNT', ?, 'PLATFORM_ACCOUNT', ?, ?, 'COMPLETED', ?, ?, ?)`,
      [randomUUID(), transactionCode, input.idempotencyKey, input.scope.account.id, target.id, input.amount,
        input.reason.trim(), input.scope.account.id, JSON.stringify({ senderBefore, senderAfter, receiverBefore, receiverAfter, targetRole: target.role })],
    );
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "coin.account_allocation",
      module: "wallet", targetType: "platform_account", targetId: target.id,
      previous: { senderBalance: senderBefore, recipientBalance: receiverBefore },
      next: { senderBalance: senderAfter, recipientBalance: receiverAfter, transactionCode }, reason: input.reason.trim(),
    });
    return { transactionCode, accountName: target.full_name, senderAfter, receiverAfter };
  });
}

const withdrawalTransitions: Record<string, string[]> = {
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "CANCELLED"],
};

export async function transitionWithdrawal(input: { scope: Scope; withdrawalId: string; nextStatus: string; reason: string; providerReference?: string }) {
  if (!can(input.scope.account.role, "withdrawals.review")) throw new Error("Your role cannot review withdrawals.");
  if (!input.reason.trim()) throw new Error("A review reason is required.");
  if (input.nextStatus === "COMPLETED" && (input.providerReference?.trim().length ?? 0) < 3) throw new Error("A payout provider reference is required before completion.");
  return withTransaction(async (connection) => {
    const filter = scopeWhere(input.scope, "agency_account_id");
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: string; amount: number; application_user_id: string; agency_account_id: string | null; withdrawal_code: string; payout_method_id: string | null })[]>(
      `SELECT id, status, amount, application_user_id, agency_account_id, withdrawal_code, payout_method_id FROM withdrawal_requests WHERE id = ? AND ${filter.clause} FOR UPDATE`,
      [input.withdrawalId, ...filter.values],
    );
    const request = rows[0];
    if (!request) throw new Error("Withdrawal was not found in your permitted hierarchy.");
    if (!withdrawalTransitions[request.status]?.includes(input.nextStatus)) {
      throw new Error(`Cannot move a ${request.status.toLowerCase()} withdrawal to ${input.nextStatus.toLowerCase()}.`);
    }
    if (input.nextStatus === "APPROVED" && request.payout_method_id) {
      await connection.execute(
        "UPDATE payout_methods SET verified = TRUE, active = TRUE WHERE id = ? AND application_user_id = ?",
        [request.payout_method_id, request.application_user_id],
      );
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
      if (input.nextStatus === "COMPLETED") {
        await finalizeWithdrawalDistribution(connection, {
          withdrawalId: request.id,
          amount,
          applicationUserId: request.application_user_id,
          agencyAccountId: request.agency_account_id,
          actorAccountId: input.scope.account.id,
          providerReference: input.providerReference!.trim(),
        });
      }
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

export async function createTemporaryLiveRestriction(input: { scope: Scope; applicationUserId: string; reason: string; durationMinutes: 30 | 60 | 120 }) {
  if (!can(input.scope.account.role, "rooms.restrict")) throw new Error("Your role cannot restrict Live access.");
  if (input.reason.trim().length < 5) throw new Error("Provide a specific moderation reason.");
  if (![30, 60, 120].includes(input.durationMinutes)) throw new Error("Choose a 30 minute, 1 hour, or 2 hour restriction.");
  const permitted = monitoringScopeWhere(input.scope, "agency_account_id");
  return withTransaction(async (connection) => {
    const [users] = await connection.query<(RowDataPacket & { id: string; full_name: string })[]>(
      `SELECT id, full_name FROM application_users WHERE id = ? AND ${permitted.clause} LIMIT 1 FOR UPDATE`,
      [input.applicationUserId, ...permitted.values],
    );
    if (!users[0]) throw new Error("User was not found in your permitted scope.");
    await connection.execute(
      `UPDATE moderation_restrictions SET status = 'EXPIRED'
       WHERE application_user_id = ? AND status = 'ACTIVE' AND ends_at IS NOT NULL AND ends_at <= CURRENT_TIMESTAMP(3)`,
      [input.applicationUserId],
    );
    const [active] = await connection.query<(RowDataPacket & { id: string; ends_at: string | null })[]>(
      `SELECT id, ends_at FROM moderation_restrictions
       WHERE application_user_id = ? AND status = 'ACTIVE'
         AND restriction_type IN ('TEMP_LIVE_BAN','SUSPENSION')
         AND (ends_at IS NULL OR ends_at > CURRENT_TIMESTAMP(3)) LIMIT 1 FOR UPDATE`,
      [input.applicationUserId],
    );
    if (active[0]) throw new Error("This user already has an active Live restriction. Restore it first if a new duration is required.");
    const restrictionId = randomUUID();
    await connection.execute(
      `INSERT INTO moderation_restrictions (id, application_user_id, restriction_type, ends_at, reason, actor_account_id)
       VALUES (?, ?, 'TEMP_LIVE_BAN', DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ${input.durationMinutes} MINUTE), ?, ?)`,
      [restrictionId, input.applicationUserId, input.reason.trim(), input.scope.account.id],
    );
    await connection.execute("UPDATE live_rooms SET status = 'ENDED', ended_at = CURRENT_TIMESTAMP(3) WHERE host_application_user_id = ? AND status IN ('ACTIVE','LOCKED')", [input.applicationUserId]);
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "moderation.temp_live_ban", module: "moderation", targetType: "application_user", targetId: input.applicationUserId,
      next: { durationMinutes: input.durationMinutes }, reason: input.reason.trim(),
    });
    return { restrictionId, userName: users[0].full_name };
  });
}

export async function permanentlyBanUser(input: { scope: Scope; applicationUserId: string; reason: string; confirmed: boolean }) {
  if (input.scope.account.role !== "MASTER" || !input.scope.isGlobal || !input.confirmed) throw new Error("Master confirmation is required for a permanent ban.");
  if (input.reason.trim().length < 5) throw new Error("Provide a clear permanent-ban reason.");
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; full_name: string; account_status: string })[]>(
      "SELECT id, full_name, account_status FROM application_users WHERE id = ? LIMIT 1 FOR UPDATE",
      [input.applicationUserId],
    );
    const user = rows[0];
    if (!user) throw new Error("User was not found.");
    if (user.account_status === "BANNED") throw new Error("This user is already permanently banned.");
    await connection.execute("UPDATE application_users SET account_status = 'BANNED' WHERE id = ?", [user.id]);
    await connection.execute("UPDATE mobile_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE application_user_id = ?", [user.id]);
    await connection.execute("UPDATE live_rooms SET status = 'ENDED', ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3)) WHERE host_application_user_id = ? AND status IN ('ACTIVE','LOCKED')", [user.id]);
    await connection.execute(
      "INSERT INTO moderation_restrictions (id, application_user_id, restriction_type, ends_at, reason, actor_account_id) VALUES (?, ?, 'SUSPENSION', NULL, ?, ?)",
      [randomUUID(), user.id, input.reason.trim(), input.scope.account.id],
    );
    await audit(connection, {
      actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "user.permanent_ban",
      module: "moderation", targetType: "application_user", targetId: user.id,
      previous: { status: user.account_status }, next: { status: "BANNED", sessionsRevoked: true }, reason: input.reason.trim(),
    });
    return { userName: user.full_name };
  });
}

export async function listWithdrawals(scope: Scope) {
  return (await listWithdrawalsPage(scope)).items;
}

export async function listWithdrawalsPage(scope: Scope, input: PageRequest = {}): Promise<PageResult<{
  id: string; code: string; fullName: string; externalUserId: string; amount: number; currency: string;
  status: string; requestedAt: string; payout: string | null;
}>> {
  const { page, pageSize, offset } = pageInput(input);
  const filter = scopeWhere(scope, "w.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; withdrawal_code: string; full_name: string; external_user_id: string; amount: number; currency: string; status: string; requested_at: string; payout_method_masked: string | null })[]>(
    `SELECT w.id, w.withdrawal_code, u.full_name, u.external_user_id, w.amount, w.currency, w.status, w.requested_at, w.payout_method_masked
     FROM withdrawal_requests w INNER JOIN application_users u ON u.id = w.application_user_id
     WHERE ${filter.clause} ORDER BY w.requested_at DESC LIMIT ? OFFSET ?`, [...filter.values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map((row) => ({ id: row.id, code: row.withdrawal_code, fullName: row.full_name, externalUserId: row.external_user_id, amount: Number(row.amount), currency: row.currency, status: row.status, requestedAt: row.requested_at, payout: row.payout_method_masked })), page, pageSize, hasNext: rows.length > pageSize };
}

export async function listRooms(scope: Scope) {
  return (await listRoomsPage(scope)).items;
}

export async function listRoomsPage(scope: Scope, input: PageRequest = {}) {
  const { page, pageSize, offset } = pageInput(input);
  const filter = scopeWhere(scope, "r.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; room_code: string; room_type: string; status: string; audience_count: number; started_at: string; full_name: string; external_user_id: string; application_user_id: string; theme_index: number; theme_enabled: number; pk_requests_enabled: number; password_protected: number; chat_locked: number; pk_count: number; presence_incidents: number; mixer_status: string | null; rtc_publishers: number; passive_streaming: number; passive_rtc_fallback: number; mixer_seconds: number })[]>(
    `SELECT r.id, r.room_code, r.room_type, r.status, r.audience_count, r.started_at,
            r.theme_index, r.theme_enabled, r.pk_requests_enabled, (r.password_hash IS NOT NULL) password_protected, r.chat_locked,
            COALESCE(pk.pk_count, 0) pk_count, COALESCE(incidents.presence_incidents, 0) presence_incidents,
            mixer.status mixer_status,
            COALESCE(media.rtc_publishers, 0) rtc_publishers,
            COALESCE(media.passive_streaming, 0) passive_streaming,
            COALESCE(media.passive_rtc_fallback, 0) passive_rtc_fallback,
            COALESCE(mixer.active_duration_seconds, 0) + IF(mixer.active_started_at IS NULL, 0,
              GREATEST(0, TIMESTAMPDIFF(SECOND, mixer.active_started_at, CURRENT_TIMESTAMP(3)))) mixer_seconds,
            u.full_name, u.external_user_id, u.id application_user_id
     FROM live_rooms r INNER JOIN application_users u ON u.id = r.host_application_user_id
     LEFT JOIN (
       SELECT room_id, COUNT(*) pk_count FROM (
         SELECT source_room_id room_id FROM live_pk_sessions
         UNION ALL
         SELECT target_room_id room_id FROM live_pk_sessions
       ) pk_rooms GROUP BY room_id
     ) pk ON pk.room_id = r.id
     LEFT JOIN (
       SELECT room_id, COUNT(*) presence_incidents FROM face_live_presence_incidents GROUP BY room_id
     ) incidents ON incidents.room_id = r.id
     LEFT JOIN live_media_mix_tasks mixer ON mixer.room_id = r.id
     LEFT JOIN (
       SELECT room_id,
         SUM(usage_type IN ('FACE_HOST_RTC','FACE_AUDIO_GUEST_RTC','PARTY_SPEAKER_RTC') AND ended_at IS NULL AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND) rtc_publishers,
         SUM(usage_type IN ('FACE_PASSIVE_STREAM','PARTY_PASSIVE_STREAM') AND ended_at IS NULL AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND) passive_streaming,
         SUM(usage_type IN ('FACE_PASSIVE_RTC_FALLBACK','PARTY_PASSIVE_RTC_FALLBACK') AND ended_at IS NULL AND last_seen_at >= CURRENT_TIMESTAMP(3) - INTERVAL 30 SECOND) passive_rtc_fallback
       FROM live_media_usage GROUP BY room_id
     ) media ON media.room_id = r.id
     WHERE ${filter.clause} ORDER BY r.started_at DESC LIMIT ? OFFSET ?`, [...filter.values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map((row) => ({ id: row.id, roomCode: row.room_code, roomType: row.room_type, status: row.status, audience: Number(row.audience_count), startedAt: row.started_at, hostName: row.full_name, hostExternalId: row.external_user_id, applicationUserId: row.application_user_id, themeIndex: Number(row.theme_index), themeEnabled: Boolean(row.theme_enabled), pkRequestsEnabled: Boolean(row.pk_requests_enabled), passwordProtected: Boolean(row.password_protected), chatLocked: Boolean(row.chat_locked), pkCount: Number(row.pk_count), presenceIncidents: Number(row.presence_incidents), mixerStatus: row.mixer_status ?? "INACTIVE", rtcPublishers: Number(row.rtc_publishers), passiveStreaming: Number(row.passive_streaming), passiveRtcFallback: Number(row.passive_rtc_fallback), mixerSeconds: Number(row.mixer_seconds) })), page, pageSize, hasNext: rows.length > pageSize };
}

export async function listPresenceIncidents(scope: Scope) {
  const filter = scopeWhere(scope, "user.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & {
    id: string; room_code: string; room_type: string; incident_type: string;
    consecutive_failures: number; created_at: string; application_user_id: string;
    public_id: number; full_name: string; restriction_id: string | null;
  })[]>(
    `SELECT incident.id, room.room_code, room.room_type, incident.incident_type,
            incident.consecutive_failures, incident.created_at,
            user.id application_user_id, user.public_id, user.full_name,
            restriction.id restriction_id
     FROM face_live_presence_incidents incident
     INNER JOIN live_rooms room ON room.id = incident.room_id
     INNER JOIN application_users user ON user.id = incident.host_application_user_id
     LEFT JOIN moderation_restrictions restriction
       ON restriction.application_user_id = user.id
      AND restriction.restriction_type = 'SUSPENSION'
      AND restriction.status = 'ACTIVE'
      AND (restriction.ends_at IS NULL OR restriction.ends_at > CURRENT_TIMESTAMP(3))
     WHERE ${filter.clause}
     ORDER BY incident.created_at DESC LIMIT 50`,
    filter.values,
  );
  return rows.map((row) => ({
    id: row.id,
    roomCode: row.room_code,
    roomType: row.room_type,
    incidentType: row.incident_type,
    consecutiveFailures: Number(row.consecutive_failures),
    createdAt: row.created_at,
    applicationUserId: row.application_user_id,
    userPublicId: String(row.public_id),
    userName: row.full_name,
    restrictionId: row.restriction_id,
  }));
}

export async function restoreLiveAccess(input: { scope: Scope; restrictionId: string; reason: string }) {
  if (!can(input.scope.account.role, "rooms.restrict")) throw new Error("Your role cannot restore Live access.");
  if (input.reason.trim().length < 5) throw new Error("Provide a clear review reason.");
  const filter = monitoringScopeWhere(input.scope, "user.agency_account_id");
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & {
      id: string; application_user_id: string; full_name: string;
    })[]>(
      `SELECT restriction.id, restriction.application_user_id, user.full_name
       FROM moderation_restrictions restriction
       INNER JOIN application_users user ON user.id = restriction.application_user_id
       WHERE restriction.id = ? AND restriction.restriction_type = 'TEMP_LIVE_BAN'
         AND restriction.status = 'ACTIVE' AND ${filter.clause}
       LIMIT 1 FOR UPDATE`,
      [input.restrictionId, ...filter.values],
    );
    const restriction = rows[0];
    if (!restriction) throw new Error("The active temporary Live restriction was not found in your scope.");
    await connection.execute(
      "UPDATE moderation_restrictions SET status = 'REVOKED', ends_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [restriction.id],
    );
    await connection.execute(
      `INSERT INTO mobile_notifications
        (id, application_user_id, notification_type, title, message, action_target)
       VALUES (?, ?, 'MODERATION', 'Live access restored', ?, 'profile/live-access')`,
      [randomUUID(), restriction.application_user_id, input.reason.trim()],
    );
    await audit(connection, {
      actorId: input.scope.account.id,
      actorRole: input.scope.account.role,
      action: "moderation.live_access_restored",
      module: "moderation",
      targetType: "application_user",
      targetId: restriction.application_user_id,
      previous: { restrictionId: restriction.id, status: "ACTIVE" },
      next: { status: "REVOKED" },
      reason: input.reason.trim(),
    });
    return { userName: restriction.full_name };
  });
}

export async function listAudit(scope: Scope) {
  return (await listAuditPage(scope)).items;
}

export async function listAuditPage(scope: Scope, input: PageRequest = {}) {
  const { page, pageSize, offset } = pageInput(input);
  const filter = scope.isGlobal ? { clause: "1=1", values: [] as string[] } : scopeWhere(scope, "a.actor_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; action: string; module: string; target_type: string; reason: string | null; created_at: string; full_name: string | null; role: string | null })[]>(
    `SELECT a.id, a.action, a.module, a.target_type, a.reason, a.created_at, p.full_name, p.role
     FROM audit_logs a LEFT JOIN platform_accounts p ON p.id = a.actor_account_id
     WHERE ${filter.clause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [...filter.values, pageSize + 1, offset],
  );
  return { items: rows.slice(0, pageSize).map((row) => ({ id: row.id, action: row.action, module: row.module, targetType: row.target_type, reason: row.reason, createdAt: row.created_at, actorName: row.full_name ?? "System", actorRole: row.role })), page, pageSize, hasNext: rows.length > pageSize };
}

export async function listRiskFlags(scope: Scope, page = 1) {
  const filter = scopeWhere(scope, "u.agency_account_id");
  const [rows] = await db().query<(RowDataPacket & { id: string; severity: string; status: string; rule_key: string; summary: string; created_at: string; full_name: string | null; external_user_id: string | null })[]>(
    `SELECT r.id, r.severity, r.status, r.rule_key, r.summary, r.created_at, u.full_name, u.external_user_id
     FROM risk_flags r LEFT JOIN application_users u ON u.id = r.application_user_id
     WHERE ${filter.clause} ORDER BY FIELD(r.severity, 'HIGH', 'MEDIUM', 'LOW'), r.created_at DESC LIMIT 26 OFFSET ?`, [...filter.values, (Math.max(1, Math.trunc(page)) - 1) * 25],
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
    const resolved = input.status === "RESOLVED" ? 1 : 0;
    await connection.execute("UPDATE risk_flags SET status = ?, resolved_by = IF(?, ?, resolved_by), resolved_at = IF(?, CURRENT_TIMESTAMP(3), resolved_at) WHERE id = ?", [input.status, resolved, input.scope.account.id, resolved, input.flagId]);
    await audit(connection, { actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "risk.status_change", module: "risk", targetType: "risk_flag", targetId: input.flagId, previous: { status: rows[0].status }, next: { status: input.status }, reason: input.reason });
  });
}

export async function updateRoomStatus(input: { scope: Scope; roomId: string; status: "ACTIVE" | "LOCKED" | "ENDED"; reason: string }) {
  const filter = scopeWhere(input.scope, "agency_account_id");
  await withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: string })[]>(`SELECT id, status FROM live_rooms WHERE id = ? AND ${filter.clause} FOR UPDATE`, [input.roomId, ...filter.values]);
    if (!rows[0] || !["ACTIVE", "LOCKED"].includes(rows[0].status)) throw new Error("Only an active or locked room in your scope can be changed.");
    if (rows[0].status === input.status || (rows[0].status === "LOCKED" && input.status === "LOCKED")) throw new Error("Choose a valid new room status.");
    await connection.execute("UPDATE live_rooms SET status = ?, ended_at = IF(?, CURRENT_TIMESTAMP(3), ended_at) WHERE id = ?", [input.status, input.status === "ENDED" ? 1 : 0, input.roomId]);
    await audit(connection, { actorId: input.scope.account.id, actorRole: input.scope.account.role, action: "room.status_change", module: "rooms", targetType: "live_room", targetId: input.roomId, previous: { status: rows[0].status }, next: { status: input.status }, reason: input.reason });
  });
}
