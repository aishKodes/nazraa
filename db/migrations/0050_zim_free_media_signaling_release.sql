-- Publish ZEGO-media-only rooms with Nazraa-owned signalling and PK presence.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.24',
  '$.latestBuild', 5334
)
WHERE setting_key = 'mobile.app_config';
