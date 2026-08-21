-- The mobile banner carousel now renders uploaded WebP artwork without text
-- overlays. Advertise the corresponding Android private-beta release while
-- preserving every other app configuration value chosen in Control.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion',
  '2.2.1'
)
WHERE setting_key = 'mobile.app_config';
