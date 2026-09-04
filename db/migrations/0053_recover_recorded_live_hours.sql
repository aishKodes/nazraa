-- Recover only provable completed hours from launch-day sessions that the old
-- stale-room pruner incorrectly marked VOID. Never infer time from wall-clock
-- duration or combine unfinished disconnected segments. Normal paid amounts
-- are subtracted, and the recovery ledger key makes reruns harmless.
CREATE TEMPORARY TABLE launch_live_recovery (
  accounting_id CHAR(36) PRIMARY KEY,
  host_id CHAR(36) NOT NULL,
  ledger_id CHAR(36) NOT NULL,
  eligible_seconds INT UNSIGNED NOT NULL,
  total_reward BIGINT NOT NULL,
  reward_due BIGINT NOT NULL
) ENGINE=InnoDB;

INSERT INTO launch_live_recovery
SELECT accounting.id, accounting.host_application_user_id, UUID(),
       (FLOOR(accounting.eligible_duration_seconds / 3600) + FLOOR(accounting.media_segment_seconds / 3600)) * 3600,
       (FLOOR(accounting.eligible_duration_seconds / 3600) + FLOOR(accounting.media_segment_seconds / 3600)) * rule.coins_per_hour,
       CAST((FLOOR(accounting.eligible_duration_seconds / 3600) + FLOOR(accounting.media_segment_seconds / 3600)) * rule.coins_per_hour AS SIGNED) - CAST(accounting.reward_coins AS SIGNED)
FROM live_session_accounting accounting
INNER JOIN host_reward_rules rule ON rule.id = accounting.reward_rule_id
INNER JOIN live_rooms room ON room.id = accounting.room_id
WHERE accounting.status = 'VOID' AND room.status = 'ENDED'
  AND accounting.room_type IN ('FACE', 'LIVE')
  AND accounting.started_at >= '2026-09-03 00:00:00'
  AND accounting.started_at < '2026-09-05 00:00:00'
  AND (FLOOR(accounting.eligible_duration_seconds / 3600) + FLOOR(accounting.media_segment_seconds / 3600)) * 3600 >= GREATEST(3600, rule.minimum_eligible_seconds)
  AND (FLOOR(accounting.eligible_duration_seconds / 3600) + FLOOR(accounting.media_segment_seconds / 3600)) * rule.coins_per_hour > accounting.reward_coins
  AND NOT EXISTS (SELECT 1 FROM ledger_transactions ledger WHERE ledger.idempotency_key = CONCAT('HOST-RECOVERY:20260904:', accounting.id));

INSERT INTO ledger_transactions
  (id, transaction_code, idempotency_key, asset_type, transaction_type, source_type, destination_type, destination_id, amount, status, reason, metadata)
SELECT ledger_id, CONCAT('HST-REC-', ledger_id), CONCAT('HOST-RECOVERY:20260904:', accounting_id),
       'DIAMOND', 'HOST_HOURLY_DIAMONDS', 'SYSTEM', 'APPLICATION_USER', host_id, reward_due, 'COMPLETED',
       'Recovered recorded completed Live hours omitted by stale-room cleanup',
       JSON_OBJECT('accountingId', accounting_id, 'recovery', 'launch-20260904', 'eligibleSeconds', eligible_seconds)
FROM launch_live_recovery;

INSERT INTO wallet_balances (id, owner_type, owner_id, asset_type, available_balance)
SELECT UUID(), 'APPLICATION_USER', host_id, 'DIAMOND', SUM(reward_due)
FROM launch_live_recovery GROUP BY host_id
ON DUPLICATE KEY UPDATE available_balance = available_balance + VALUES(available_balance);

UPDATE live_session_accounting accounting
INNER JOIN launch_live_recovery recovery ON recovery.accounting_id = accounting.id
SET accounting.status = 'FINALIZED', accounting.finalized_at = CURRENT_TIMESTAMP(3),
    accounting.eligible_duration_seconds = recovery.eligible_seconds,
    accounting.valid_duration_seconds = GREATEST(accounting.valid_media_seconds, recovery.eligible_seconds),
    accounting.media_segment_seconds = 0, accounting.media_publishing = FALSE,
    accounting.reward_coins = recovery.total_reward, accounting.reward_ledger_id = recovery.ledger_id;

INSERT INTO mobile_notifications (id, application_user_id, notification_type, title, message, action_target)
SELECT UUID(), host_id, 'HOST_REWARD', 'Live reward recovered',
       CONCAT(SUM(reward_due), ' Diamonds credited for previously recorded completed Live hours.'), 'wallet/rewards'
FROM launch_live_recovery GROUP BY host_id;

DROP TEMPORARY TABLE launch_live_recovery;
