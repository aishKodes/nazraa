-- Publish the Android release that guarantees ordinary audience room exit,
-- serializes nested room panels, and compacts repeated gift activity.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.21',
  '$.latestBuild', 5331
)
WHERE setting_key = 'mobile.app_config';
