-- Explicit server-owned media roles, controlled RTC fallback, and lightweight
-- delivery accounting. These fields do not change social room membership.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'media_role') = 0,
  "ALTER TABLE live_room_members ADD COLUMN media_role ENUM('HOST','PASSIVE_VIEWER','AUDIO_REQUESTED','AUDIO_GUEST','PARTY_OWNER','PASSIVE_LISTENER','MIC_REQUESTED','RTC_SPEAKER') NOT NULL DEFAULT 'PASSIVE_VIEWER' AFTER room_role",
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE live_room_members member
INNER JOIN live_rooms room ON room.id = member.room_id
SET member.media_role = CASE
  WHEN room.room_type = 'FACE' AND member.room_role = 'OWNER' THEN 'HOST'
  WHEN room.room_type = 'FACE' AND member.room_role = 'SPEAKER' THEN 'AUDIO_GUEST'
  WHEN room.room_type = 'FACE' THEN 'PASSIVE_VIEWER'
  WHEN room.room_type = 'PARTY' AND member.room_role = 'OWNER' THEN 'PARTY_OWNER'
  WHEN room.room_type = 'PARTY' AND member.room_role IN ('ADMIN','SPEAKER') AND member.seat_index IS NOT NULL THEN 'RTC_SPEAKER'
  WHEN room.room_type = 'PARTY' THEN 'PASSIVE_LISTENER'
  WHEN member.room_role = 'OWNER' THEN 'HOST'
  WHEN member.room_role = 'SPEAKER' THEN 'AUDIO_GUEST'
  ELSE 'PASSIVE_VIEWER'
END;

CREATE TABLE IF NOT EXISTS live_media_access_grants (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  media_role VARCHAR(32) NOT NULL,
  transport ENUM('RTC_PUBLISHER','RTC_PASSIVE_FALLBACK') NOT NULL,
  can_publish BOOLEAN NOT NULL DEFAULT FALSE,
  stream_id VARCHAR(180) NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  CONSTRAINT fk_media_grant_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_media_grant_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_media_grant_active (room_id, transport, revoked_at, expires_at),
  INDEX idx_media_grant_user (application_user_id, issued_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_media_usage (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  usage_type ENUM('FACE_HOST_RTC','FACE_AUDIO_GUEST_RTC','FACE_PASSIVE_STREAM','FACE_PASSIVE_RTC_FALLBACK','PARTY_SPEAKER_RTC','PARTY_PASSIVE_STREAM','PARTY_PASSIVE_RTC_FALLBACK') NOT NULL,
  duration_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  PRIMARY KEY (room_id, application_user_id, usage_type),
  CONSTRAINT fk_media_usage_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_media_usage_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_media_usage_room (room_id, usage_type, last_seen_at)
) ENGINE=InnoDB;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_mix_tasks' AND COLUMN_NAME = 'active_started_at') = 0,
  'ALTER TABLE live_media_mix_tasks ADD COLUMN active_started_at DATETIME(3) NULL AFTER last_synced_at, ADD COLUMN active_duration_seconds BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER active_started_at, ADD COLUMN stopped_at DATETIME(3) NULL AFTER active_duration_seconds',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.facePassivePlaybackMode', 'live_streaming',
  '$.partyPassivePlaybackMode', 'live_streaming',
  '$.partyStreamingThreshold', 9,
  '$.streamMixingEnabled', TRUE,
  '$.pkCompositeStreamingEnabled', TRUE,
  '$.mediaReconnectGraceSeconds', 60,
  '$.passiveBackgroundGraceSeconds', 15,
  '$.maxFaceAudioGuests', 4,
  '$.rtcPassiveFallbackCeiling', 20,
  '$.updatedBy', 'authoritative-media-roles-and-cost-guardrails'
)
WHERE setting_key = 'mobile.room_features';
