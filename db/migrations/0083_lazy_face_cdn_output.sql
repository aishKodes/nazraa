-- Live Creation minutes are billable while a mixer/output is warm, even when
-- no passive CDN audience is present. Start a Face output only after the
-- first passive viewer joins; the client already renders a bounded
-- streaming-pending state and never falls back to passive RTC.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.faceCdnKeepWarmWhileHostLive', FALSE,
  '$.updatedBy', 'lazy-face-cdn-output-cost-containment'
)
WHERE setting_key = 'mobile.room_features';
