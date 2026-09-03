-- Media-qualified host rewards. Only confirmed host publishing heartbeats are
-- counted; interrupted partial hours are discarded while completed continuous
-- hours are retained. The reconnect grace is applied by the repository.

ALTER TABLE live_session_accounting
  ADD COLUMN media_publishing BOOLEAN NOT NULL DEFAULT FALSE AFTER started_at,
  ADD COLUMN last_media_heartbeat_at DATETIME(3) NULL AFTER media_publishing,
  ADD COLUMN media_segment_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_media_heartbeat_at,
  ADD COLUMN valid_media_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER media_segment_seconds;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'rtc_fallback',
  '$.partyPassivePlaybackMode', 'dynamic_rtc_fallback',
  '$.partyStreamingThreshold', 9,
  '$.streamMixingEnabled', FALSE,
  '$.mediaReconnectGraceSeconds', 15,
  '$.updatedBy', 'media-lifecycle-accounting'
)
WHERE setting_key = 'mobile.room_features';
