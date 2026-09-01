-- Server-authoritative VIP, Rocket, PK streak, and weekly ranking rewards.

-- Keep the legacy level_number cache aligned with the authoritative
-- consumption_points track used by the mobile API.
UPDATE application_users
SET level_number = LEAST(120, FLOOR(SQRT(GREATEST(0, consumption_points) / 500)) + 1);

CREATE TABLE IF NOT EXISTS vip_tiers (
  tier TINYINT UNSIGNED PRIMARY KEY,
  tier_key VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(40) NOT NULL,
  price_coins BIGINT UNSIGNED NOT NULL,
  daily_reward_coins BIGINT UNSIGNED NOT NULL,
  frame_asset VARCHAR(255) NOT NULL,
  entry_asset VARCHAR(255) NULL,
  perks JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CHECK (tier BETWEEN 1 AND 5),
  CHECK (price_coins > 0),
  CHECK (daily_reward_coins > 0)
) ENGINE=InnoDB;

INSERT INTO vip_tiers
  (tier, tier_key, name, price_coins, daily_reward_coins, frame_asset, entry_asset, perks)
VALUES
  (1, 'gold', 'Gold', 100000, 2500, 'assets/vip/frames/vip_frame_01.webp', NULL,
    JSON_ARRAY('Gold profile border/frame', 'Priority support')),
  (2, 'platinum', 'Platinum', 300000, 7500, 'assets/vip/frames/vip_frame_02.webp', 'assets/vip/entries/vip_entry_02.json',
    JSON_ARRAY('Gold benefits', 'Premium entry animation', 'Advanced frame')),
  (3, 'diamond', 'Diamond', 500000, 12500, 'assets/vip/frames/vip_frame_03.webp', 'assets/vip/entries/vip_entry_03.json',
    JSON_ARRAY('Platinum benefits', 'Highlighted chat', 'Special gift badge')),
  (4, 'master', 'Master', 700000, 17500, 'assets/vip/frames/vip_frame_04.webp', 'assets/vip/entries/vip_entry_04.json',
    JSON_ARRAY('Diamond benefits', 'Nickname color', 'Monthly gift pack')),
  (5, 'legend', 'Legend', 1000000, 25000, 'assets/vip/frames/vip_frame_05.webp', 'assets/vip/entries/vip_entry_05.json',
    JSON_ARRAY('Master benefits', 'Direct manager access', 'Mega monthly bonus'))
ON DUPLICATE KEY UPDATE
  tier_key = VALUES(tier_key), name = VALUES(name), price_coins = VALUES(price_coins),
  daily_reward_coins = VALUES(daily_reward_coins), frame_asset = VALUES(frame_asset),
  entry_asset = VALUES(entry_asset), perks = VALUES(perks), active = TRUE;

