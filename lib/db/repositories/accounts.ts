import "server-only";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import bcrypt from "bcryptjs";
import { cache } from "react";
import { db, withDatabaseReadRetry } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { scopedAccountsSql } from "@/lib/db/queries/sql";
import type { PlatformAccount, Role, Scope } from "@/types/platform";

type AccountRow = RowDataPacket & {
  id: string;
  public_id: number;
  role: Role;
  role_code: string;
  full_name: string;
  email: string | null;
  mobile: string | null;
  status: PlatformAccount["status"];
  parent_account_id: string | null;
  password_hash?: string;
};

function mapAccount(row: AccountRow): PlatformAccount {
  return {
    id: row.id,
    publicId: String(row.public_id),
    role: row.role,
    roleCode: row.role_code,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    status: row.status,
    parentAccountId: row.parent_account_id,
  };
}

export async function accountByManagementId(publicId: string) {
  const [rows] = await withDatabaseReadRetry(() => db().execute<AccountRow[]>(
    `SELECT id, public_id, role, role_code, full_name, email, mobile, status, parent_account_id, password_hash
     FROM platform_accounts WHERE public_id = ? LIMIT 1`,
    [Number(publicId)],
  ));
  return rows[0] ? { ...mapAccount(rows[0]), passwordHash: rows[0].password_hash! } : null;
}

export const accountById = cache(async (id: string) => {
  const [rows] = await withDatabaseReadRetry(() => db().execute<AccountRow[]>(
    `SELECT id, public_id, role, role_code, full_name, email, mobile, status, parent_account_id
     FROM platform_accounts WHERE id = ? LIMIT 1`,
    [id],
  ));
  return rows[0] ? mapAccount(rows[0]) : null;
});

export async function createInitialMaster(input: { publicId: number; fullName: string; password: string }) {
  const [masters] = await db().query<(RowDataPacket & { value: number })[]>(
    "SELECT COUNT(*) value FROM platform_accounts WHERE role = 'MASTER'",
  );
  if (Number(masters[0]?.value ?? 0) > 0) return false;
  const passwordHash = await bcrypt.hash(input.password, 12);
  await withTransaction(async (connection) => {
    if (!Number.isInteger(input.publicId) || input.publicId < 100000 || input.publicId > 999999) throw new Error("Initial Master ID must be six digits.");
    const [collisions] = await connection.query<RowDataPacket[]>("SELECT id FROM platform_accounts WHERE public_id = ? LIMIT 1", [input.publicId]);
    if (collisions.length) throw new Error("Initial Master ID is already in use.");
    const roleCode = await generatedRoleCode("MASTER");
    await connection.execute(
      `INSERT INTO platform_accounts (id, public_id, role, role_code, full_name, password_hash, status)
       SELECT ?, ?, 'MASTER', ?, ?, ?, 'ACTIVE'
       WHERE NOT EXISTS (SELECT 1 FROM platform_accounts WHERE role = 'MASTER')`,
      [randomUUID(), input.publicId, roleCode, input.fullName, passwordHash],
    );
    // Product migrations can run before the first Master is provisioned. Seed
    // the current authoritative reward rule at that moment as well, otherwise
    // a brand-new installation would have no eligible Live reward at all.
    await connection.execute(
      `INSERT INTO host_reward_rules
        (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by)
       SELECT UUID(), seed.room_type, seed.rate, 60, TRUE, CURRENT_TIMESTAMP(3), master.id
       FROM (
         SELECT 'LIVE' room_type, 3500 rate UNION ALL
         SELECT 'FACE', 3500 UNION ALL
         SELECT 'PARTY', 0
       ) seed
       INNER JOIN platform_accounts master ON master.role = 'MASTER' AND master.status = 'ACTIVE'
       WHERE NOT EXISTS (
         SELECT 1 FROM host_reward_rules existing
         WHERE existing.room_type = seed.room_type AND existing.enabled = TRUE
       )`,
    );
  });
  return true;
}

