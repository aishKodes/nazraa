-- Hard launch-day RTC ceilings while ZEGO's CNAME/CDN/mixing provisioning is
-- incomplete. These limits are independent from the paid-routing flags: the
-- whole point is to prevent the temporary RTC fallback from becoming an
-- unlimited paid audience.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.temporaryRtcCostGuardEnabled', TRUE,
  '$.temporaryFaceRtcViewerCeiling', 3,
  '$.temporaryPartyRtcUserCeiling', 12,
  '$.passiveBackgroundGraceSeconds', 25,
  '$.mediaReconnectGraceSeconds', 60,
  '$.rtcPassiveFallbackCeiling', 3,
  '$.updatedBy', 'temporary-rtc-cost-guard-awaiting-cdn'
)
WHERE setting_key = 'mobile.room_features';

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'media.zego_cost_config', JSON_OBJECT(
  'currency', 'USD',
  'voiceUsdPer1000Minutes', 0.99,
  'hdVideoUsdPer1000Minutes', 3.99,
  'fhdVideoUsdPer1000Minutes', 8.99,
  'liveAudioAudienceUsdPer1000Minutes', 0.39,
  'liveHdAudienceUsdPer1000Minutes', 1.49,
  'dailyWarningUsd', 3.00,
  'dailyCriticalUsd', 5.00,
  'monthlyComplimentaryRtcMinutes', 10000,
  'rateSource', 'ZEGO public PAYG pricing verified 2026-09-05',
  'updatedBy', 'temporary-rtc-cost-guard'
), id
FROM platform_accounts
WHERE role = 'MASTER'
ORDER BY created_at
LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_MERGE_PATCH(setting_value, VALUES(setting_value)),
  updated_by = VALUES(updated_by);

SET @nazraa_schema = DATABASE();
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_access_grants' AND COLUMN_NAME = 'mobile_session_id') = 0,
  'ALTER TABLE live_media_access_grants ADD COLUMN mobile_session_id CHAR(36) NULL AFTER application_user_id, ADD CONSTRAINT fk_media_grant_session FOREIGN KEY (mobile_session_id) REFERENCES mobile_sessions(id), ADD INDEX idx_media_grant_session_active (mobile_session_id, revoked_at, expires_at)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_access_grants' AND INDEX_NAME = 'idx_media_grant_user_active') = 0,
  'ALTER TABLE live_media_access_grants ADD INDEX idx_media_grant_user_active (application_user_id, revoked_at, expires_at)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
