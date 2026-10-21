import "server-only";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db/pool";
import { withIdempotentTransaction } from "@/lib/db/transaction";
import { AdjustmentError, masterAdjustmentSchema, type AdjustmentTarget, type MasterAdjustmentInput } from "@/lib/finance/master-adjustment";
import type { Scope } from "@/types/platform";

function requireMaster(scope: Scope) {
  if (scope.account.role !== "MASTER" || !can(scope.account.role, "wallet.adjust"))
    throw new AdjustmentError("Only Master can adjust user balances.", 403);
}

export function normalizeAdjustmentId(query: string) {
  return query.replace(/\s+/g, '').toLowerCase();
}

// Numeric range predicates keep the public-ID UNIQUE index usable. Casting
// public_id to CHAR for LIKE would scan every user on each keystroke.
function publicIdPrefix(prefix: string, column: string, exact: boolean) {
  if (!/^\d{1,20}$/.test(prefix)) return { sql: 'FALSE', values: [] as string[] };
  const value = BigInt(prefix), maximum = 18446744073709551615n;
  if (value > maximum) return { sql: 'FALSE', values: [] as string[] };
  if (exact || prefix.startsWith('0')) return { sql: `${column}=?`, values: [value.toString()] };
  const clauses: string[] = [], values: string[] = [];
  for (let zeros = 0; zeros <= 20 - prefix.length; zeros++) {
    const low = value * 10n ** BigInt(zeros);
    if (low > maximum) break;
    const high = (value + 1n) * 10n ** BigInt(zeros) - 1n;
    clauses.push(`${column} BETWEEN ? AND ?`);
    values.push(low.toString(), (high > maximum ? maximum : high).toString());
  }
  return { sql: `(${clauses.join(' OR ')})`, values };
}

/** One canonical lookup for app wallets and existing platform inventory wallets.
 * Exact matches precede indexed prefixes; no name/contact/whole-table search. */
