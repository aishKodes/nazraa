-- Publish the Face Live audio-guest presentation correction.
-- Accepted audio guests remain visible as compact avatars in the top member
-- strip; the duplicate video-call-shaped guest card has been removed.

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.16',
  '$.latestBuild', 5326
)
WHERE setting_key = 'mobile.app_config';
