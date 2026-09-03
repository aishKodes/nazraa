-- Exact Face/Video reward cadence plus the single audited launch cleanup.
-- This migration is intentionally idempotent: the named reset marker prevents
-- any future deploy or manual retry from clearing newly earned balances.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.13',
  '$.latestBuild', 5323
)
WHERE setting_key = 'mobile.app_config';

UPDATE host_reward_rules
SET coins_per_hour = CASE WHEN room_type = 'PARTY' THEN 0 ELSE 3500 END,
    minimum_eligible_seconds = CASE WHEN room_type = 'PARTY' THEN minimum_eligible_seconds ELSE 3600 END
WHERE enabled = TRUE;

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Eligible Video/Face Live time earns 3,500 Diamonds for each completed continuous 60-minute block. Incomplete blocks earn 0. Party Audio earns 0.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;

CREATE TABLE IF NOT EXISTS administrative_balance_resets (
  reset_key VARCHAR(80) PRIMARY KEY,
  backup_reference VARCHAR(255) NOT NULL,
  affected_wallet_count INT UNSIGNED NOT NULL,
  coin_amount_cleared BIGINT UNSIGNED NOT NULL,
  diamond_amount_cleared BIGINT UNSIGNED NOT NULL,
  audit_log_id CHAR(36) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_administrative_balance_reset_audit (audit_log_id)
) ENGINE=InnoDB;

SET @nazraa_launch_reset_key := 'LAUNCH_BALANCE_RESET_2026_09_03';
SET @nazraa_launch_reset_done := (
  SELECT COUNT(*) FROM administrative_balance_resets WHERE reset_key = @nazraa_launch_reset_key
);
SET @nazraa_launch_reset_actor := (
  SELECT id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
);
SET @nazraa_launch_reset_wallets := (
  SELECT COUNT(*) FROM wallet_balances
  WHERE owner_type = 'APPLICATION_USER' AND asset_type IN ('COIN', 'DIAMOND') AND available_balance > 0
);
SET @nazraa_launch_reset_coins := (
  SELECT COALESCE(SUM(available_balance), 0) FROM wallet_balances
  WHERE owner_type = 'APPLICATION_USER' AND asset_type = 'COIN' AND available_balance > 0
);
SET @nazraa_launch_reset_diamonds := (
  SELECT COALESCE(SUM(available_balance), 0) FROM wallet_balances
  WHERE owner_type = 'APPLICATION_USER' AND asset_type = 'DIAMOND' AND available_balance > 0
);
SET @nazraa_launch_reset_audit := UUID();

INSERT INTO ledger_transactions
  (id, transaction_code, idempotency_key, asset_type, transaction_type,
   source_type, source_id, destination_type, destination_id, amount, status,
   reason, actor_account_id, metadata)
SELECT UUID(),
       CONCAT('LBR-', LEFT(REPLACE(wallet.id, '-', ''), 32), '-', LEFT(wallet.asset_type, 1)),
       CONCAT(@nazraa_launch_reset_key, ':', wallet.id),
       wallet.asset_type,
       'LAUNCH_BALANCE_RESET',
       'APPLICATION_USER', wallet.owner_id,
       'SYSTEM', NULL,
       wallet.available_balance,
       'COMPLETED',
       'One-time launch cleanup of invalid test currency; historical ledger preserved.',
       @nazraa_launch_reset_actor,
       JSON_OBJECT(
         'resetKey', @nazraa_launch_reset_key,
         'walletId', wallet.id,
         'ownerType', wallet.owner_type,
         'balanceBefore', wallet.available_balance,
         'balanceAfter', 0,
         'reservedBalancePreserved', wallet.reserved_balance,
         'backupReference', 'nazraa-production-pre-launch-reset-20260903-0945.ndjson'
       )
FROM wallet_balances wallet
WHERE @nazraa_launch_reset_done = 0
  AND wallet.owner_type = 'APPLICATION_USER'
  AND wallet.asset_type IN ('COIN', 'DIAMOND')
  AND wallet.available_balance > 0
ON DUPLICATE KEY UPDATE idempotency_key = VALUES(idempotency_key);

UPDATE wallet_balances
SET available_balance = 0
WHERE @nazraa_launch_reset_done = 0
  AND owner_type = 'APPLICATION_USER'
  AND asset_type IN ('COIN', 'DIAMOND')
  AND available_balance > 0;

INSERT INTO audit_logs
  (id, actor_account_id, actor_role, action, module, target_type, target_id,
   previous_data, new_data, reason)
SELECT @nazraa_launch_reset_audit,
       @nazraa_launch_reset_actor,
       'MASTER',
       'LAUNCH_BALANCE_RESET',
       'WALLET',
       'APPLICATION_USER_BALANCES',
       NULL,
       JSON_OBJECT(
         'affectedWallets', @nazraa_launch_reset_wallets,
         'coinAmount', @nazraa_launch_reset_coins,
         'diamondAmount', @nazraa_launch_reset_diamonds
       ),
       JSON_OBJECT('availableCoinBalance', 0, 'availableDiamondBalance', 0, 'ledgerPreserved', TRUE),
       'Authorized one-time launch cleanup after invalid game testing; verified backup captured first.'
WHERE @nazraa_launch_reset_done = 0;

INSERT INTO administrative_balance_resets
  (reset_key, backup_reference, affected_wallet_count, coin_amount_cleared,
   diamond_amount_cleared, audit_log_id)
SELECT @nazraa_launch_reset_key,
       'nazraa-production-pre-launch-reset-20260903-0945.ndjson',
       @nazraa_launch_reset_wallets,
       @nazraa_launch_reset_coins,
       @nazraa_launch_reset_diamonds,
       @nazraa_launch_reset_audit
WHERE @nazraa_launch_reset_done = 0;
