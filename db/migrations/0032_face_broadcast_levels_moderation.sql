-- Nazraa Live 2.4.11 / build 5321.
-- Face Live remains one host broadcast with audio-only accepted guests.
-- User and Actor progression now follows the captured reference thresholds.

UPDATE level_definitions
SET points_required = (level_number - 1) * (level_number - 1) *
  CASE track
    WHEN 'ANCHOR_INCOME' THEN 10000
    ELSE 5000
  END;

UPDATE application_users
SET level_number = LEAST(
  120,
  FLOOR(SQRT(GREATEST(0, consumption_points) / 5000)) + 1
);

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.consumptionPointScale', 5000,
  '$.actorPointScale', 10000
)
WHERE setting_key = 'mobile.levels';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.11',
  '$.latestBuild', 5321
)
WHERE setting_key = 'mobile.app_config';
