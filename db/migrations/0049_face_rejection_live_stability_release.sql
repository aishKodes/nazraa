-- Publish rejected Face Verification clarity and stable Face Live playback.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.23',
  '$.latestBuild', 5333
)
WHERE setting_key = 'mobile.app_config';
