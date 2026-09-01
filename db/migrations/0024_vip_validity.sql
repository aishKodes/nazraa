-- Configurable VIP validity with server-authoritative expiry.

SET @nazraa_schema = DATABASE();
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'vip_tiers' AND COLUMN_NAME = 'validity_days') = 0,
  'ALTER TABLE vip_tiers ADD COLUMN validity_days SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER daily_reward_coins', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'application_users' AND COLUMN_NAME = 'vip_expires_at') = 0,
  'ALTER TABLE application_users ADD COLUMN vip_expires_at DATETIME(3) NULL AFTER vip_tier', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'vip_purchases' AND COLUMN_NAME = 'expires_at') = 0,
  'ALTER TABLE vip_purchases ADD COLUMN expires_at DATETIME(3) NULL AFTER ledger_transaction_id', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE vip_tiers SET validity_days = 30 WHERE validity_days IS NULL OR validity_days = 0;

-- Preserve existing paid tiers by starting their first explicit validity
-- window from deployment rather than expiring them retroactively.
UPDATE application_users
SET vip_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
WHERE vip_tier > 0 AND vip_expires_at IS NULL;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion',
  '2.4.3'
)
WHERE setting_key = 'mobile.app_config';
