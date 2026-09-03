-- Publish the Android release containing authoritative Face/Party media roles
-- and explicit media lifecycle handling.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.17',
  '$.latestBuild', 5327
)
WHERE setting_key = 'mobile.app_config';
