-- One durable, server-timed source for Host publishing duration and the
-- claimable Live-reward threshold.  This extends the existing accounting
-- record; it neither changes Live eligibility/economy nor creates a second
-- wallet or room lifecycle.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'eligible_seconds_committed') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN eligible_seconds_committed INT UNSIGNED NOT NULL DEFAULT 0 AFTER eligible_duration_seconds',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'current_publish_started_at') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN current_publish_started_at DATETIME(3) NULL AFTER media_publishing',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'last_heartbeat_at') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN last_heartbeat_at DATETIME(3) NULL AFTER last_media_heartbeat_at',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'last_media_evidence_at') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN last_media_evidence_at DATETIME(3) NULL AFTER last_heartbeat_at',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'reconnect_state') = 0,
  "ALTER TABLE live_session_accounting ADD COLUMN reconnect_state VARCHAR(24) NOT NULL DEFAULT 'STARTING' AFTER last_media_evidence_at",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'reconnect_segments') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN reconnect_segments JSON NULL AFTER reconnect_state',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'reward_units_generated') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN reward_units_generated INT UNSIGNED NOT NULL DEFAULT 0 AFTER reward_coins',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'accounting_accuracy') = 0,
  "ALTER TABLE live_session_accounting ADD COLUMN accounting_accuracy VARCHAR(24) NOT NULL DEFAULT 'CONFIRMED' AFTER reward_units_generated, ADD INDEX idx_live_accounting_host_status_started (host_application_user_id, status, started_at)",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- Historical rows did not have a durable positive-media-evidence clock.  They
-- remain visible, but are honestly labelled rather than represented as newly
-- confirmed accounting.  Existing counters are copied only as a display and
-- reconciliation starting point; no reward is created by this migration.
UPDATE live_session_accounting
SET eligible_seconds_committed = GREATEST(
      COALESCE(eligible_seconds_committed, 0),
      COALESCE(valid_media_seconds, 0),
      COALESCE(eligible_duration_seconds, 0) + COALESCE(media_segment_seconds, 0)
    ),
    accounting_accuracy = CASE
      WHEN status = 'ACTIVE' THEN 'RECONCILED'
      ELSE 'ESTIMATED'
    END,
    reconnect_state = CASE
      WHEN status = 'ACTIVE' AND media_publishing = TRUE THEN 'PUBLISHING'
      WHEN status = 'ACTIVE' THEN 'GRACE'
      ELSE 'ENDED'
    END,
    last_heartbeat_at = COALESCE(last_heartbeat_at, last_media_heartbeat_at),
    last_media_evidence_at = COALESCE(last_media_evidence_at, last_media_heartbeat_at)
WHERE eligible_seconds_committed = 0
   OR accounting_accuracy = 'CONFIRMED'
   OR reconnect_state = 'STARTING';