CREATE TABLE IF NOT EXISTS vip_purchases (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  from_tier TINYINT UNSIGNED NOT NULL,
  to_tier TINYINT UNSIGNED NOT NULL,
  price_coins BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_vip_purchase_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_vip_purchase_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  INDEX idx_vip_purchase_user (application_user_id, created_at),
  CHECK (to_tier > from_tier)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vip_daily_claims (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  claim_date DATE NOT NULL,
  vip_tier TINYINT UNSIGNED NOT NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL UNIQUE,
  claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_vip_claim_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_vip_claim_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_vip_claim_day (application_user_id, claim_date),
  INDEX idx_vip_claim_user (application_user_id, claimed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rocket_tiers (
  level TINYINT UNSIGNED PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  target_coins BIGINT UNSIGNED NOT NULL,
  top1_reward_coins BIGINT UNSIGNED NOT NULL,
  top2_reward_coins BIGINT UNSIGNED NOT NULL,
  top3_reward_coins BIGINT UNSIGNED NOT NULL,
  room_reward_coins BIGINT UNSIGNED NOT NULL,
  duration_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  animation_asset VARCHAR(255) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (target_coins > 0),
  CHECK (duration_hours BETWEEN 1 AND 168)
) ENGINE=InnoDB;

INSERT INTO rocket_tiers
  (level, name, target_coins, top1_reward_coins, top2_reward_coins, top3_reward_coins, room_reward_coins, duration_hours, animation_asset)
VALUES
  (1, 'Spark Rocket', 10000, 500, 300, 150, 25, 24, 'assets/rocket/rocket_tier_01.json'),
  (2, 'Nova Rocket', 50000, 3000, 1800, 900, 100, 24, 'assets/rocket/rocket_tier_02.json'),
  (3, 'Royal Rocket', 100000, 7500, 4500, 2250, 250, 24, 'assets/rocket/rocket_tier_03.json'),
  (4, 'Galaxy Rocket', 250000, 20000, 12000, 6000, 500, 24, 'assets/rocket/rocket_tier_04.json')
ON DUPLICATE KEY UPDATE
  name = VALUES(name), target_coins = VALUES(target_coins),
  top1_reward_coins = VALUES(top1_reward_coins), top2_reward_coins = VALUES(top2_reward_coins),
  top3_reward_coins = VALUES(top3_reward_coins), room_reward_coins = VALUES(room_reward_coins),
  duration_hours = VALUES(duration_hours), animation_asset = VALUES(animation_asset), active = TRUE;

CREATE TABLE IF NOT EXISTS rocket_cycles (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  rocket_level TINYINT UNSIGNED NOT NULL,
  target_coins BIGINT UNSIGNED NOT NULL,
  contributed_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('ACTIVE','COMPLETED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ends_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  CONSTRAINT fk_rocket_cycle_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_rocket_cycle_tier FOREIGN KEY (rocket_level) REFERENCES rocket_tiers(level),
  INDEX idx_rocket_cycle_active (room_id, status, ends_at),
  INDEX idx_rocket_cycle_history (room_id, starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rocket_contributions (
  id CHAR(36) PRIMARY KEY,
  rocket_cycle_id CHAR(36) NOT NULL,
  gift_event_id CHAR(36) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  coin_value BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_rocket_contribution_cycle FOREIGN KEY (rocket_cycle_id) REFERENCES rocket_cycles(id),
  CONSTRAINT fk_rocket_contribution_gift FOREIGN KEY (gift_event_id) REFERENCES live_room_gift_events(id),
  CONSTRAINT fk_rocket_contribution_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_rocket_contribution_rank (rocket_cycle_id, application_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rocket_rewards (
  id CHAR(36) PRIMARY KEY,
  rocket_cycle_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  reward_group ENUM('TOP1','TOP2','TOP3','IN_ROOM') NOT NULL,
  rank_number TINYINT UNSIGNED NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_rocket_reward_cycle FOREIGN KEY (rocket_cycle_id) REFERENCES rocket_cycles(id),
  CONSTRAINT fk_rocket_reward_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_rocket_reward_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_rocket_reward_user (rocket_cycle_id, application_user_id),
  INDEX idx_rocket_reward_history (application_user_id, created_at)
) ENGINE=InnoDB;

SET @nazraa_schema = DATABASE();
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_pk_sessions' AND COLUMN_NAME = 'source_score') = 0,
  'ALTER TABLE live_pk_sessions ADD COLUMN source_score BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER status', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_pk_sessions' AND COLUMN_NAME = 'target_score') = 0,
  'ALTER TABLE live_pk_sessions ADD COLUMN target_score BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER source_score', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_pk_sessions' AND COLUMN_NAME = 'winner_room_id') = 0,
  'ALTER TABLE live_pk_sessions ADD COLUMN winner_room_id CHAR(36) NULL AFTER target_score', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_pk_sessions' AND CONSTRAINT_NAME = 'fk_live_pk_winner_room') = 0,
  'ALTER TABLE live_pk_sessions ADD CONSTRAINT fk_live_pk_winner_room FOREIGN KEY (winner_room_id) REFERENCES live_rooms(id)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS pk_host_streaks (
  application_user_id CHAR(36) PRIMARY KEY,
  current_streak TINYINT UNSIGNED NOT NULL DEFAULT 0,
  qualifying_wins_total INT UNSIGNED NOT NULL DEFAULT 0,
  bonuses_awarded INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pk_streak_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CHECK (current_streak BETWEEN 0 AND 2)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pk_host_streak_events (
  id CHAR(36) PRIMARY KEY,
  pk_session_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  result ENUM('WIN','LOSS','DRAW') NOT NULL,
  received_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  qualifying_win BOOLEAN NOT NULL DEFAULT FALSE,
  streak_after TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bonus_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bonus_ledger_transaction_id CHAR(36) NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pk_streak_event_session FOREIGN KEY (pk_session_id) REFERENCES live_pk_sessions(id),
  CONSTRAINT fk_pk_streak_event_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_pk_streak_event_ledger FOREIGN KEY (bonus_ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_pk_streak_session_user (pk_session_id, application_user_id),
  INDEX idx_pk_streak_event_user (application_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_gifter_reward_runs (
  week_start DATE PRIMARY KEY,
  week_end DATE NOT NULL,
  status ENUM('PROCESSING','COMPLETED') NOT NULL DEFAULT 'PROCESSING',
  winners_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  total_reward_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS weekly_gifter_rewards (
  id CHAR(36) PRIMARY KEY,
  week_start DATE NOT NULL,
  rank_number TINYINT UNSIGNED NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  gifted_coins BIGINT UNSIGNED NOT NULL,
  reward_basis_points SMALLINT UNSIGNED NOT NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_weekly_gifter_run FOREIGN KEY (week_start) REFERENCES weekly_gifter_reward_runs(week_start),
  CONSTRAINT fk_weekly_gifter_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_weekly_gifter_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_weekly_gifter_rank (week_start, rank_number),
  UNIQUE KEY uq_weekly_gifter_user (week_start, application_user_id),
  CHECK (rank_number BETWEEN 1 AND 3),
  CHECK (reward_basis_points IN (250, 150, 100))
) ENGINE=InnoDB;
