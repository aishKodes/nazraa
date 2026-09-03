-- Publish the Face Live direct-audio release to mobile clients.
-- This build removes ZEGO's call-style co-host transition from Face Live;
-- Google authentication, wallets, hierarchy, and RTC credentials are unchanged.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.15',
  '$.latestBuild', 5325
)
WHERE setting_key = 'mobile.app_config';
