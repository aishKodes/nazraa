import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';

const restoreType = 'HOST_MONTHLY_RESET_RESTORE';
const keyFor = (month, id) => `HOST_MONTH_RESET_RESTORE:${month}:${id}`;
const integer = value => BigInt(String(value));

/** Owner-approved compensation only. Never edits original financial history,
 * overwrites a current balance, touches Coins/reserves, or removes the reset's
 * monthly guard. All credits and their receipts commit together, exactly once. */
export async function restoreMonthlyHostDiamonds(connection, options) {
  const { month, apply = false, expectedUsers, expectedAmount } = options;
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) throw new Error('Invalid reset month');
  await connection.beginTransaction();
  try {
    const [markers] = await connection.execute(
      'SELECT reset_month, affected_users, expired_amount FROM monthly_host_earning_resets WHERE reset_month = ? FOR UPDATE', [month],
    );
    if (markers.length !== 1) throw new Error('Completed reset marker missing');
    const [originals] = await connection.execute(
      `SELECT id, source_id, amount FROM ledger_transactions
       WHERE transaction_type='HOST_MONTHLY_RESET' AND asset_type='DIAMOND'
         AND status='COMPLETED' AND source_type='APPLICATION_USER' AND destination_type='SYSTEM'
         AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.resetMonth'))=? ORDER BY source_id,id FOR UPDATE`, [month],
    );
    const users = new Set(originals.map(row => row.source_id));
    const total = originals.reduce((sum, row) => sum + integer(row.amount), 0n);
    if (users.size !== originals.length || originals.some(row => !row.source_id || integer(row.amount) <= 0n)) throw new Error('Invalid or duplicate original reset records');
    if (Number(markers[0].affected_users) !== users.size || integer(markers[0].expired_amount) !== total) throw new Error('Reset summary and financial ledger disagree');
    if (users.size !== Number(expectedUsers) || total !== integer(expectedAmount)) throw new Error('Approved restoration scope changed');
    if (originals.length === 0) throw new Error('No original reset deductions');
    const placeholders = originals.map(() => '?').join(',');
    const [receipts] = await connection.execute(
      `SELECT idempotency_key,asset_type,transaction_type,source_type,destination_type,destination_id,amount,status
       FROM ledger_transactions WHERE idempotency_key IN (${placeholders}) FOR UPDATE`,
      originals.map(row => keyFor(month, row.id)),
    );
    const prior = new Map(receipts.map(row => [row.idempotency_key, row]));
    const pending = originals.filter(row => {
      const receipt = prior.get(keyFor(month, row.id));
      if (!receipt) return true;
      if (receipt.asset_type !== 'DIAMOND' || receipt.transaction_type !== restoreType || receipt.source_type !== 'SYSTEM'
        || receipt.destination_type !== 'APPLICATION_USER' || receipt.destination_id !== row.source_id
        || receipt.status !== 'COMPLETED' || integer(receipt.amount) !== integer(row.amount)) throw new Error('Existing restoration receipt does not match original');
      return false;
    });
    const pendingAmount = pending.reduce((sum, row) => sum + integer(row.amount), 0n);
    const report = { month, originalUsers: users.size, originalAmount: total.toString(), pendingUsers: pending.length,
      pendingAmount: pendingAmount.toString(), alreadyRestoredUsers: receipts.length, coinsTouched: false, reservesTouched: false };
    const [wallets] = await connection.execute(
      `SELECT id,owner_id,available_balance,reserved_balance FROM wallet_balances
       WHERE owner_type='APPLICATION_USER' AND asset_type='DIAMOND' AND owner_id IN (${placeholders}) ORDER BY id FOR UPDATE`,
      originals.map(row => row.source_id),
    );
    if (wallets.length !== users.size) throw new Error('An affected Diamond wallet is missing');
    const walletByUser = new Map(wallets.map(row => [row.owner_id, row]));
    for (const row of pending) {
      const wallet = walletByUser.get(row.source_id);
      const after = integer(wallet.available_balance) + integer(row.amount);
      if (integer(wallet.available_balance) < 0n || integer(wallet.reserved_balance) < 0n || after > 9223372036854775807n) throw new Error('Unsafe wallet value');
    }
    if (!apply) {
      await connection.rollback();
      return { ...report, status: 'dry_run' };
    }
    for (const row of pending) {
      const wallet = walletByUser.get(row.source_id);
      const before = integer(wallet.available_balance);
      const after = before + integer(row.amount);
      await connection.execute(
        `INSERT INTO ledger_transactions
         (id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,destination_type,destination_id,amount,status,reason,metadata)
         VALUES (?,?,?,'DIAMOND',?,'SYSTEM','APPLICATION_USER',?,?,'COMPLETED',?,?)`,
        [randomUUID(), `HMRR-${month.replaceAll('-', '')}-${row.id.replaceAll('-', '')}`, keyFor(month, row.id), restoreType,
          row.source_id, String(row.amount), 'Owner-approved exception: restore this month-start Diamond reset',
          JSON.stringify({ resetMonth: month, originalResetLedgerId: row.id, availableBefore: before.toString(), availableAfter: after.toString(), reservedBalanceUnchanged: String(wallet.reserved_balance) })],
      );
      const [updated] = await connection.execute(
        `UPDATE wallet_balances SET available_balance=available_balance+?
         WHERE id=? AND owner_type='APPLICATION_USER' AND asset_type='DIAMOND' AND available_balance=? AND reserved_balance=?`,
        [String(row.amount), wallet.id, before.toString(), String(wallet.reserved_balance)],
      );
      if (updated.affectedRows !== 1) throw new Error('Wallet changed unexpectedly');
      const [verified] = await connection.execute('SELECT available_balance,reserved_balance FROM wallet_balances WHERE id=?', [wallet.id]);
      if (integer(verified[0].available_balance) !== after || integer(verified[0].reserved_balance) !== integer(wallet.reserved_balance)) throw new Error('Credit verification failed');
    }
    if (pending.length) await connection.execute(
      `INSERT INTO audit_logs (id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
       VALUES (?,'OWNER_AUTHORIZED','wallet.monthly_reset_restore','economy','monthly_host_earning_reset',?,?,?,?)`,
      [randomUUID(), month, JSON.stringify({ removedUsers: users.size, removedDiamonds: total.toString() }),
        JSON.stringify({ restoredUsers: pending.length, restoredDiamonds: pendingAmount.toString(), preservedResetGuard: true, coinsTouched: false, reservesTouched: false }),
        'Owner explicitly requested reversing the reset earlier today; preserve later earnings/spending and future monthly rule'],
    );
    await connection.commit();
    return { ...report, status: pending.length ? 'restored' : 'already_restored' };
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  if (!args.includes('--month') || !args.includes('--expected-users') || !args.includes('--expected-amount')) throw new Error('Explicit approved month, user count and amount required');
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z', connectTimeout: 5000 });
  try {
    console.log(JSON.stringify(await restoreMonthlyHostDiamonds(connection, { month: value('--month'), apply: args.includes('--apply'),
      expectedUsers: value('--expected-users'), expectedAmount: value('--expected-amount') })));
  } finally { await connection.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Restoration stopped; transaction rolled back: ${error.code || error.message}`); process.exitCode = 1; });
}
