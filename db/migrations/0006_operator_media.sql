-- Operator-facing gift artwork may be either an emoji or an uploaded image.
-- Existing gifts keep their current key-derived mobile symbol until edited.

ALTER TABLE gift_catalog
  ADD COLUMN emoji VARCHAR(32) NULL AFTER category;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.app_config', JSON_OBJECT(
  'minimumVersion', '2.1.0',
  'latestVersion', '2.1.1',
  'maintenance', FALSE,
  'maintenanceMessage', '',
  'updateUrl', '',
  'supportUrl', '',
  'withdrawalUrl', ''
), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_SET(setting_value, '$.latestVersion', '2.1.1');
