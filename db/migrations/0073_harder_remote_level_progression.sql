-- Nazraa Live 2.4.35 / build 5345.
-- Progression is deliberately cumulative and non-linear. Existing displayed
-- status is grandfathered; future gains use these remotely managed definitions.

ALTER TABLE application_users
  ADD COLUMN anchor_level_number SMALLINT UNSIGNED NOT NULL DEFAULT 1
  AFTER anchor_income_points;

ALTER TABLE level_definitions
  ADD COLUMN level_label VARCHAR(40) NOT NULL DEFAULT 'Starter' AFTER badge_key,
  ADD COLUMN perks_json JSON NULL AFTER level_label,
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER perks_json,
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3) AFTER enabled;

CREATE TABLE IF NOT EXISTS level_migration_impacts (
  id CHAR(36) PRIMARY KEY,
  migration_key VARCHAR(80) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  previous_consumption_level SMALLINT UNSIGNED NOT NULL,
  calculated_consumption_level SMALLINT UNSIGNED NOT NULL,
  displayed_consumption_level SMALLINT UNSIGNED NOT NULL,
  previous_anchor_level SMALLINT UNSIGNED NOT NULL,
  calculated_anchor_level SMALLINT UNSIGNED NOT NULL,
  displayed_anchor_level SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_level_migration_user (migration_key, application_user_id),
  KEY idx_level_migration_created (migration_key, created_at),
  CONSTRAINT fk_level_migration_user FOREIGN KEY (application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

-- Cumulative thresholds: the user reference begins at a 5K first upgrade
-- and grows ~20% per level. Actor/Host progress is separate, starts at 10K,
-- and follows its own 12% curve through the legacy 200-level ceiling.
INSERT INTO level_definitions
  (track, level_number, points_required, badge_key, level_label, perks_json, enabled)
WITH RECURSIVE consumption_curve AS (
  SELECT 1 level_number,
         CAST(0 AS DECIMAL(30,0)) points_required,
         CAST(5000 AS DECIMAL(30,0)) next_increment
  UNION ALL
  SELECT level_number + 1,
         points_required + next_increment,
         CAST(ROUND(next_increment * 1.20, 0) AS DECIMAL(30,0))
  FROM consumption_curve
  WHERE level_number < 120
),
anchor_curve AS (
  SELECT 1 level_number,
         CAST(0 AS DECIMAL(30,0)) points_required,
         CAST(10000 AS DECIMAL(30,0)) next_increment
  UNION ALL
  SELECT level_number + 1,
         points_required + next_increment,
         CAST(ROUND(next_increment * 1.12, 0) AS DECIMAL(30,0))
  FROM anchor_curve
  WHERE level_number < 200
)
SELECT 'CONSUMPTION', level_number, CAST(points_required AS UNSIGNED),
       CONCAT('consumption_', LPAD(level_number, 3, '0')),
       CASE
         WHEN level_number >= 100 THEN 'Mythic'
         WHEN level_number >= 80 THEN 'Legend'
         WHEN level_number >= 60 THEN 'Royal'
         WHEN level_number >= 40 THEN 'Elite'
         WHEN level_number >= 20 THEN 'Rising'
         ELSE 'Starter'
       END,
       NULL, TRUE
FROM consumption_curve
UNION ALL
SELECT 'ANCHOR_INCOME', level_number, CAST(points_required AS UNSIGNED),
       CONCAT('anchor_', LPAD(level_number, 3, '0')),
       CASE
         WHEN level_number >= 180 THEN 'Mythic Host'
         WHEN level_number >= 140 THEN 'Legend Host'
         WHEN level_number >= 100 THEN 'Royal Host'
         WHEN level_number >= 60 THEN 'Elite Host'
         WHEN level_number >= 20 THEN 'Rising Host'
         ELSE 'New Host'
       END,
       NULL, TRUE
FROM anchor_curve
ON DUPLICATE KEY UPDATE
  points_required = VALUES(points_required),
  badge_key = VALUES(badge_key),
  level_label = VALUES(level_label),
  enabled = VALUES(enabled);

-- Preserve current displayed rank. The new curve applies immediately to new
-- progress, but an existing user is never silently demoted by this migration.
INSERT INTO level_migration_impacts
  (id, migration_key, application_user_id,
   previous_consumption_level, calculated_consumption_level, displayed_consumption_level,
   previous_anchor_level, calculated_anchor_level, displayed_anchor_level)
SELECT UUID(), 'harder-remote-v1', user.id,
       GREATEST(1, user.level_number),
       COALESCE((SELECT MAX(definition.level_number)
                 FROM level_definitions definition
                 WHERE definition.track = 'CONSUMPTION' AND definition.enabled = TRUE
                   AND definition.points_required <= user.consumption_points), 1),
       GREATEST(user.level_number, COALESCE((SELECT MAX(definition.level_number)
                 FROM level_definitions definition
                 WHERE definition.track = 'CONSUMPTION' AND definition.enabled = TRUE
                   AND definition.points_required <= user.consumption_points), 1)),
       GREATEST(1, FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 10000)) + 1),
       COALESCE((SELECT MAX(definition.level_number)
                 FROM level_definitions definition
                 WHERE definition.track = 'ANCHOR_INCOME' AND definition.enabled = TRUE
                   AND definition.points_required <= user.anchor_income_points), 1),
       GREATEST(FLOOR(SQRT(GREATEST(0, user.anchor_income_points) / 10000)) + 1,
                COALESCE((SELECT MAX(definition.level_number)
                          FROM level_definitions definition
                          WHERE definition.track = 'ANCHOR_INCOME' AND definition.enabled = TRUE
                            AND definition.points_required <= user.anchor_income_points), 1))
FROM application_users user
ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP(3);

UPDATE application_users user
INNER JOIN level_migration_impacts impact
  ON impact.application_user_id = user.id AND impact.migration_key = 'harder-remote-v1'
SET user.level_number = impact.displayed_consumption_level,
    user.anchor_level_number = impact.displayed_anchor_level;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.schemaVersion', 'harder-remote-v1',
  '$.curveMode', 'cumulative-geometric',
  '$.maximumConsumptionLevel', 120,
  '$.maximumActorLevel', 200,
  '$.consumption.firstUpgradePoints', 5000,
  '$.consumption.incrementMultiplier', 1.20,
  '$.actor.firstUpgradePoints', 10000,
  '$.actor.incrementMultiplier', 1.12,
  '$.grandfatherDisplayedLevels', TRUE
)
WHERE setting_key = 'mobile.levels';
