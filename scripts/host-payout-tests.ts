import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import type { Connection, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import type { SessionAccount } from "@/types/platform";
import * as payout from "@/lib/db/repositories/host-payouts";
import { defaultWithdrawalEconomy } from "@/lib/db/repositories/withdrawal-economy";
export async function verifyHostPayouts(
  root: Connection,
  user: (name: string) => Promise<MobileIdentity>,
  master: SessionAccount,
  agency: SessionAccount,
) {
  const h = await user("QA web Host payout");
  await root.execute(
    "UPDATE application_users SET agency_account_id=? WHERE id=?",
    [agency.id, h.userId],
  );
  await root.execute(
    "INSERT INTO wallet_balances(id,owner_type,owner_id,asset_type,available_balance) VALUES(?,'APPLICATION_USER',?,'DIAMOND',625000)",
    [randomUUID(), h.userId],
  );
  const rule = { ...defaultWithdrawalEconomy, slabDiamonds: 125000 };
  await root.execute(
    "INSERT INTO system_settings(setting_key,setting_value,updated_by) VALUES('withdrawal.economy',?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
    [JSON.stringify(rule), master.id],
  );
  const a = await payout.saveHostPayoutAccount(h.userId, {
    type: "UPI",
    displayName: "QA Host",
    destination: "qa-host@bank",
  });
  const input = {
    amount: 125000,
    payoutMethodId: a.id,
    idempotencyKey: randomUUID(),
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () => payout.requestHostPayout(h.userId, input)),
  );
  assert.equal(new Set(results.map((r) => r.id)).size, 1);
  assert.ok(results.every((r) => r.status === "APPROVED"));
  const id = results[0].id;
  async function wallet() {
    const [w] = await root.query<RowDataPacket[]>(
      "SELECT available_balance,reserved_balance FROM wallet_balances WHERE owner_id=? AND asset_type='DIAMOND'",
      [h.userId],
    );
    return [Number(w[0].available_balance), Number(w[0].reserved_balance)];
  }
  assert.deepEqual(await wallet(), [500000, 125000]);
  const rows = await payout.listHostPayouts({ userId: h.userId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hostUsd, 8);
  assert.equal(rows[0].agencyUsd, 1);
  assert.equal("companyUsd" in rows[0], false);
  const masterRows = await payout.listHostPayouts({ account: master });
  assert.equal(Number(masterRows.find((r) => r.id === id)?.companyUsd), 2.7);
  assert.equal((await payout.listHostPayouts({ account: agency })).length, 1);
  const other = { ...agency, id: randomUUID() };
  assert.equal((await payout.listHostPayouts({ account: other })).length, 0);
  for (const role of [
    "ADMIN",
    "SUPER_ADMIN",
    "COUNTRY_MANAGER",
    "BD",
    "MONITORING_CS",
    "COIN_SELLER",
  ] as const) {
    await assert.rejects(
      payout.listHostPayouts({ account: { ...master, role } }),
    );
    await assert.rejects(
      payout.manageHostPayout(
        { ...master, role },
        { id, action: "paid", reason: "QA denied", reference: "QA-NO" },
      ),
    );
  }
  await assert.rejects(
    payout.requestHostPayout(h.userId, { ...input, amount: 250000 }),
    /different payout/,
  );
  await assert.rejects(
    payout.requestHostPayout(h.userId, {
      ...input,
      amount: 100000,
      idempotencyKey: randomUUID(),
    }),
    /1,25,000/,
  );
  await assert.rejects(
    payout.requestHostPayout(h.userId, {
      ...input,
      amount: 750000,
      idempotencyKey: randomUUID(),
    }),
    /enough/,
  );
  const intruder = await user("QA payout intruder");
  await assert.rejects(
    payout.requestHostPayout(intruder.userId, {
      ...input,
      idempotencyKey: randomUUID(),
    }),
    /saved payout/,
  );
  const future = await payout.saveHostPayoutAccount(h.userId, {
    type: "UPI",
    displayName: "QA New Host",
    destination: "qa-new@bank",
  });
  assert.equal(await payout.payoutDestination(master, id), "qa-host@bank");
  await payout.saveHostPayoutRule(master, {
    slabDiamonds: 125000,
    totalUsd: "12.00",
    hostUsd: "8.25",
    agencyUsd: "1.10",
    reason: "QA future rates only",
  });
  await payout.manageHostPayout(master, {
    id,
    action: "paid",
    reference: "QA-PAID-001",
    reason: "QA provider paid",
  });
  await payout.manageHostPayout(master, {
    id,
    action: "paid",
    reference: "QA-PAID-001",
    reason: "QA retry",
  });
  assert.deepEqual(await wallet(), [500000, 0]);
  const paidRows = await payout.listHostPayouts({ account: master });
  assert.equal(
    Number(paidRows.find((r) => r.id === id)?.hostUsd),
    8,
    "snapshot must not reprice after rule edit",
  );
  const summary = await payout.hostPayoutSummary({ account: master });
  assert.equal(Number(summary.paidUsd), 8);
  assert.equal(Number(summary.agencyAccruedUsd), 1);
  await payout.manageHostPayout(master, {
    id,
    action: "reverse",
    reason: "QA failed transfer reversal",
  });
  await payout.manageHostPayout(master, {
    id,
    action: "reverse",
    reason: "QA reversal retry",
  });
  assert.deepEqual(await wallet(), [625000, 0]);
  const failReq = await payout.requestHostPayout(h.userId, {
    amount: 125000,
    payoutMethodId: future.id,
    idempotencyKey: randomUUID(),
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      payout.manageHostPayout(master, {
        id: failReq.id,
        action: "failed",
        reason: "QA provider failure",
      }),
    ),
  );
  assert.deepEqual(await wallet(), [625000, 0]);
  const commission = await payout.requestHostPayout(h.userId, {
    amount: 125000,
    payoutMethodId: future.id,
    idempotencyKey: randomUUID(),
  });
  await assert.rejects(
    payout.manageHostPayout(master, {
      id: commission.id,
      action: "agency-paid",
      reference: "QA-A",
      reason: "QA not yet paid",
    }),
  );
  await payout.manageHostPayout(master, {
    id: commission.id,
    action: "paid",
    reference: "QA-PAID-002",
    reason: "QA paid",
  });
  await payout.manageHostPayout(master, {
    id: commission.id,
    action: "agency-paid",
    reference: "QA-AGENCY-002",
    reason: "QA paid Agency",
  });
  const after = await payout.hostPayoutSummary({ account: agency });
  assert.equal(Number(after.agencyPaidUsd), 1.1);
  await assert.rejects(payout.manageHostPayout(master,{id:commission.id,action:'reverse',reason:'QA return blocked until Agency reconciled'}),/Agency commission has been paid/);
  await payout.manageHostPayout(master,{id:commission.id,action:'agency-reverse',reason:'QA Agency payment returned'});
  await payout.manageHostPayout(master,{id:commission.id,action:'reverse',reason:'QA returned Host payment'});
  assert.deepEqual(await wallet(),[625000,0]);
  assert.equal(Number((await payout.hostPayoutSummary({account:agency})).agencyPaidUsd),0);
  const [distributions] = await root.query<RowDataPacket[]>(
    "SELECT * FROM withdrawal_distribution_snapshots WHERE withdrawal_id IN (?,?,?)",
    [id, failReq.id, commission.id],
  );
  assert.equal(
    distributions.length,
    0,
    "new workflow must never create other-role allocations",
  );
  const [ledgers] = await root.query<RowDataPacket[]>(
    "SELECT idempotency_key,COUNT(*) count FROM ledger_transactions WHERE idempotency_key LIKE 'host-payout:%' GROUP BY idempotency_key",
  );
  assert.ok(ledgers.every((l) => Number(l.count) === 1));
  const [audit] = await root.query<RowDataPacket[]>(
    "SELECT COUNT(*) count FROM audit_logs WHERE module='HOST_PAYOUT'",
  );
  assert.ok(Number(audit[0].count) >= 12);
  await root.execute(
    "UPDATE system_settings SET setting_value=? WHERE setting_key='withdrawal.economy'",
    [JSON.stringify(defaultWithdrawalEconomy)],
  );
  console.log(
    "PASS Host web payout: eight concurrent retries reserve once; auto-approved, scope denial, exact rates, immutable account/rate snapshot, paid, failed, exact-once reversal, Agency paid/outstanding, USD fractions, no other-role allocations, audited Master actions; mobile cash-out remains OFF.",
  );
}
