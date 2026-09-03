-- Release marker for remembered room media and simpler operator directories.
-- Room photos stay private to the user's app storage until the user creates a
-- room; the existing bounded upload pipeline remains authoritative.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.20',
  '$.latestBuild', 5330
)
WHERE setting_key = 'mobile.app_config';
