import "server-only";
import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import {
  withIdempotentTransaction,
  withTransaction,
} from "@/lib/db/transaction";
import { loadHostPayoutRule, multiplyPayoutUsd, payoutRuleFromConfig } from "./host-payout-rule";
import {
  encryptPrivateText,
  decryptPrivateText,
} from "@/lib/security/documents";
import type { SessionAccount } from "@/types/platform";

export class PayoutError extends Error {}
const fail = (message: string): never => {
  throw new PayoutError(message);
};
async function host(connection: PoolConnection, userId: string, lock = false) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT u.id,u.public_id,u.full_name,u.country_code,u.agency_account_id,
    COALESCE(u.agency_account_id,(SELECT a.id FROM platform_accounts a WHERE a.application_user_id=u.id AND a.role='AGENCY' AND a.status='ACTIVE' AND a.removed_at IS NULL LIMIT 1)) payout_agency_id
    FROM application_users u WHERE u.id=? AND u.account_status='ACTIVE' AND
    (EXISTS(SELECT 1 FROM host_profiles h WHERE h.application_user_id=u.id AND h.status='ACTIVE') OR EXISTS(SELECT 1 FROM platform_accounts a WHERE a.application_user_id=u.id AND a.role='AGENCY' AND a.status='ACTIVE' AND a.removed_at IS NULL)) ${lock ? "FOR UPDATE" : ""}`,
    [userId],
  );
  if (!rows[0])
    fail("Only an active Nazraa Host or Agency Owner can access Host payouts.");
  return rows[0];
}
async function audit(
  c: PoolConnection,
  actor: { userId?: string; account?: SessionAccount },
  action: string,
  targetId: string,
  data: unknown,
  reason: string,
) {
  await c.execute(
    `INSERT INTO audit_logs(id,actor_account_id,actor_role,action,module,target_type,target_id,new_data,reason) VALUES (?,?,?,?, 'HOST_PAYOUT','WITHDRAWAL',?,?,?)`,
    [
      randomUUID(),
      actor.account?.id ?? null,
      actor.account?.role ?? "HOST",
      action,
      targetId,
      JSON.stringify({
        actorUserId: actor.userId ?? null,
        ...(data as object),
      }),
      reason,
    ],
  );
}
export async function assertHostPayoutEligibility(userId: string) {
  return withTransaction(async (c) => {
    await host(c, userId);
  });
}
export async function saveHostPayoutAccount(
  userId: string,
  input: { type: "BANK" | "UPI"; displayName: string; destination: string },
  master?: SessionAccount,
) {
  if (master && master.role !== "MASTER")
    fail("Only Master may edit Host payout accounts.");
  const name = input.displayName.trim(),
    destination = input.destination.trim();
  if (
    name.length < 2 ||
    name.length > 120 ||
    destination.length < 4 ||
    destination.length > 190
  )
    fail("Enter valid beneficiary and payout account details.");
  if (
    input.type === "UPI" &&
    !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(destination)
  )
    fail("Enter a valid UPI ID.");
  const masked =
    input.type === "UPI"
      ? `${destination[0]}•••${destination.slice(destination.indexOf("@"))}`
      : `•••• ${destination.replace(/\s/g, "").slice(-4)}`;
  const encrypted = encryptPrivateText(destination),
    id = randomUUID();
  return withTransaction(async (c) => {
    await host(c, userId, true);
    // Version account edits instead of changing destinations on pending snapshots.
    await c.execute(
      "UPDATE payout_methods SET active=FALSE WHERE application_user_id=? AND method_type=?",
      [userId, input.type],
    );
    await c.execute(
      `INSERT INTO payout_methods(id,application_user_id,method_type,display_name,masked_destination,destination_encrypted,destination_iv,destination_tag) VALUES(?,?,?,?,?,?,?,?)`,
      [
        id,
        userId,
        input.type,
        name,
        masked,
        encrypted.encryptedData,
        encrypted.iv,
        encrypted.tag,
      ],
    );
    await audit(
      c,
      { userId, account: master },
      "PAYOUT_ACCOUNT_UPDATED",
      userId,
      { payoutMethodId: id, type: input.type },
      "Payout account version updated; private destination omitted from audit.",
    );
    return {
      id,
      type: input.type,
      displayName: name,
      maskedDestination: masked,
    };
  });
}
export async function requestHostPayout(
  userId: string,
  input: { amount: number; payoutMethodId: string; idempotencyKey: string },
) {
  if (
    !Number.isSafeInteger(input.amount) ||
    input.amount < 1 ||
    !/^[a-zA-Z0-9:_-]{16,100}$/.test(input.idempotencyKey)
  )
    fail("Choose a valid payout amount and request identity.");
  return withIdempotentTransaction(async (c) => {
    const h = await host(c, userId, true);
    const [previous] = await c.query<RowDataPacket[]>(
      "SELECT id,amount,payout_method_id,status,withdrawal_code FROM withdrawal_requests WHERE application_user_id=? AND request_idempotency_key=? FOR UPDATE",
      [userId, input.idempotencyKey],
    );
    if (previous[0]) {
      if (
        Number(previous[0].amount) !== input.amount ||
        previous[0].payout_method_id !== input.payoutMethodId
      )
        fail("This request identity was already used for a different payout.");
      return {
        id: String(previous[0].id),
        requestId: String(previous[0].withdrawal_code),
        status: String(previous[0].status),
        alreadyExisted: true,
      };
    }
    const rule = await loadHostPayoutRule(c),
      presentation = rule;
    if (input.amount < rule.slabDiamonds || input.amount % rule.slabDiamonds)
      fail(
        `Payouts must be exact ${rule.slabDiamonds.toLocaleString("en-IN")} Diamond multiples.`,
      );
    const slabs = input.amount / rule.slabDiamonds;
    const [methods] = await c.query<RowDataPacket[]>(
      "SELECT * FROM payout_methods WHERE id=? AND application_user_id=? AND active=TRUE AND method_type IN ('BANK','UPI') FOR UPDATE",
      [input.payoutMethodId, userId],
    );
    const method = methods[0];
    if (!method) fail("Choose one of your saved payout accounts.");
    const [wallets] = await c.query<RowDataPacket[]>(
      "SELECT * FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='DIAMOND' FOR UPDATE",
      [userId],
    );
    const wallet = wallets[0];
    if (!wallet || Number(wallet.available_balance) < input.amount)
      fail("You do not have enough available Diamonds for this payout.");
    const [agencies] = h.payout_agency_id
      ? await c.query<RowDataPacket[]>(
          "SELECT id,public_id,full_name FROM platform_accounts WHERE id=? AND role='AGENCY' AND status='ACTIVE' AND removed_at IS NULL",
          [h.payout_agency_id],
        )
      : [[] as RowDataPacket[]];
    const agency = agencies[0],
      id = randomUUID(),
      code = `HP-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const total = multiplyPayoutUsd(rule.totalUsd, slabs),
      hostUsd = multiplyPayoutUsd(rule.hostUsd, slabs),
      agencyUsd = multiplyPayoutUsd(agency ? rule.agencyUsd : "0.00", slabs),
      companyUsd = multiplyPayoutUsd(agency ? rule.companyUsd : payoutRuleFromConfig({diamondsPerBlock:rule.slabDiamonds,totalUsdPerBlock:rule.totalUsd,hostUsdPerBlock:rule.hostUsd,agencyUsdPerBlock:"0.00"}).companyUsd, slabs);
    await c.execute(
      "UPDATE wallet_balances SET available_balance=available_balance-?,reserved_balance=reserved_balance+? WHERE id=?",
      [input.amount, input.amount, wallet.id],
    );
    await c.execute(
      `INSERT INTO withdrawal_requests(id,withdrawal_code,application_user_id,agency_account_id,amount,net_payout,currency,payout_method_masked,payout_method_id,status,request_channel,request_idempotency_key) VALUES(?,?,?,?,?,?,'USD',?,?,'APPROVED','HOST_WEB',?)`,
      [
        id,
        code,
        userId,
        agency?.id ?? null,
        input.amount,
        hostUsd,
        method.masked_destination,
        method.id,
        input.idempotencyKey,
      ],
    );
    await c.execute(
      `INSERT INTO host_payout_snapshots(withdrawal_id,country_code,host_public_id,host_name,agency_account_id,agency_public_id,agency_name,slab_diamonds,rule_snapshot,total_usd,host_usd,agency_usd,company_usd,payout_type,payout_masked,payout_encrypted_data,payout_encryption_iv,payout_encryption_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        h.country_code ?? "",
        h.public_id,
        h.full_name,
        agency?.id ?? null,
        agency?.public_id ?? null,
        agency?.full_name ?? null,
        rule.slabDiamonds,
        JSON.stringify({
          ...presentation,
          payoutBeneficiaryName: String(method.display_name),
        }),
        total,
        hostUsd,
        agencyUsd,
        companyUsd,
        method.method_type,
        method.masked_destination,
        method.destination_encrypted,
        method.destination_iv,
        method.destination_tag,
      ],
    );
    await c.execute(
      `INSERT INTO ledger_transactions(id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,destination_id,amount,status,reason,metadata) VALUES(?,?,?,'DIAMOND','HOST_PAYOUT_RESERVED','APPLICATION_USER',?,'WITHDRAWAL_RESERVE',?,?,'COMPLETED','Host web payout automatically approved.',?)`,
      [
        randomUUID(),
        `RES-${id}`,
        `host-payout:${id}:reserve`,
        userId,
        id,
        input.amount,
        JSON.stringify({
          withdrawalId: id,
          availableBefore: Number(wallet.available_balance),
          availableAfter: Number(wallet.available_balance) - input.amount,
        }),
      ],
    );
    await audit(
      c,
      { userId },
      "HOST_PAYOUT_AUTO_APPROVED",
      id,
      { amount: input.amount, hostUsd, agencyUsd, companyUsd },
      "Request approved, not paid. Diamonds moved atomically to reserve.",
    );
    return { id, requestId: code, status: "APPROVED", alreadyExisted: false };
  });
}
export type PayoutViewer = { userId: string } | { account: SessionAccount };
export type PayoutFilters = {
  search?: string;
  agency?: string;
  agencyGroup?: string;
  country?: string;
  status?: string;
  from?: string;
  to?: string;
};
export function hostPayoutFilter(viewer: PayoutViewer, filters: PayoutFilters = {}) {
  const clauses = ["w.request_channel='HOST_WEB'"],
    values: (string | number)[] = [];
  if ("userId" in viewer) {
    clauses.push("w.application_user_id=?");
    values.push(viewer.userId);
  } else if (viewer.account.role === "AGENCY") {
    clauses.push("s.agency_account_id=?");
    values.push(viewer.account.id);
  } else if (viewer.account.role !== "MASTER")
    fail("This payout module is limited to Hosts, their Agency and Master.");
  if(filters.agencyGroup){
    if(filters.agencyGroup==='INDEPENDENT') clauses.push('s.agency_account_id IS NULL');
    else {clauses.push('s.agency_account_id=?');values.push(filters.agencyGroup);}
  }
  if (filters.search) {
    clauses.push(
      "(CAST(s.host_public_id AS CHAR)=? OR s.host_name LIKE ? OR w.withdrawal_code=?)",
    );
    values.push(filters.search, `%${filters.search}%`, filters.search);
  }
  if (filters.agency) {
    clauses.push(
      "(s.agency_account_id=? OR CAST(s.agency_public_id AS CHAR)=? OR s.agency_name LIKE ?)",
    );
    values.push(filters.agency, filters.agency, `%${filters.agency}%`);
  }
  if (filters.country) {
    clauses.push("s.country_code=?");
    values.push(filters.country);
  }
  if (filters.status) {
    clauses.push("w.status=?");
    values.push(filters.status);
  }
  // Input dates are business calendar days; convert IST boundaries in SQL, not device timezone.
  if (filters.from) {
    clauses.push(
      "w.requested_at >= DATE_SUB(CAST(? AS DATETIME),INTERVAL 330 MINUTE)",
    );
    values.push(filters.from);
  }
  if (filters.to) {
    clauses.push(
      "w.requested_at < DATE_SUB(DATE_ADD(CAST(? AS DATETIME),INTERVAL 1 DAY),INTERVAL 330 MINUTE)",
    );
    values.push(filters.to);
  }
  return { where: clauses.join(" AND "), values };
}
export async function listHostPayouts(
  viewer: PayoutViewer,
  filters: PayoutFilters = {},
  limit = 200,
  connection?: PoolConnection,
) {
  const f = hostPayoutFilter(viewer, filters);
  const [rows] = await (connection ?? db()).query<RowDataPacket[]>(
    `SELECT w.id,w.withdrawal_code requestId,w.application_user_id hostId,w.amount diamonds,w.status,w.requested_at requestedAt,w.provider_reference paymentReference,w.review_reason note,
    s.host_public_id hostPublicId,s.host_name hostName,s.agency_public_id agencyPublicId,s.agency_name agencyName,s.country_code country,s.host_usd hostUsd,s.agency_usd agencyUsd,s.company_usd companyUsd,s.payout_type payoutType,s.payout_masked payoutAccount,s.rule_snapshot rule,s.approved_at approvedAt,s.paid_at paidAt,s.reversed_at reversedAt,s.agency_paid_at agencyPaidAt,s.agency_reversed_at agencyReversedAt,s.agency_payment_reference agencyPaymentReference
    FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id WHERE ${f.where} ORDER BY w.requested_at DESC,w.id DESC LIMIT ?`,
    [...f.values, Math.min(10000, Math.max(1, limit))],
  );
  return rows.map((row) => {
    const r = { ...row };
    if (!("account" in viewer) || viewer.account.role !== "MASTER") {
      delete r.companyUsd;
      delete r.rule;
    }
    return r;
  });
}
export async function hostPayoutSummary(
  viewer: PayoutViewer,
  filters: PayoutFilters = {},
) {
  const f = hostPayoutFilter(viewer, filters);
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT COUNT(*) requests,COALESCE(SUM(s.host_usd),0) requestedUsd,
    COALESCE(SUM(IF(w.status='COMPLETED',s.host_usd,0)),0) paidUsd,
    COALESCE(SUM(IF(w.status IN ('APPROVED','PROCESSING'),s.host_usd,0)),0) awaitingUsd,
    SUM(w.status IN ('FAILED','REVERSED','CANCELLED')) failedOrReversed,
    COALESCE(SUM(IF(w.status IN ('APPROVED','PROCESSING','COMPLETED'),w.amount,0)),0) diamondsWithdrawn,
    COALESCE(SUM(IF(w.status IN ('APPROVED','PROCESSING','COMPLETED'),s.agency_usd,0)),0) agencyAccruedUsd,
    COALESCE(SUM(IF(s.agency_paid_at IS NOT NULL AND s.agency_reversed_at IS NULL,s.agency_usd,0)),0) agencyPaidUsd,
    COALESCE(SUM(IF(w.status='COMPLETED',s.company_usd,0)),0) companyRetainedUsd
    FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id WHERE ${f.where}`,
    [...f.values],
  );
  const r: Record<string, unknown> = {
    ...rows[0],
    agencyOutstandingUsd: Number(
      (
        Number(rows[0].agencyAccruedUsd) - Number(rows[0].agencyPaidUsd)
      ).toFixed(2),
    ),
  };
  if (!("account" in viewer) || viewer.account.role !== "MASTER")
    delete r.companyRetainedUsd;
  return r;
}
export async function hostPayoutPage(userId: string) {
  return withTransaction(async (c) => {
    const h = await host(c, userId),
      rule = await loadHostPayoutRule(c);
    const [wallet] = await c.query<RowDataPacket[]>(
      "SELECT available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='DIAMOND'",
      [userId],
    );
    const [accounts] = await c.query<RowDataPacket[]>(
      "SELECT id,method_type type,display_name displayName,masked_destination maskedDestination FROM payout_methods WHERE application_user_id=? AND active=TRUE",
      [userId],
    );
    const availableDiamonds = Number(wallet[0]?.available_balance ?? 0);
    return {
      host: { id: String(h.public_id), name: String(h.full_name) },
      availableDiamonds,
      rule: { slabDiamonds: rule.slabDiamonds, hostUsd: rule.hostUsd },
      estimatedHostUsd: multiplyPayoutUsd(rule.hostUsd,Math.floor(availableDiamonds/rule.slabDiamonds)),
      accounts,
      history: await listHostPayouts({ userId },{},200,c),
    };
  });
}
export async function payoutDestination(master: SessionAccount, id: string) {
  if (master.role !== "MASTER")
    fail("Only Master may view payout destinations.");
  return withTransaction(async (c) => {
    const [rows] = await c.query<RowDataPacket[]>(
      "SELECT payout_encrypted_data,payout_encryption_iv,payout_encryption_tag,JSON_UNQUOTE(JSON_EXTRACT(rule_snapshot,'$.payoutBeneficiaryName')) beneficiary FROM host_payout_snapshots WHERE withdrawal_id=?",
      [id],
    );
    if (!rows[0]) fail("Payout not found.");
    const r = rows[0];
    await audit(
      c,
      { account: master },
      "PAYOUT_DESTINATION_VIEWED",
      id,
      {},
      "Authorized private destination access.",
    );
    const destination = decryptPrivateText({
      encryptedData: r.payout_encrypted_data,
      iv: r.payout_encryption_iv,
      tag: r.payout_encryption_tag,
    });
    return `${r.beneficiary ? `Beneficiary: ${String(r.beneficiary)}\n` : ""}${destination}`;
  });
}
export async function manageHostPayout(
  master: SessionAccount,
  input: {
    id: string;
    action:
      | "paid"
      | "failed"
      | "reverse"
      | "note"
      | "agency-paid"
      | "agency-reverse";
    reason: string;
    reference?: string;
  },
) {
  if (master.role !== "MASTER") fail("Only Master can manage Host payouts.");
  if (input.reason.trim().length < 3 || input.reason.length > 500)
    fail("Provide an operational reason.");
  if (
    ["paid", "agency-paid"].includes(input.action) &&
    (input.reference?.trim().length ?? 0) < 3
  )
    fail("A payment reference is required.");
  return withTransaction(c=>applyHostPayoutAction(c,master,input));
}

