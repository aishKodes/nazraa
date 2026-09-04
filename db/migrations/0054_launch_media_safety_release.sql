-- Publish the launch media safety release after the backend migrations that
-- restored RTC reliability and recovered provable completed Live hours.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.27',
  '$.latestBuild', 5337
)
WHERE setting_key = 'mobile.app_config';
