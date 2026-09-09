-- Privacy-safe client runtime diagnostics on the existing media heartbeat.
-- No access tokens, SDK payloads, message bodies, or raw error strings are
-- stored. This lets authorized operators distinguish transient reconnects,
-- terminal failures and overloaded effect queues for a specific room.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'connection_phase') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN connection_phase VARCHAR(24) NULL AFTER ended_at",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'reconnect_count') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN reconnect_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER connection_phase",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'publish_state') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN publish_state BOOLEAN NOT NULL DEFAULT FALSE AFTER reconnect_count",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'playback_state') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN playback_state BOOLEAN NOT NULL DEFAULT FALSE AFTER publish_state",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'last_terminal_error_category') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN last_terminal_error_category VARCHAR(64) NULL AFTER playback_state",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'active_speakers') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN active_speakers INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_terminal_error_category",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'passive_viewers') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN passive_viewers INT UNSIGNED NOT NULL DEFAULT 0 AFTER active_speakers",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'animation_queue_length') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN animation_queue_length INT UNSIGNED NOT NULL DEFAULT 0 AFTER passive_viewers",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'message_delivery_latency_ms') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN message_delivery_latency_ms INT UNSIGNED NULL AFTER animation_queue_length",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'diagnostics_updated_at') = 0,
  "ALTER TABLE live_media_usage ADD COLUMN diagnostics_updated_at DATETIME(3) NULL AFTER message_delivery_latency_ms, ADD INDEX idx_media_usage_diagnostics (room_id, diagnostics_updated_at)",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.33',
  '$.latestBuild', 5343
)
WHERE setting_key = 'mobile.app_config';