export const scopeFor = cache(async (account: Scope["account"]): Promise<Scope> => {
  if (account.role === "MASTER") return { account, accountIds: [], isGlobal: true };
  if (account.role === "GLOBAL_MANAGER") {
    const [countries] = await db().query<RowDataPacket[]>(`SELECT country_code FROM global_manager_countries WHERE manager_id=?
      UNION SELECT gc.country_code FROM global_manager_country_groups mg JOIN country_groups g ON g.id=mg.group_id AND g.active=TRUE
      JOIN country_group_countries gc ON gc.group_id=g.id WHERE mg.manager_id=?`,[account.id,account.id]);
    const countryCodes=countries.map(r=>String(r.country_code));
    const [settings]=await db().query<RowDataPacket[]>('SELECT game_reports_enabled FROM global_manager_assignments WHERE manager_id=?',[account.id]);
    const [team]=await db().query<RowDataPacket[]>(scopedAccountsSql,[account.id]);
    const ids=team.map(r=>String(r.id));
    const [allowed]=countryCodes.length&&ids.length?await db().query<RowDataPacket[]>(`SELECT id FROM platform_accounts
      WHERE id IN (${ids.map(()=>'?').join(',')}) AND removed_at IS NULL AND (id=? OR country_code IN (${countryCodes.map(()=>'?').join(',')}))`,[...ids,account.id,...countryCodes]):[[]];
    return {account,isGlobal:false,accountIds:allowed.map(r=>String(r.id)),globalManagerId:account.id,globalManagerAccountIds:allowed.map(r=>String(r.id)),countryCodes,gameReportsEnabled:settings[0]?.game_reports_enabled!==0};
  }
  let scopeRootId = account.id;
  if (account.role === "MONITORING_CS") {
    const [parents] = await withDatabaseReadRetry(() => db().query<(RowDataPacket & { parent_account_id: string | null })[]>(
      "SELECT parent_account_id FROM platform_accounts WHERE id = ? LIMIT 1",
      [account.id],
    ));
    scopeRootId = parents[0]?.parent_account_id ?? account.id;
  }
  const [rows] = await withDatabaseReadRetry(() => db().query<(RowDataPacket & { id: string })[]>(scopedAccountsSql, [scopeRootId]));
  if (account.role === 'COUNTRY_MANAGER') {
    const [countries] = await db().query<RowDataPacket[]>('SELECT country_code FROM platform_accounts WHERE id=? AND removed_at IS NULL', [account.id]);
    const countryCode = String(countries[0]?.country_code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return restrictToManagingGlobal({account, accountIds: [], isGlobal: false, countryCode: null});
    const ids = rows.map(row => row.id);
    const [allowed] = ids.length ? await db().query<RowDataPacket[]>(
      `SELECT id FROM platform_accounts WHERE id IN (${ids.map(() => '?').join(',')}) AND country_code=? AND removed_at IS NULL`, [...ids, countryCode]) : [[]];
    return restrictToManagingGlobal({account, accountIds: allowed.map(row => String(row.id)), isGlobal: false, countryCode});
  }
  return restrictToManagingGlobal({ account, accountIds: rows.map((row) => row.id), isGlobal: false });
});

/** Descendant credentials must not bypass the GM boundary through a legacy
 * support/seller role. Legacy branches without a GM keep their existing policy. */
async function restrictToManagingGlobal(base:Scope):Promise<Scope>{
 const [ancestors]=await db().query<RowDataPacket[]>(`WITH RECURSIVE chain AS (
   SELECT id,parent_account_id,role,country_code,0 depth FROM platform_accounts WHERE id=?
   UNION ALL SELECT p.id,p.parent_account_id,p.role,p.country_code,c.depth+1 FROM platform_accounts p JOIN chain c ON p.id=c.parent_account_id WHERE c.depth<30
 ) SELECT id,role,country_code,depth FROM chain`,[base.account.id]);
 const owner=ancestors.find(r=>r.role==='GLOBAL_MANAGER');if(!owner)return base;
 const account=await accountById(String(owner.id));if(!account||account.role!=='GLOBAL_MANAGER')return {...base,accountIds:[],countryCodes:[],globalManagerId:String(owner.id),globalManagerAccountIds:[]};
 const parent=await scopeFor(account),ownCountry=String(ancestors.find(r=>Number(r.depth)===0)?.country_code??'').trim().toUpperCase();
 const countryCodes=(parent.countryCodes??[]).filter(c=>c===ownCountry);
 const allowed=new Set(parent.accountIds);
 return {...base,accountIds:countryCodes.length?base.accountIds.filter(id=>allowed.has(id)):[],countryCodes,globalManagerId:account.id,globalManagerAccountIds:parent.accountIds,gameReportsEnabled:parent.gameReportsEnabled};
}

export function scopeWhere(scope: Scope, column: string, countryColumn?: string) {
  if (scope.isGlobal) return { clause: "1=1", values: [] as string[] };
  if (!scope.accountIds.length) return { clause: "1=0", values: [] as string[] };
  const branch={clause:`${column} IN (${scope.accountIds.map(()=>"?").join(",")})`,values:[...scope.accountIds]};
  if(!scope.globalManagerId||!countryColumn)return branch;
  const countries=scope.countryCodes??[];
  if(!countries.length)return {clause:"1=0",values:[] as string[]};
  return {clause:`(${branch.clause} AND ${countryColumn} IN (${countries.map(()=>"?").join(",")}))`,values:[...branch.values,...countries]};
}

/**
 * Monitoring/CS is a platform support utility rather than a hierarchy editor.
 * It may locate any user, while its permission set still limits it to temporary
 * Live restrictions. Other operational roles remain constrained to their own
 * hierarchy branch.
 */
export function monitoringScopeWhere(scope: Scope, column: string, countryColumn?: string) {
  if (scope.account.role === "MONITORING_CS"&&!scope.globalManagerId) return { clause: "1=1", values: [] as string[] };
  return scopeWhere(scope, column, countryColumn);
}

const codePrefix: Record<Role, string> = {
  MASTER: "MST",
  GLOBAL_MANAGER: "GM",
  COUNTRY_MANAGER: "CM",
  SUPER_ADMIN: "SA",
  ADMIN: "ADM",
  BD: "BD",
  AGENCY: "AG",
  COIN_SELLER: "CS",
  MONITORING_CS: "MCS",
};

export async function generatedRoleCode(role: Role) {
  const code = `${codePrefix[role]}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  return code;
}

/** Financial rows can have two counterparties. GM visibility must not expose
 * a foreign team merely because its own employee initiated the transaction. */
export function globalManagerLedgerBoundary(scope:Scope,alias='l'){
  if(!scope.globalManagerId)return {clause:'1=1',values:[] as string[]};
  const parts:string[]=[],values:string[]=[];
  for(const side of ['source','destination']){
    const u=scopeWhere({...scope,accountIds:scope.globalManagerAccountIds??scope.accountIds},'gm_party.agency_account_id','gm_party.country_code');
    const a=scopeWhere(scope,'gm_account.id');
    parts.push(`(COALESCE(${alias}.${side}_type,'')<>'APPLICATION_USER' OR EXISTS(SELECT 1 FROM application_users gm_party WHERE gm_party.id=${alias}.${side}_id AND ${u.clause}))`);
    values.push(...u.values);
    parts.push(`(COALESCE(${alias}.${side}_type,'')<>'PLATFORM_ACCOUNT' OR EXISTS(SELECT 1 FROM platform_accounts gm_account WHERE gm_account.id=${alias}.${side}_id AND (gm_account.role='MASTER' OR ${a.clause})))`);
    values.push(...a.values);
  }
  const actor=scopeWhere(scope,'gm_actor.id');
  parts.push(`(${alias}.actor_account_id IS NULL OR EXISTS(SELECT 1 FROM platform_accounts gm_actor WHERE gm_actor.id=${alias}.actor_account_id AND (gm_actor.role='MASTER' OR ${actor.clause})))`);values.push(...actor.values);
  return {clause:parts.join(' AND '),values};
}

/** A constant SQL fragment for nested legacy report queries with independent
 * bind lists. Only canonical two-letter server-derived ISO keys become SQL. */
export function managementCountrySql(scope:Scope,column:string){
 if(!scope.globalManagerId)return '1=1';
 const codes=(scope.countryCodes??[]).filter(code=>/^[A-Z]{2}$/.test(code));
 return codes.length?`${column} IN (${codes.map(code=>`'${code}'`).join(',')})`:'1=0';
}

/** Old CS audit rows may refer to actions outside the newly assigned team.
 * An actor match alone must not disclose those old targets to delegated logins. */
export function managementAuditBoundary(scope:Scope,alias='a'){
 if(!scope.globalManagerId)return {clause:'1=1',values:[] as string[]};
 const account=scopeWhere(scope,`${alias}.target_id`),user=scopeWhere(scope,'gm_user.agency_account_id','gm_user.country_code');
 const host=scopeWhere(scope,'gm_host.agency_account_id','(SELECT country_code FROM application_users gm_owner WHERE gm_owner.id=gm_host.application_user_id)');
 const room=scopeWhere(scope,'gm_room.agency_account_id','(SELECT country_code FROM application_users gm_owner WHERE gm_owner.id=gm_room.host_application_user_id)');
 return {clause:`((${alias}.target_type='platform_account' AND ${account.clause})
   OR EXISTS(SELECT 1 FROM application_users gm_user WHERE gm_user.id=${alias}.target_id AND ${user.clause})
   OR EXISTS(SELECT 1 FROM host_profiles gm_host WHERE gm_host.id=${alias}.target_id AND ${host.clause})
   OR EXISTS(SELECT 1 FROM live_rooms gm_room WHERE gm_room.id=${alias}.target_id AND ${room.clause}))`,values:[...account.values,...user.values,...host.values,...room.values]};
}
