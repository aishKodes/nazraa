-- Advertise the claimable Live rewards and remote-effect release without
-- changing the minimum supported client or any ZEGO activation switch.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.29',
  '$.latestBuild', 5339
)
WHERE setting_key = 'mobile.app_config';
