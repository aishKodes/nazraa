import "server-only";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/pool";
import { withIdempotentTransaction } from "@/lib/db/transaction";
import { AdjustmentError, masterAdjustmentSchema, type MasterAdjustmentInput } from "@/lib/finance/master-adjustment";
import type { Scope } from "@/types/platform";

function requireMaster(scope: Scope) {
  if (scope.account.role !== "MASTER" || !can(scope.account.role, "wallet.adjust"))
    throw new AdjustmentError("Only Master can adjust user balances.", 403);
}

export async function findAdjustmentTarget(scope: Scope, query: string) {
  requireMaster(scope);
  const search = query.trim();
  if (!search || search.length > 80) return null;
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT u.id,u.public_id,u.external_user_id,u.full_name,
      CASE WHEN avatar.updated_at IS NOT NULL THEN CONCAT('/api/v1/mobile/avatar/',u.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(avatar.updated_at)*1000)) ELSE u.avatar_url END avatar_url,u.account_status,
      a.full_name agency_name,a.public_id agency_public_id,
      COALESCE(c.available_balance,0) coins,COALESCE(d.available_balance,0) diamonds
     FROM application_users u LEFT JOIN host_profiles h ON h.application_user_id=u.id
     LEFT JOIN application_user_avatars avatar ON avatar.application_user_id=u.id
     LEFT JOIN platform_accounts a ON a.id=COALESCE(h.agency_account_id,u.agency_account_id)
     LEFT JOIN wallet_balances c ON c.owner_type='APPLICATION_USER' AND c.owner_id=u.id AND c.asset_type='COIN'
     LEFT JOIN wallet_balances d ON d.owner_type='APPLICATION_USER' AND d.owner_id=u.id AND d.asset_type='DIAMOND'
     WHERE u.public_id=? OR u.external_user_id=? LIMIT 2`,
    [/^\d{1,12}$/.test(search) ? Number(search) : 0, search]);
  if (rows.length > 1) throw new AdjustmentError("This ID matches more than one account. Use the unique User ID.");
  const row = rows[0];
  return row ? { id: String(row.id), publicId: String(row.public_id), hostId: String(row.external_user_id),
    name: String(row.full_name), avatarUrl: row.avatar_url as string | null, status: String(row.account_status),
    agencyName: row.agency_name as string | null, agencyId: row.agency_public_id == null ? null : String(row.agency_public_id),
    coins: Number(row.coins), diamonds: Number(row.diamonds) } : null;
}

type StoredAdjustment = RowDataPacket & { id: string; transaction_code: string; actor_account_id: string; metadata: string | Record<string, unknown> };
function storedResult(row: StoredAdjustment, input: MasterAdjustmentInput, actorId: string) {
  const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
  const original = metadata.request as MasterAdjustmentInput | undefined;
  if (row.actor_account_id !== actorId || !original ||
    ["userId", "asset", "action", "amount", "reason", "internalNote", "expectedBalance"].some(key =>
      original[key as keyof MasterAdjustmentInput] !== input[key as keyof MasterAdjustmentInput]))
    throw new AdjustmentError("This request key has already been used for a different adjustment.", 409);
  return { id: row.id, transactionCode: row.transaction_code, before: Number(metadata.balanceBefore), after: Number(metadata.balanceAfter), replayed: true };
}

export async function adjustUserBalance(scope: Scope, raw: MasterAdjustmentInput) {
  requireMaster(scope);
  const parsed = masterAdjustmentSchema.safeParse(raw);
  if (!parsed.success) throw new AdjustmentError("Enter a positive whole amount, a reason, and explicit confirmation.");
  const input = parsed.data;
  const key = `master-adjust:${input.idempotencyKey}`;
  try {
    return await withIdempotentTransaction(async connection => {
      // Recheck authority at commit time, not just against a submitted role or hidden button.
      const [actors] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM platform_accounts WHERE id=? AND role='MASTER' AND status='ACTIVE' AND removed_at IS NULL LOCK IN SHARE MODE", [scope.account.id]);
      if (!actors[0]) throw new AdjustmentError("Master access is no longer active.", 403);
      const [users] = await connection.query<RowDataPacket[]>("SELECT id,public_id,full_name FROM application_users WHERE id=? FOR UPDATE", [input.userId]);
      if (!users[0]) throw new AdjustmentError("The target account was not found.");
      // A user lock serializes same-user retries. The ledger's global UNIQUE
      // idempotency key also protects concurrent different-user/key collisions.
      const [prior] = await connection.query<StoredAdjustment[]>("SELECT id,transaction_code,actor_account_id,metadata FROM ledger_transactions WHERE idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]) return storedResult(prior[0], input, scope.account.id);
      await connection.execute("INSERT IGNORE INTO wallet_balances (id,owner_type,owner_id,asset_type) VALUES (?,'APPLICATION_USER',?,?)", [randomUUID(), input.userId, input.asset]);
      const [wallets] = await connection.query<RowDataPacket[]>("SELECT id,available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type=? FOR UPDATE", [input.userId, input.asset]);
      const wallet = wallets[0];
      const before = Number(wallet.available_balance);
      if (!Number.isSafeInteger(before)) throw new AdjustmentError("This balance needs a precision review before adjustment.");
      if (before !== input.expectedBalance) throw new AdjustmentError("The balance changed. Refresh the account and confirm the new balance before submitting.", 409);
      const after = input.action === "ADD" ? before + input.amount : before - input.amount;
      if (after < 0) throw new AdjustmentError("The available balance is too low for this removal.");
      if (!Number.isSafeInteger(after)) throw new AdjustmentError("The resulting balance exceeds the supported safe whole-number range.");
      const id = randomUUID();
      const transactionCode = `MADJ-${randomUUID().replaceAll("-", "").toUpperCase()}`;
      const transactionType = `MASTER_${input.asset}_${input.action === "ADD" ? "CREDIT" : "DEBIT"}`;
      const adding = input.action === "ADD";
      await connection.execute(`INSERT INTO ledger_transactions
        (id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,destination_id,amount,status,reason,actor_account_id,metadata)
        VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?)`,
      [id,transactionCode,key,input.asset,transactionType,adding?'PLATFORM_CONTROL':'APPLICATION_USER',adding?null:input.userId,
        adding?'APPLICATION_USER':'PLATFORM_CONTROL',adding?input.userId:null,input.amount,input.reason,scope.account.id,
        JSON.stringify({request:input,balanceBefore:before,balanceAfter:after,actorRole:'MASTER',targetPublicId:String(users[0].public_id),targetName:users[0].full_name})]);
      await connection.execute("UPDATE wallet_balances SET available_balance=? WHERE id=?", [after, wallet.id]);
      await connection.execute(`INSERT INTO audit_logs
        (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
        VALUES (?,?,'MASTER','wallet.master_adjustment','wallet','application_user',?,?,?,?)`,
      [randomUUID(),scope.account.id,input.userId,JSON.stringify({asset:input.asset,balance:before}),
        JSON.stringify({asset:input.asset,balance:after,amount:input.amount,direction:input.action,transactionId:id,transactionCode,internalNote:input.internalNote}),input.reason]);
      return { id, transactionCode, before, after, replayed: false };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      const [prior] = await db().query<StoredAdjustment[]>("SELECT id,transaction_code,actor_account_id,metadata FROM ledger_transactions WHERE idempotency_key=?", [key]);
      if (prior[0]) return storedResult(prior[0], input, scope.account.id);
    }
    throw error;
  }
}

export async function listMasterAdjustments(scope: Scope, page = 1) {
  requireMaster(scope);
  const [rows] = await db().query<RowDataPacket[]>(`SELECT l.id,l.transaction_code,l.asset_type,l.transaction_type,l.amount,l.reason,l.created_at,l.metadata,
    COALESCE(u.public_id,JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.targetPublicId'))) public_id,
    COALESCE(u.full_name,JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.targetName'))) full_name,a.full_name actor_name,a.public_id actor_public_id
    FROM ledger_transactions l LEFT JOIN application_users u ON u.id=COALESCE(l.source_id,l.destination_id)
    LEFT JOIN platform_accounts a ON a.id=l.actor_account_id
    WHERE l.transaction_type IN ('MASTER_COIN_CREDIT','MASTER_COIN_DEBIT','MASTER_DIAMOND_CREDIT','MASTER_DIAMOND_DEBIT')
    ORDER BY l.created_at DESC,l.id DESC LIMIT 26 OFFSET ?`, [(Math.max(1, Math.trunc(page)) - 1) * 25]);
  return { hasNext: rows.length > 25, items: rows.slice(0,25).map(row => {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    return { id: String(row.id), code: String(row.transaction_code), asset: String(row.asset_type), action: String(row.transaction_type).endsWith('_CREDIT')?'Add':'Remove',
      amount:Number(row.amount), before:Number(metadata.balanceBefore), after:Number(metadata.balanceAfter),
      name:String(row.full_name),publicId:String(row.public_id),reason:String(row.reason),internalNote:String(metadata.request?.internalNote??''),
      actorName:String(row.actor_name),actorId:String(row.actor_public_id),createdAt:row.created_at as string };
  }) };
}