export async function searchAdjustmentTargets(scope: Scope, query: string, page = 1, exact = false) {
  requireMaster(scope);
  const search = normalizeAdjustmentId(query);
  if (search.length < (exact ? 1 : 2) || search.length > 80) return {items: [] as AdjustmentTarget[], hasNext: false};
  const pageNumber = Math.min(50, Math.max(1, Math.trunc(page) || 1));
  const limit = pageNumber * 20 + 1;
  const numeric = publicIdPrefix(search, 'public_id', exact);
  const escaped = search.replace(/[!%_]/g, character => `!${character}`);
  const candidates = `
    (SELECT id,'APPLICATION_USER' owner_type,public_id,IF(public_id=?,0,1) match_rank
      FROM application_users FORCE INDEX (uq_application_user_public_id) WHERE ${numeric.sql} ORDER BY public_id LIMIT ${limit})
    UNION ALL
    (SELECT id,'APPLICATION_USER',public_id,IF(external_user_id=?,0,1) FROM application_users
      WHERE external_user_id ${exact ? '= ?' : "LIKE ? ESCAPE '!'"} ORDER BY external_user_id LIMIT ${limit})
    UNION ALL
    (SELECT id,'PLATFORM_ACCOUNT',public_id,IF(public_id=?,0,1) FROM platform_accounts FORCE INDEX (uq_platform_account_public_id)
      WHERE ${numeric.sql} AND removed_at IS NULL AND EXISTS
        (SELECT 1 FROM wallet_balances w WHERE w.owner_type='PLATFORM_ACCOUNT' AND w.owner_id=platform_accounts.id)
      ORDER BY public_id LIMIT ${limit})`;
  const exactNumeric = /^\d{1,20}$/.test(search) ? search.replace(/^0+(?=\d)/, '') : '0';
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT selected.id,selected.owner_type,selected.public_id,u.external_user_id,
      COALESCE(u.full_name,p.full_name) full_name,COALESCE(u.account_status,p.status) account_status,
      CASE WHEN selected.owner_type='PLATFORM_ACCOUNT' THEN p.role WHEN u.is_host THEN 'HOST' ELSE 'USER' END account_role,
      CASE WHEN avatar.updated_at IS NOT NULL THEN CONCAT('/api/v1/mobile/avatar/',u.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(avatar.updated_at)*1000)) ELSE u.avatar_url END avatar_url,
      a.full_name agency_name,a.public_id agency_public_id,
      COALESCE(c.available_balance,0) coins,COALESCE(d.available_balance,0) diamonds
     FROM (SELECT id,owner_type,public_id,MIN(match_rank) match_rank FROM (${candidates}) matches
       GROUP BY id,owner_type,public_id ORDER BY match_rank,public_id,owner_type,id LIMIT 21 OFFSET ?) selected
     LEFT JOIN application_users u ON selected.owner_type='APPLICATION_USER' AND u.id=selected.id
     LEFT JOIN platform_accounts p ON selected.owner_type='PLATFORM_ACCOUNT' AND p.id=selected.id
     LEFT JOIN host_profiles h ON h.application_user_id=u.id
     LEFT JOIN application_user_avatars avatar ON avatar.application_user_id=u.id
     LEFT JOIN platform_accounts a ON a.id=COALESCE(h.agency_account_id,u.agency_account_id)
     LEFT JOIN wallet_balances c ON c.owner_type=selected.owner_type AND c.owner_id=selected.id AND c.asset_type='COIN'
     LEFT JOIN wallet_balances d ON d.owner_type=selected.owner_type AND d.owner_id=selected.id AND d.asset_type='DIAMOND'
     ORDER BY selected.match_rank,selected.public_id,selected.owner_type,selected.id`,
    [exactNumeric,...numeric.values,search,exact ? search : escaped+'%',exactNumeric,...numeric.values,(pageNumber-1)*20]);
  return {hasNext: rows.length > 20 && pageNumber < 50, items: rows.slice(0,20).map(row => ({
    id: String(row.id), ownerType: row.owner_type as AdjustmentTarget['ownerType'], publicId: String(row.public_id),
    // Legacy external IDs may be OAuth subjects/UUIDs rather than public Host
    // handles. They remain searchable, but never disclose these as a public ID.
    hostId: row.external_user_id != null && /^[a-z0-9._-]{2,24}$/i.test(String(row.external_user_id)) ? String(row.external_user_id) : null, role: String(row.account_role),
    name: String(row.full_name), avatarUrl: row.avatar_url as string | null, status: String(row.account_status),
    agencyName: row.agency_name as string | null, agencyId: row.agency_public_id == null ? null : String(row.agency_public_id),
    coins: Number(row.coins), diamonds: Number(row.diamonds) }))};
}

export async function findAdjustmentTarget(scope: Scope, query: string) {
  const result = await searchAdjustmentTargets(scope,query,1,true);
  if (result.items.length > 1) throw new AdjustmentError('This ID matches multiple wallets. Select the exact account type from search results.');
  return result.items[0] ?? null;
}

type StoredAdjustment = RowDataPacket & { id: string; transaction_code: string; actor_account_id: string; metadata: string | Record<string, unknown> };
function storedResult(row: StoredAdjustment, input: MasterAdjustmentInput, actorId: string) {
  const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
  const original = metadata.request as MasterAdjustmentInput | undefined;
  if (row.actor_account_id !== actorId || !original || (original.ownerType ?? 'APPLICATION_USER') !== (input.ownerType ?? 'APPLICATION_USER') ||
    ["userId", "asset", "action", "amount", "reason", "internalNote", "expectedBalance"].some(key =>
      original[key as keyof MasterAdjustmentInput] !== input[key as keyof MasterAdjustmentInput]))
    throw new AdjustmentError("This request key has already been used for a different adjustment.", 409);
  return { id: row.id, transactionCode: row.transaction_code, amount: original.amount, before: Number(metadata.balanceBefore), after: Number(metadata.balanceAfter), replayed: true };
}

export async function adjustUserBalance(scope: Scope, raw: MasterAdjustmentInput) {
  requireMaster(scope);
  const parsed = masterAdjustmentSchema.safeParse(raw);
  if (!parsed.success) throw new AdjustmentError("Enter a positive whole amount, a reason, and explicit confirmation.");
  const input = parsed.data;
  const ownerType = input.ownerType ?? 'APPLICATION_USER';
  const key = `master-adjust:${input.idempotencyKey}`;
  try {
    return await withIdempotentTransaction(async connection => {
      // Recheck authority at commit time, not just against a submitted role or hidden button.
      const [actors] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM platform_accounts WHERE id=? AND role='MASTER' AND status='ACTIVE' AND removed_at IS NULL LOCK IN SHARE MODE", [scope.account.id]);
      if (!actors[0]) throw new AdjustmentError("Master access is no longer active.", 403);
      const [users] = await connection.query<RowDataPacket[]>(ownerType === 'APPLICATION_USER'
        ? "SELECT id,public_id,full_name,IF(is_host,'HOST','USER') account_role FROM application_users WHERE id=? FOR UPDATE"
        : "SELECT id,public_id,full_name,role account_role FROM platform_accounts WHERE id=? AND removed_at IS NULL FOR UPDATE", [input.userId]);
      if (!users[0]) throw new AdjustmentError("The target account was not found.");
      // A user lock serializes same-user retries. The ledger's global UNIQUE
      // idempotency key also protects concurrent different-user/key collisions.
      const [prior] = await connection.query<StoredAdjustment[]>("SELECT id,transaction_code,actor_account_id,metadata FROM ledger_transactions WHERE idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]) return storedResult(prior[0], input, scope.account.id);
      if (ownerType === 'PLATFORM_ACCOUNT') {
        const [owned] = await connection.query<RowDataPacket[]>("SELECT id FROM wallet_balances WHERE owner_type='PLATFORM_ACCOUNT' AND owner_id=? LIMIT 1",[input.userId]);
        if (!owned.length) throw new AdjustmentError('This platform account does not own a supported wallet.');
      }
      await connection.execute("INSERT IGNORE INTO wallet_balances (id,owner_type,owner_id,asset_type) VALUES (?,?,?,?)", [randomUUID(), ownerType, input.userId, input.asset]);
      const [wallets] = await connection.query<RowDataPacket[]>("SELECT id,available_balance FROM wallet_balances WHERE owner_type=? AND owner_id=? AND asset_type=? FOR UPDATE", [ownerType,input.userId, input.asset]);
      const wallet = wallets[0];
      const before = Number(wallet.available_balance);
      if (!Number.isSafeInteger(before)) throw new AdjustmentError("This balance needs a precision review before adjustment.");
      if (before !== input.expectedBalance) throw new AdjustmentError("The balance changed. Refresh the account and confirm the new balance before submitting.", 409);
      const after = input.action === "ADD" ? before + input.amount : before - input.amount;
      if (after < 0) throw new AdjustmentError(`Insufficient ${input.asset === 'COIN' ? 'Coin' : 'Diamond'} balance. The available balance is too low for this removal.`);
      if (!Number.isSafeInteger(after)) throw new AdjustmentError("The resulting balance exceeds the supported safe whole-number range.");
      const id = randomUUID();
      const transactionCode = `MADJ-${randomUUID().replaceAll("-", "").toUpperCase()}`;
      const transactionType = `MASTER_${input.asset}_${input.action === "ADD" ? "CREDIT" : "DEBIT"}`;
      const adding = input.action === "ADD";
      await connection.execute(`INSERT INTO ledger_transactions
        (id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,destination_id,amount,status,reason,actor_account_id,metadata)
        VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?)`,
      [id,transactionCode,key,input.asset,transactionType,adding?'PLATFORM_CONTROL':ownerType,adding?null:input.userId,
        adding?ownerType:'PLATFORM_CONTROL',adding?input.userId:null,input.amount,input.reason,scope.account.id,
        JSON.stringify({request:input,balanceBefore:before,balanceAfter:after,actorRole:'MASTER',targetOwnerType:ownerType,targetRole:users[0].account_role,targetPublicId:String(users[0].public_id),targetName:users[0].full_name})]);
      await connection.execute("UPDATE wallet_balances SET available_balance=? WHERE id=?", [after, wallet.id]);
      await connection.execute(`INSERT INTO audit_logs
        (id,actor_account_id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
        VALUES (?,?,'MASTER','wallet.master_adjustment','wallet',?,?,?,?,?)`,
      [randomUUID(),scope.account.id,ownerType.toLowerCase(),input.userId,JSON.stringify({asset:input.asset,balance:before}),
        JSON.stringify({asset:input.asset,balance:after,amount:input.amount,direction:input.action,targetRole:users[0].account_role,targetPublicId:String(users[0].public_id),transactionId:id,transactionCode,internalNote:input.internalNote}),input.reason]);
      return { id, transactionCode, amount: input.amount, before, after, replayed: false };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      const [prior] = await db().query<StoredAdjustment[]>("SELECT id,transaction_code,actor_account_id,metadata FROM ledger_transactions WHERE idempotency_key=?", [key]);
      if (prior[0]) return storedResult(prior[0], input, scope.account.id);
    }
    throw error;
  }
}

export async function listMasterAdjustments(scope: Scope, page = 1, search = '') {
  requireMaster(scope);
  const historySearch = search.trim().slice(0,80);
  const targets = historySearch ? (await searchAdjustmentTargets(scope,historySearch,1,true)).items : [];
  const parameters: (string | number)[] = [];
  const filters = historySearch ? ` AND (l.id=? OR l.transaction_code=? OR JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.targetPublicId'))=? ${targets.map(target => {
    parameters.push(target.ownerType,target.id,target.ownerType,target.id);
    return ' OR (l.source_type=? AND l.source_id=?) OR (l.destination_type=? AND l.destination_id=?)';
  }).join('')})` : '';
  if (historySearch) parameters.unshift(historySearch,historySearch,normalizeAdjustmentId(historySearch));
  const [rows] = await db().query<RowDataPacket[]>(`SELECT l.id,l.transaction_code,l.asset_type,l.transaction_type,l.amount,l.reason,l.created_at,l.metadata,
    COALESCE(u.public_id,p.public_id,JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.targetPublicId'))) public_id,
    COALESCE(u.full_name,p.full_name,JSON_UNQUOTE(JSON_EXTRACT(l.metadata,'$.targetName'))) full_name,a.full_name actor_name,a.public_id actor_public_id
    FROM ledger_transactions l
    LEFT JOIN application_users u ON (l.source_type='APPLICATION_USER' AND u.id=l.source_id) OR (l.destination_type='APPLICATION_USER' AND u.id=l.destination_id)
    LEFT JOIN platform_accounts p ON (l.source_type='PLATFORM_ACCOUNT' AND p.id=l.source_id) OR (l.destination_type='PLATFORM_ACCOUNT' AND p.id=l.destination_id)
    LEFT JOIN platform_accounts a ON a.id=l.actor_account_id
    WHERE l.transaction_type IN ('MASTER_COIN_CREDIT','MASTER_COIN_DEBIT','MASTER_DIAMOND_CREDIT','MASTER_DIAMOND_DEBIT')
    ${filters} ORDER BY l.created_at DESC,l.id DESC LIMIT 26 OFFSET ?`, [...parameters,(Math.min(10000,Math.max(1, Math.trunc(page))) - 1) * 25]);
  return { hasNext: rows.length > 25, items: rows.slice(0,25).map(row => {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    return { id: String(row.id), code: String(row.transaction_code), asset: String(row.asset_type), action: String(row.transaction_type).endsWith('_CREDIT')?'Add':'Remove',
      amount:Number(row.amount), before:Number(metadata.balanceBefore), after:Number(metadata.balanceAfter),
      name:String(row.full_name),publicId:String(row.public_id),role:String(metadata.targetRole??'USER / HOST'),ownerType:String(metadata.targetOwnerType??'APPLICATION_USER'),reason:String(row.reason),internalNote:String(metadata.request?.internalNote??''),
      actorName:String(row.actor_name),actorId:String(row.actor_public_id),createdAt:row.created_at as string };
  }) };
}
