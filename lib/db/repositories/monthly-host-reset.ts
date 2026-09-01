import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { withTransaction } from "@/lib/db/transaction";
import { db, withDatabaseReadRetry } from "@/lib/db/pool";

let monthlyResetSchemaReady = false;

function indiaDateParts(now = new Date()) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

/**
 * Expires only available Host/Agency DIAMOND earnings on the first calendar
 * day in India. Reserved balances for pending withdrawals are never touched.
 * The month row and every ledger key make the operation safe to call more
 * than once from both cron and mobile bootstrap.
 */
export async function runMonthlyHostEarningsReset(now = new Date()) {
  const india = indiaDateParts(now);
  const resetMonth = `${india.year}-${india.month}-01`;
  const resetCode = `${india.year}${india.month}01`;
  if (india.day !== "01") return { resetMonth, status: "not_due", affectedUsers: 0, expiredAmount: 0 };

  // This idempotent guard also lets a newly deployed runtime become healthy
  // if Hostinger was temporarily unavailable during an explicit migration.
  if (!monthlyResetSchemaReady) {
    await withDatabaseReadRetry(() => db().execute(
      `CREATE TABLE IF NOT EXISTS monthly_host_earning_resets (
         reset_month DATE PRIMARY KEY,
         affected_users INT NOT NULL DEFAULT 0,
         expired_amount BIGINT NOT NULL DEFAULT 0,
         completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB`,
    ));
    monthlyResetSchemaReady = true;
  }

  return withTransaction(async (connection) => {
    const [claim] = await connection.execute<ResultSetHeader>(
      "INSERT IGNORE INTO monthly_host_earning_resets (reset_month) VALUES (?)",
      [resetMonth],
    );
    if (claim.affectedRows === 0) {
      const [existingRows] = await connection.query<(RowDataPacket & { affected_users: number; expired_amount: number })[]>(
        "SELECT affected_users, expired_amount FROM monthly_host_earning_resets WHERE reset_month = ? LIMIT 1",
        [resetMonth],
      );
      return {
        resetMonth,
        status: "already_completed",
        affectedUsers: Number(existingRows[0]?.affected_users ?? 0),
        expiredAmount: Number(existingRows[0]?.expired_amount ?? 0),
      };
    }

    const [summaryRows] = await connection.query<(RowDataPacket & { affected_users: number; expired_amount: number })[]>(
      `SELECT COUNT(*) affected_users, COALESCE(SUM(wallet.available_balance), 0) expired_amount
       FROM wallet_balances wallet
       WHERE wallet.owner_type = 'APPLICATION_USER' AND wallet.asset_type = 'DIAMOND'
         AND wallet.available_balance > 0
         AND (
           EXISTS (SELECT 1 FROM host_profiles host WHERE host.application_user_id = wallet.owner_id)
           OR EXISTS (SELECT 1 FROM platform_accounts agency WHERE agency.application_user_id = wallet.owner_id AND agency.role = 'AGENCY')
         )
       FOR UPDATE`,
    );
    const affectedUsers = Number(summaryRows[0]?.affected_users ?? 0);
    const expiredAmount = Number(summaryRows[0]?.expired_amount ?? 0);

    await connection.execute(
      `INSERT IGNORE INTO ledger_transactions
       (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, source_id, destination_type, amount, status, reason, metadata)
       SELECT UUID(), CONCAT('HMR-', ?, '-', user.public_id), CONCAT('HOST_MONTH_RESET:', ?, ':', wallet.owner_id),
              'DIAMOND', 'HOST_MONTHLY_RESET', 'APPLICATION_USER', wallet.owner_id, 'SYSTEM', wallet.available_balance,
              'COMPLETED', 'Monthly Host/Agency earnings balance reset', JSON_OBJECT('resetMonth', ?)
       FROM wallet_balances wallet
       INNER JOIN application_users user ON user.id = wallet.owner_id
       WHERE wallet.owner_type = 'APPLICATION_USER' AND wallet.asset_type = 'DIAMOND' AND wallet.available_balance > 0
         AND (
           EXISTS (SELECT 1 FROM host_profiles host WHERE host.application_user_id = wallet.owner_id)
           OR EXISTS (SELECT 1 FROM platform_accounts agency WHERE agency.application_user_id = wallet.owner_id AND agency.role = 'AGENCY')
         )`,
      [resetCode, resetMonth, resetMonth],
    );
    await connection.execute(
      `UPDATE wallet_balances wallet
       SET wallet.available_balance = 0
       WHERE wallet.owner_type = 'APPLICATION_USER' AND wallet.asset_type = 'DIAMOND' AND wallet.available_balance > 0
         AND (
           EXISTS (SELECT 1 FROM host_profiles host WHERE host.application_user_id = wallet.owner_id)
           OR EXISTS (SELECT 1 FROM platform_accounts agency WHERE agency.application_user_id = wallet.owner_id AND agency.role = 'AGENCY')
         )`,
    );
    await connection.execute(
      "UPDATE monthly_host_earning_resets SET affected_users = ?, expired_amount = ?, completed_at = CURRENT_TIMESTAMP(3) WHERE reset_month = ?",
      [affectedUsers, expiredAmount, resetMonth],
    );
    return { resetMonth, status: "completed", affectedUsers, expiredAmount };
  });
}
