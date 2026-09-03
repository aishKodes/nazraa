-- Publish the Face Live audio-only interaction release to mobile clients.
-- No wallet, room, hierarchy, or RTC credentials are changed here.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.14',
  '$.latestBuild', 5324
)
WHERE setting_key = 'mobile.app_config';
