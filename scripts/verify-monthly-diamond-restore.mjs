import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { restoreMonthlyHostDiamonds } from './restore-monthly-host-diamonds.mjs';

const database = `nazraa_restore_qa_${Date.now()}`;
const root = await mysql.createConnection({ host: '127.0.0.1', user: 'root', supportBigNumbers: true, bigNumberStrings: true });
const connections = [];
try {
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`USE \`${database}\``);
  const schema = await readFile('db/migrations/0001_initial.sql', 'utf8');
  for (const table of ['platform_accounts', 'wallet_balances', 'ledger_transactions', 'audit_logs']) {
    const definition = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]+?\\) ENGINE=InnoDB;`));
    assert.ok(definition, `Existing authoritative schema ${table}`);
    await root.query(definition[0]);
  }
  await root.query(await readFile('db/migrations/0020_reliability_and_monthly_host_reset.sql', 'utf8'));
  const month = '2026-10-01';
  const users = [randomUUID(), randomUUID()];
  const amounts = [350n, 700n];
  const balances = [270n, 25n]; // Realistic earnings/spending AFTER the reset.
  for (let index = 0; index < users.length; index++) {
    await root.execute(`INSERT INTO wallet_balances (id,owner_type,owner_id,asset_type,available_balance,reserved_balance)
      VALUES (?,'APPLICATION_USER',?,'DIAMOND',?,50),(?,'APPLICATION_USER',?,'COIN',1234,9)`,
      [randomUUID(), users[index], balances[index].toString(), randomUUID(), users[index]]);
    await root.execute(`INSERT INTO ledger_transactions (id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,source_id,destination_type,amount,status,metadata)
      VALUES (?,?,?,'DIAMOND','HOST_MONTHLY_RESET','APPLICATION_USER',?,'SYSTEM',?,'COMPLETED',?)`,
      [randomUUID(), `TEST-RESET-${index}`, `TEST-RESET:${index}`, users[index], amounts[index].toString(), JSON.stringify({ resetMonth: month })]);
  }
  await root.execute(`INSERT INTO monthly_host_earning_resets (reset_month,affected_users,expired_amount) VALUES (?,2,1050)`, [month]);
  const options = { month, expectedUsers: 2, expectedAmount: '1050' };
  const originalSnapshot = async () => {
    const [rows] = await root.query(`SELECT id,transaction_code,idempotency_key,amount,status FROM ledger_transactions WHERE transaction_type='HOST_MONTHLY_RESET' ORDER BY id`);
    return JSON.stringify(rows);
  };
  const originals = await originalSnapshot();
  assert.equal((await restoreMonthlyHostDiamonds(root, options)).status, 'dry_run');
  await assert.rejects(restoreMonthlyHostDiamonds(root, { ...options, apply: true, expectedAmount: '1051' }), /scope changed/);
  // Fail the second user's wallet update after one credit has been attempted.
  // Every wallet, receipt and audit must roll back together.
  const secondProcessedUser = [...users].sort()[1];
  await root.query(`CREATE TRIGGER qa_restore_failure BEFORE UPDATE ON wallet_balances FOR EACH ROW
    BEGIN IF NEW.owner_id='${secondProcessedUser}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated QA injected failure'; END IF; END`);
  await assert.rejects(restoreMonthlyHostDiamonds(root, { ...options, apply: true }));
  const [failedReceipts] = await root.query(`SELECT COUNT(*) total FROM ledger_transactions WHERE transaction_type='HOST_MONTHLY_RESET_RESTORE'`);
  assert.equal(Number(failedReceipts[0].total), 0);
  for (let index = 0; index < users.length; index++) {
    const [rows] = await root.execute(`SELECT available_balance FROM wallet_balances WHERE owner_id=? AND asset_type='DIAMOND'`, [users[index]]);
    assert.equal(BigInt(rows[0].available_balance), balances[index]);
  }
  await root.query('DROP TRIGGER qa_restore_failure');
  for (let index = 0; index < 2; index++) connections.push(await mysql.createConnection({ host: '127.0.0.1', user: 'root', database, supportBigNumbers: true, bigNumberStrings: true }));
  const concurrent = await Promise.all(connections.map(connection => restoreMonthlyHostDiamonds(connection, { ...options, apply: true })));
  assert.deepEqual(concurrent.map(result => result.status).sort(), ['already_restored', 'restored']);
  assert.equal((await restoreMonthlyHostDiamonds(root, { ...options, apply: true })).status, 'already_restored');
  for (let index = 0; index < users.length; index++) {
    const [rows] = await root.execute(`SELECT asset_type,available_balance,reserved_balance FROM wallet_balances WHERE owner_id=? ORDER BY asset_type`, [users[index]]);
    assert.deepEqual(rows.map(row => [row.asset_type, BigInt(row.available_balance), BigInt(row.reserved_balance)]),
      [['COIN', 1234n, 9n], ['DIAMOND', balances[index] + amounts[index], 50n]]);
  }
  assert.equal(await originalSnapshot(), originals, 'Original reset ledger immutable');
  const [counts] = await root.query(`SELECT (SELECT COUNT(*) FROM ledger_transactions WHERE transaction_type='HOST_MONTHLY_RESET_RESTORE') receipts,
    (SELECT COUNT(*) FROM audit_logs WHERE action='wallet.monthly_reset_restore') audits,
    (SELECT COUNT(*) FROM monthly_host_earning_resets WHERE reset_month='2026-10-01') reset_guards`);
  assert.deepEqual([Number(counts[0].receipts), Number(counts[0].audits), Number(counts[0].reset_guards)], [2, 1, 1]);
  console.log('PASS: exact additive restoration, later earnings/spending preserved, Coins/reserves unchanged, original ledger retained, scoped dry-run, mismatched scope rejected, full failure rollback, concurrent/repeated once-only credits, monthly reset guard retained');
} finally {
  for (const connection of connections) await connection.end();
  if (!/^nazraa_restore_qa_\d+$/.test(database)) throw new Error('Unsafe test cleanup target');
  await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await root.end();
}
