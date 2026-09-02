-- Nazraa Live 2.4.10 / build 5320 media-quality release.
-- The app keeps the established Google OAuth client/certificate unchanged.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.10',
  '$.latestBuild', 5320
)
WHERE setting_key = 'mobile.app_config';
