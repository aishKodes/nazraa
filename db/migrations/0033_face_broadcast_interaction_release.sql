-- Nazraa Live 2.4.12 / build 5322.
-- Face Live is a single-host video broadcast. Accepted viewers publish audio
-- only; the mobile client keeps all non-host camera tracks hidden and disabled.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.12',
  '$.latestBuild', 5322
)
WHERE setting_key = 'mobile.app_config';