async function applyHostPayoutAction(c:PoolConnection,master:SessionAccount,input:Parameters<typeof manageHostPayout>[1]):Promise<{status:string;alreadyExisted:boolean}> {

    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT w.*,s.paid_at,s.reversed_at,s.agency_paid_at,s.agency_reversed_at,s.agency_payment_reference,s.agency_usd FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id WHERE w.id=? AND w.request_channel='HOST_WEB' FOR UPDATE`,
      [input.id],
    );
    const r = rows[0];
    if (!r) fail("Host payout not found.");
    if (input.action === "note") {
      await c.execute(
        "UPDATE withdrawal_requests SET review_reason=?,provider_reference=COALESCE(?,provider_reference) WHERE id=?",
        [input.reason.trim(), input.reference?.trim() || null, r.id],
      );
    } else if (input.action === "agency-reverse") {
      if (!r.agency_paid_at) fail("Agency commission has not been paid.");
      if (r.agency_reversed_at)
        return { status: r.status, alreadyExisted: true };
      await c.execute(
        "UPDATE host_payout_snapshots SET agency_reversed_at=CURRENT_TIMESTAMP(3) WHERE withdrawal_id=?",
        [r.id],
      );
    } else if (input.action === "agency-paid") {
      if (r.status !== "COMPLETED" || Number(r.agency_usd) <= 0)
        fail(
          "Commission can be marked paid only on a paid Host payout with an Agency.",
        );
      if (r.agency_paid_at) {
        if (r.agency_payment_reference !== input.reference?.trim())
          fail("Agency commission was already paid with another reference.");
        return { status: r.status, alreadyExisted: true };
      }
      await c.execute(
        "UPDATE host_payout_snapshots SET agency_paid_at=CURRENT_TIMESTAMP(3),agency_payment_reference=? WHERE withdrawal_id=?",
        [input.reference!.trim(), r.id],
      );
    } else {
      const next =
        input.action === "paid"
          ? "COMPLETED"
          : input.action === "failed"
            ? "FAILED"
            : "REVERSED";
      if (r.status === next) {
        if (
          next === "COMPLETED" &&
          r.provider_reference !== input.reference?.trim()
        )
          fail("This payout was already paid with another reference.");
        return { status: next, alreadyExisted: true };
      }
      if (
        !(
          ["APPROVED", "PROCESSING"].includes(r.status) ||
          (input.action === "reverse" && r.status === "COMPLETED")
        )
      )
        fail("This payout cannot move to the requested status.");
      if (
        r.agency_paid_at &&
        !r.agency_reversed_at &&
        input.action === "reverse"
      )
        fail(
          "Agency commission has been paid. Record its payment reversal before reversing the Host payout.",
        );
      const [wallets] = await c.query<RowDataPacket[]>(
        "SELECT * FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='DIAMOND' FOR UPDATE",
        [r.application_user_id],
      );
      const w = wallets[0],
        amount = Number(r.amount),
        fromPaid = r.status === "COMPLETED";
      if (!w || (!fromPaid && Number(w.reserved_balance) < amount))
        fail("Reserved Diamonds need reconciliation before this operation.");
      const release = input.action !== "paid";
      await c.execute(
        "UPDATE wallet_balances SET available_balance=available_balance+?,reserved_balance=reserved_balance-? WHERE id=?",
        [release ? amount : 0, fromPaid ? 0 : amount, w.id],
      );
      await c.execute(
        `INSERT INTO ledger_transactions(id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,destination_id,amount,status,reason,actor_account_id,metadata) VALUES(?,?,?,'DIAMOND',?,?,?,?,?,?,'COMPLETED',?,?,?)`,
        [
          randomUUID(),
          `HP-${randomUUID()}`,
          `host-payout:${r.id}:${release ? "release" : "paid"}`,
          release ? "HOST_PAYOUT_REVERSED" : "WITHDRAWAL_PAID",
          fromPaid ? "PAYOUT_PROVIDER" : "WITHDRAWAL_RESERVE",
          r.id,
          release ? "APPLICATION_USER" : "PAYOUT_PROVIDER",
          release ? r.application_user_id : null,
          amount,
          input.reason.trim(),
          master.id,
          JSON.stringify({
            withdrawalId: r.id,
            previousStatus: r.status,
            nextStatus: next,
          }),
        ],
      );
      await c.execute(
        "UPDATE withdrawal_requests SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP(3),review_reason=?,provider_reference=COALESCE(?,provider_reference) WHERE id=?",
        [
          next,
          master.id,
          input.reason.trim(),
          input.reference?.trim() || null,
          r.id,
        ],
      );
      await c.execute(
        `UPDATE host_payout_snapshots SET ${release ? "reversed_at" : "paid_at"}=CURRENT_TIMESTAMP(3) WHERE withdrawal_id=?`,
        [r.id],
      );
      await c.execute(
        "INSERT INTO withdrawal_status_history(id,withdrawal_id,from_status,to_status,actor_account_id,reason) VALUES(?,?,?,?,?,?)",
        [randomUUID(), r.id, r.status, next, master.id, input.reason.trim()],
      );
    }
    await audit(
      c,
      { account: master },
      `HOST_PAYOUT_${input.action.toUpperCase()}`,
      r.id,
      {
        previousStatus: r.status,
        previousReference: r.provider_reference ?? null,
        previousNote: r.review_reason ?? null,
        reference: input.reference?.trim() ?? null,
        nextNote: input.reason.trim(),
      },
      input.reason.trim(),
    );
    return {
      status:
        input.action === "paid"
          ? "COMPLETED"
          : input.action === "failed"
            ? "FAILED"
            : input.action === "reverse"
              ? "REVERSED"
              : r.status,
      alreadyExisted: false,
    };
}

export async function manageAgencyPayoutBatch(master:SessionAccount,input:{agencyGroup:string;ids:string[];action:'paid'|'agency-paid';reference:string;reason:string}) {
  if(master.role!=='MASTER') fail('Only Master can settle Agency payouts.');
  const ids=[...new Set(input.ids)].sort();
  if(!ids.length||ids.length>100||ids.length!==input.ids.length||input.reason.trim().length<3||input.reason.length>500||input.reference.trim().length<3||input.reference.length>255) fail('Choose up to 100 distinct payout requests and supply a payment reference and reason.');
  return withTransaction(async c=>{
    const [rows]=await c.query<RowDataPacket[]>(`SELECT w.id,s.agency_account_id FROM withdrawal_requests w JOIN host_payout_snapshots s ON s.withdrawal_id=w.id
      WHERE w.request_channel='HOST_WEB' AND w.id IN (${ids.map(()=>'?').join(',')}) ORDER BY w.id FOR UPDATE`,ids);
    if(rows.length!==ids.length||rows.some(r=>(r.agency_account_id??'INDEPENDENT')!==input.agencyGroup)) fail('The selected requests do not all belong to this Agency. Refresh before payment.');
    let updated=0;
    for(const id of ids){
      const result=await applyHostPayoutAction(c,master,{id,action:input.action,reference:input.reference,reason:input.reason});
      if(!result.alreadyExisted) updated++;
    }
    if(updated) await audit(c,{account:master},'AGENCY_PAYOUT_BATCH_SETTLED',input.agencyGroup,{ids,action:input.action,reference:input.reference,updated},input.reason);
    return {updated,requests:ids.length,alreadyExisted:updated===0};
  });
}

export async function saveHostPayoutRule(master:SessionAccount,input:{slabDiamonds:number;totalUsd:string;hostUsd:string;agencyUsd:string;reason:string}) {
  if(master.role!=='MASTER') fail('Only Master may edit payout rules.');
  if(input.reason.trim().length<3||input.reason.length>500) fail('Provide an operational reason.');
  let value;
  try {value=payoutRuleFromConfig({diamondsPerBlock:input.slabDiamonds,totalUsdPerBlock:input.totalUsd,hostUsdPerBlock:input.hostUsd,agencyUsdPerBlock:input.agencyUsd});}
  catch {return fail('Check the Diamond block and decimal USD amounts. Total must cover Host + Agency.');}
  return withTransaction(async c=>{
    const [rows]=await c.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='withdrawal.economy' FOR UPDATE");
    const raw=rows[0]?(typeof rows[0].setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0].setting_value):{};
    const old=payoutRuleFromConfig(raw);
    const next={...raw,diamondsPerBlock:value.slabDiamonds,totalUsdPerBlock:value.totalUsd,hostUsdPerBlock:value.hostUsd,agencyUsdPerBlock:value.agencyUsd};
    await c.execute("INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('withdrawal.economy',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by)",[JSON.stringify(next),master.id]);
    await audit(c,{account:master},'HOST_PAYOUT_RULE_UPDATED',master.id,{previous:old,next:value},input.reason.trim());
    return value;
  });
}
