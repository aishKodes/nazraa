-- Face CDN FLV preference follows a controlled same-stream Android comparison.
-- It remains a backend-configured route with a signed HLS fallback; no passive
-- viewer is granted RTC because of this preference.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackProtocol', 'flv',
  '$.nazraaNaturalBeautyEnabled', FALSE,
  '$.nazraaNaturalBeautyReviewerQaEnabled', TRUE,
  '$.updatedBy', 'face-cdn-flv-controlled-android-rollout'
)
WHERE setting_key = 'mobile.room_features';

-- Keep exact per-session usage on each heartbeat, but checkpoint the shared
-- daily aggregate only at bounded intervals.  This removes a global hot-row
-- lock from the presence transaction while preserving an auditable catch-up
-- amount when a session ends.
SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'telemetry_reported_duration_seconds') = 0,
  'ALTER TABLE live_media_usage ADD COLUMN telemetry_reported_duration_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER duration_seconds',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND COLUMN_NAME = 'telemetry_reported_at') = 0,
  'ALTER TABLE live_media_usage ADD COLUMN telemetry_reported_at DATETIME(3) NULL AFTER last_seen_at',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
