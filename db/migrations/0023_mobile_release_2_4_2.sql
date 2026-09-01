-- Published Android release metadata. Minimum-version policy remains under
-- Master control; this only advertises the verified current build.
UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion',
  '2.4.2'
)
WHERE setting_key = 'mobile.app_config';
