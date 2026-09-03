-- Publish PK signaling/response reliability and MariaDB-safe Agency joining.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.22',
  '$.latestBuild', 5332
)
WHERE setting_key = 'mobile.app_config';
