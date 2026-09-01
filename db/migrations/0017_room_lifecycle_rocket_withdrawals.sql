-- Room lifecycle hardening, per-seat locks, extended Actor levels, and the
-- currently published host/Rocket rules. All mutable product values remain
-- editable by Master after this seed is applied.

UPDATE host_reward_rules
SET coins_per_hour = CASE WHEN room_type = 'PARTY' THEN 0 ELSE 3500 END
WHERE enabled = TRUE;

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Eligible Video/Face Live time earns 3,500 coins per valid hour under the current server rule.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;

CREATE TABLE IF NOT EXISTS live_room_seat_locks (
  room_id CHAR(36) NOT NULL,
  seat_index TINYINT UNSIGNED NOT NULL,
  locked_by_application_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, seat_index),
  CONSTRAINT fk_seat_lock_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_seat_lock_actor FOREIGN KEY (locked_by_application_user_id) REFERENCES application_users(id),
  CHECK (seat_index < 20)
) ENGINE=InnoDB;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.maximumLevel', 120,
  '$.maximumConsumptionLevel', 120,
  '$.maximumActorLevel', 200
)
WHERE setting_key = 'mobile.levels';

INSERT INTO level_definitions (track, level_number, points_required, badge_key)
WITH RECURSIVE actor_levels AS (
  SELECT 121 level_number
  UNION ALL SELECT level_number + 1 FROM actor_levels WHERE level_number < 200
)
SELECT 'ANCHOR_INCOME', level_number,
  (level_number - 1) * (level_number - 1) * 500,
  CASE WHEN level_number >= 180 THEN 'MYTHIC' ELSE 'LEGEND' END
FROM actor_levels
ON DUPLICATE KEY UPDATE points_required = VALUES(points_required), badge_key = VALUES(badge_key);

UPDATE rocket_tiers
SET target_coins = CASE level
  WHEN 1 THEN 5000
  WHEN 2 THEN 35000
  WHEN 3 THEN 100000
  WHEN 4 THEN 250000
  ELSE target_coins
END
WHERE level BETWEEN 1 AND 4;

INSERT INTO rocket_tiers
  (level, name, target_coins, top1_reward_coins, top2_reward_coins, top3_reward_coins,
   room_reward_coins, duration_hours, animation_asset, active)
VALUES
  (5, 'Master Rocket', 500000, 0, 0, 0, 0, 24, 'assets/rocket/rocket_tier_04.json', TRUE),
  (6, 'Legend Rocket', 1000000, 0, 0, 0, 0, 24, 'assets/rocket/rocket_tier_04.json', TRUE)
ON DUPLICATE KEY UPDATE target_coins = VALUES(target_coins);

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.rocketEnabled', TRUE,
  '$.rocketEnergyPerCoin', 1,
  '$.rocketMinimumUserLevel', 1,
  '$.rocketMinimumVipTier', 0,
  '$.rocketVipEnergyBonusPercent', 0,
  '$.rocketResetTimezone', 'Asia/Kolkata'
)
WHERE setting_key = 'mobile.room_features';
