-- Paid-media rollout guardrails and daily ZEGO cost telemetry.
-- The paid routing switch remains OFF until ZEGO Live Streaming,
-- Stream Mixing, and the deployment playback domains are explicitly ready.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_mix_tasks' AND COLUMN_NAME = 'telemetry_at') = 0,
  'ALTER TABLE live_media_mix_tasks ADD COLUMN telemetry_at DATETIME(3) NULL AFTER stopped_at', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_media_daily_metrics (
  usage_date DATE PRIMARY KEY,
  rtc_voice_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rtc_video_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  face_passive_stream_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  party_passive_stream_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mixer_creation_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rtc_passive_fallback_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rtc_passive_viewer_count INT UNSIGNED NOT NULL DEFAULT 0,
  rtc_passive_viewer_peak INT UNSIGNED NOT NULL DEFAULT 0,
  face_rtc_passive_viewer_count INT UNSIGNED NOT NULL DEFAULT 0,
  face_rtc_passive_viewer_peak INT UNSIGNED NOT NULL DEFAULT 0,
  media_concurrency_count INT UNSIGNED NOT NULL DEFAULT 0,
  peak_concurrency INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_media_cost_alerts (
  id CHAR(36) PRIMARY KEY,
  usage_date DATE NOT NULL,
  room_id CHAR(36) NOT NULL,
  alert_code VARCHAR(64) NOT NULL,
  observed_count INT UNSIGNED NOT NULL,
  expected_ceiling INT UNSIGNED NOT NULL,
  status ENUM('OPEN','RESOLVED') NOT NULL DEFAULT 'OPEN',
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  CONSTRAINT fk_live_media_cost_alert_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  UNIQUE KEY uq_live_media_cost_alert_day (usage_date, room_id, alert_code),
  INDEX idx_live_media_cost_alert_status (status, last_seen_at)
) ENGINE=InnoDB;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'live_streaming',
  '$.partyPassivePlaybackMode', 'live_streaming',
  '$.partyStreamingThreshold', 8,
  '$.paidMediaRoutingEnabled', FALSE,
  '$.streamMixingEnabled', FALSE,
  '$.pkCompositeStreamingEnabled', TRUE,
  '$.emergencyRtcFallbackEnabled', FALSE,
  '$.rtcPassiveFallbackCeiling', 3,
  '$.passiveBackgroundGraceSeconds', 10,
  '$.updatedBy', 'paid-media-routing-ready-awaiting-zego-activation'
)
WHERE setting_key = 'mobile.room_features';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.28',
  '$.latestBuild', 5338
)
WHERE setting_key = 'mobile.app_config';
