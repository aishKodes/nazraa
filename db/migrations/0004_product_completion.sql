-- Nazraa Live final product completion.
-- Adds federated identity/profile fields, automatic biometric verification
-- records, live-access authorization, daily rewards, atomic diamond exchange,
-- server-timed host rewards, party room roles, policies, and production-safe
-- starter configuration. No fake users, rooms, viewers, or performance data.

ALTER TABLE application_users
  ADD COLUMN google_subject VARCHAR(255) NULL AFTER external_user_id,
  ADD COLUMN email VARCHAR(190) NULL AFTER google_subject,
  ADD COLUMN date_of_birth DATE NULL AFTER country_code,
  ADD COLUMN gender ENUM('FEMALE','MALE','NON_BINARY','PREFER_NOT_TO_SAY') NULL AFTER date_of_birth,
  ADD COLUMN bio VARCHAR(280) NOT NULL DEFAULT '' AFTER gender,
  ADD COLUMN language_code VARCHAR(16) NOT NULL DEFAULT 'en' AFTER bio,
  ADD COLUMN whatsapp_e164 VARCHAR(20) NULL AFTER language_code,
  ADD COLUMN onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE AFTER whatsapp_e164,
  ADD COLUMN agency_face_live_authorized BOOLEAN NOT NULL DEFAULT FALSE AFTER face_verification_status,
  ADD COLUMN super_admin_face_live_authorized BOOLEAN NOT NULL DEFAULT FALSE AFTER agency_face_live_authorized,
  ADD UNIQUE KEY uq_application_user_google_subject (google_subject),
  ADD INDEX idx_application_user_email (email);

ALTER TABLE application_users
  MODIFY COLUMN face_verification_status ENUM('NOT_SUBMITTED','PENDING','PROCESSING','VERIFIED','DUPLICATE','RETRY','REJECTED') NOT NULL DEFAULT 'NOT_SUBMITTED';

UPDATE application_users
SET is_host = TRUE,
    onboarding_completed = TRUE
WHERE onboarding_completed = FALSE;

INSERT INTO host_profiles
  (id, application_user_id, agency_account_id, status, verification_status)
SELECT UUID(), user.id, user.agency_account_id, 'ACTIVE', 'UNVERIFIED'
FROM application_users user
LEFT JOIN host_profiles host ON host.application_user_id = user.id
WHERE host.id IS NULL;

CREATE TABLE application_user_avatars (
  application_user_id CHAR(36) PRIMARY KEY,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_avatar_user FOREIGN KEY (application_user_id) REFERENCES application_users(id) ON DELETE CASCADE,
  CHECK (byte_size > 0 AND byte_size <= 1048576)
) ENGINE=InnoDB;

ALTER TABLE face_verification_requests
  MODIFY COLUMN status ENUM('PENDING','PROCESSING','VERIFIED','DUPLICATE','RETRY','REJECTED') NOT NULL DEFAULT 'PROCESSING',
  ADD COLUMN provider VARCHAR(40) NULL AFTER selfie_document_id,
  ADD COLUMN provider_face_id VARCHAR(255) NULL AFTER provider,
  ADD COLUMN embedding_reference VARCHAR(500) NULL AFTER provider_face_id,
  ADD COLUMN liveness_score DECIMAL(6,3) NULL AFTER embedding_reference,
  ADD COLUMN match_score DECIMAL(6,3) NULL AFTER liveness_score,
  ADD COLUMN duplicate_application_user_id CHAR(36) NULL AFTER match_score,
  ADD COLUMN verified_at DATETIME(3) NULL AFTER duplicate_application_user_id,
  ADD CONSTRAINT fk_face_duplicate_user FOREIGN KEY (duplicate_application_user_id) REFERENCES application_users(id),
  ADD INDEX idx_face_provider_reference (provider, provider_face_id);

CREATE TABLE live_access_authorization_history (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  authorization_type ENUM('AGENCY_FACE_LIVE','SUPER_ADMIN_FACE_LIVE') NOT NULL,
  decision ENUM('APPROVED','REVOKED') NOT NULL,
  actor_account_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_access_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_access_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_live_access_user (application_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE daily_reward_rules (
  id CHAR(36) PRIMARY KEY,
  day_number TINYINT UNSIGNED NOT NULL UNIQUE,
  reward_coins BIGINT UNSIGNED NOT NULL,
  label VARCHAR(80) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_daily_reward_updater FOREIGN KEY (updated_by) REFERENCES platform_accounts(id),
  CHECK (day_number BETWEEN 1 AND 31)
) ENGINE=InnoDB;

CREATE TABLE daily_reward_claims (
  id CHAR(36) PRIMARY KEY,
  claim_code VARCHAR(48) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  claim_date DATE NOT NULL,
  streak_day INT UNSIGNED NOT NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  claimed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_daily_claim_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_daily_claim_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_daily_claim_user_date (application_user_id, claim_date),
  INDEX idx_daily_claim_user_time (application_user_id, claimed_at)
) ENGINE=InnoDB;

CREATE TABLE diamond_conversion_rules (
  id CHAR(36) PRIMARY KEY,
  diamonds BIGINT UNSIGNED NOT NULL,
  coins BIGINT UNSIGNED NOT NULL,
  minimum_diamonds BIGINT UNSIGNED NOT NULL,
  maximum_diamonds BIGINT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATETIME(3) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_conversion_rule_updater FOREIGN KEY (updated_by) REFERENCES platform_accounts(id),
  CHECK (diamonds > 0 AND coins > 0 AND minimum_diamonds > 0 AND maximum_diamonds >= minimum_diamonds),
  INDEX idx_conversion_rule_effective (enabled, effective_from)
) ENGINE=InnoDB;

CREATE TABLE diamond_coin_exchanges (
  id CHAR(36) PRIMARY KEY,
  exchange_code VARCHAR(48) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  diamonds_debited BIGINT UNSIGNED NOT NULL,
  coins_credited BIGINT UNSIGNED NOT NULL,
  diamond_before BIGINT UNSIGNED NOT NULL,
  diamond_after BIGINT UNSIGNED NOT NULL,
  coin_before BIGINT UNSIGNED NOT NULL,
  coin_after BIGINT UNSIGNED NOT NULL,
  diamond_ledger_id CHAR(36) NOT NULL,
  coin_ledger_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_exchange_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_exchange_rule FOREIGN KEY (rule_id) REFERENCES diamond_conversion_rules(id),
  CONSTRAINT fk_exchange_diamond_ledger FOREIGN KEY (diamond_ledger_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_exchange_coin_ledger FOREIGN KEY (coin_ledger_id) REFERENCES ledger_transactions(id),
  INDEX idx_exchange_user_time (application_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE host_reward_rules (
  id CHAR(36) PRIMARY KEY,
  room_type ENUM('LIVE','PARTY','FACE') NOT NULL,
  coins_per_hour BIGINT UNSIGNED NOT NULL,
  minimum_eligible_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATETIME(3) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_host_reward_updater FOREIGN KEY (updated_by) REFERENCES platform_accounts(id),
  INDEX idx_host_reward_effective (room_type, enabled, effective_from)
) ENGINE=InnoDB;

CREATE TABLE live_session_accounting (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL UNIQUE,
  host_application_user_id CHAR(36) NOT NULL,
  room_type ENUM('LIVE','PARTY','FACE') NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  valid_duration_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  eligible_duration_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  reward_rule_id CHAR(36) NULL,
  reward_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reward_ledger_id CHAR(36) NULL,
  status ENUM('ACTIVE','FINALIZED','VOID') NOT NULL DEFAULT 'ACTIVE',
  finalized_at DATETIME(3) NULL,
  CONSTRAINT fk_live_accounting_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_accounting_host FOREIGN KEY (host_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_accounting_rule FOREIGN KEY (reward_rule_id) REFERENCES host_reward_rules(id),
  CONSTRAINT fk_live_accounting_ledger FOREIGN KEY (reward_ledger_id) REFERENCES ledger_transactions(id),
  INDEX idx_live_accounting_host (host_application_user_id, started_at)
) ENGINE=InnoDB;

CREATE TABLE live_room_members (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  room_role ENUM('OWNER','ADMIN','SPEAKER','AUDIENCE') NOT NULL DEFAULT 'AUDIENCE',
  muted BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, application_user_id),
  CONSTRAINT fk_room_member_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_room_member_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_room_member_role (room_id, room_role, left_at)
) ENGINE=InnoDB;

CREATE TABLE policy_documents (
  id CHAR(36) PRIMARY KEY,
  policy_key VARCHAR(80) NOT NULL,
  version VARCHAR(32) NOT NULL,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  body_json JSON NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATETIME(3) NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_policy_updater FOREIGN KEY (updated_by) REFERENCES platform_accounts(id),
  UNIQUE KEY uq_policy_version (policy_key, version),
  INDEX idx_policy_active (policy_key, active, effective_from)
) ENGINE=InnoDB;

CREATE TABLE level_definitions (
  track ENUM('CONSUMPTION','ANCHOR_INCOME') NOT NULL,
  level_number SMALLINT UNSIGNED NOT NULL,
  points_required BIGINT UNSIGNED NOT NULL,
  badge_key VARCHAR(40) NOT NULL,
  PRIMARY KEY (track, level_number),
  CHECK (level_number >= 1)
) ENGINE=InnoDB;

ALTER TABLE coin_packages
  ADD COLUMN badge_label VARCHAR(40) NULL AFTER name;

SET @nazraa_master_id = (SELECT id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1);

INSERT INTO daily_reward_rules (id, day_number, reward_coins, label, updated_by)
SELECT UUID(), seed.day_number, seed.reward_coins, seed.label, @nazraa_master_id
FROM (
  SELECT 1 day_number, 100 reward_coins, 'Day 1' label UNION ALL
  SELECT 2, 150, 'Day 2' UNION ALL SELECT 3, 200, 'Day 3' UNION ALL
  SELECT 4, 300, 'Day 4' UNION ALL SELECT 5, 500, 'Day 5' UNION ALL
  SELECT 6, 750, 'Day 6' UNION ALL SELECT 7, 1500, 'Day 7 bonus'
) seed
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE reward_coins = VALUES(reward_coins), label = VALUES(label), updated_by = VALUES(updated_by);

INSERT INTO diamond_conversion_rules
  (id, diamonds, coins, minimum_diamonds, maximum_diamonds, enabled, effective_from, updated_by)
SELECT UUID(), 100, 100, 100, 1000000, TRUE, CURRENT_TIMESTAMP(3), @nazraa_master_id
WHERE @nazraa_master_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM diamond_conversion_rules WHERE enabled = TRUE);

INSERT INTO host_reward_rules
  (id, room_type, coins_per_hour, minimum_eligible_seconds, enabled, effective_from, updated_by)
SELECT UUID(), seed.room_type, seed.rate, 60, TRUE, CURRENT_TIMESTAMP(3), @nazraa_master_id
FROM (
  SELECT 'LIVE' room_type, 3500 rate UNION ALL
  SELECT 'FACE', 3500 UNION ALL
  SELECT 'PARTY', 0
) seed
WHERE @nazraa_master_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM host_reward_rules existing
    WHERE existing.room_type = seed.room_type AND existing.enabled = TRUE
  );

INSERT INTO coin_packages (id, name, badge_label, coin_amount, display_price, currency, active, sort_order, created_by)
SELECT UUID(), seed.name, seed.badge, seed.coins, seed.price, 'INR', TRUE, seed.sort_order, @nazraa_master_id
FROM (
  SELECT 'Nazraa Starter' name, NULL badge, 4000 coins, 50.00 price, 10 sort_order UNION ALL
  SELECT 'Nazraa Popular', 'Popular', 8500, 100.00, 20 UNION ALL
  SELECT 'Nazraa Best Value', 'Best Value', 45000, 500.00, 30 UNION ALL
  SELECT 'Nazraa Maximum', 'Maximum Bonus', 95000, 1000.00, 40
) seed
WHERE @nazraa_master_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM coin_packages package WHERE package.coin_amount = seed.coins AND package.display_price = seed.price);

UPDATE coin_packages
SET name = CASE coin_amount
    WHEN 4000 THEN 'Nazraa Starter'
    WHEN 8500 THEN 'Nazraa Popular'
    WHEN 45000 THEN 'Nazraa Best Value'
    WHEN 95000 THEN 'Nazraa Maximum'
  END,
  badge_label = CASE coin_amount
    WHEN 8500 THEN 'Popular'
    WHEN 45000 THEN 'Best Value'
    WHEN 95000 THEN 'Maximum Bonus'
    ELSE NULL
  END,
  sort_order = CASE coin_amount
    WHEN 4000 THEN 10 WHEN 8500 THEN 20 WHEN 45000 THEN 30 ELSE 40
  END,
  currency = 'INR',
  active = TRUE
WHERE (coin_amount = 4000 AND display_price = 50.00)
   OR (coin_amount = 8500 AND display_price = 100.00)
   OR (coin_amount = 45000 AND display_price = 500.00)
   OR (coin_amount = 95000 AND display_price = 1000.00);

UPDATE coin_packages
SET active = FALSE
WHERE NOT (
  (coin_amount = 4000 AND display_price = 50.00)
  OR (coin_amount = 8500 AND display_price = 100.00)
  OR (coin_amount = 45000 AND display_price = 500.00)
  OR (coin_amount = 95000 AND display_price = 1000.00)
);

INSERT INTO gift_catalog (id, gift_key, name, category, coin_price, visual_url, animation_key, active, created_by)
SELECT UUID(), seed.gift_key, seed.name, seed.category, seed.price, NULL, seed.animation_key, TRUE, @nazraa_master_id
FROM (
  SELECT 'rose' gift_key, 'Rose' name, 'Popular' category, 10 price, 'gift.rose' animation_key UNION ALL
  SELECT 'heart', 'Heart', 'Popular', 50, 'gift.heart' UNION ALL
  SELECT 'coffee', 'Coffee', 'Friendly', 100, 'gift.coffee' UNION ALL
  SELECT 'crown', 'Crown', 'Premium', 500, 'gift.crown' UNION ALL
  SELECT 'rocket', 'Rocket', 'Premium', 1000, 'gift.rocket' UNION ALL
  SELECT 'nazraa_star', 'Nazraa Star', 'Signature', 2500, 'gift.nazraa_star'
) seed
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), coin_price = VALUES(coin_price), animation_key = VALUES(animation_key), active = TRUE;

INSERT INTO banners
  (id, placement, title, subtitle, image_url, action_type, action_target, priority, active, created_by)
SELECT UUID(), 'HOME', seed.title, seed.subtitle, seed.image_url, seed.action_type, seed.action_target, seed.priority, TRUE, @nazraa_master_id
FROM (
  SELECT 'Welcome to Nazraa Live' title, 'Live, listen and belong.' subtitle, 'https://nazraa.vercel.app/nazraa-logo.jpg' image_url, 'NONE' action_type, NULL action_target, 100 priority UNION ALL
  SELECT 'Claim Your Daily Reward', 'Keep your streak alive every day.', 'https://nazraa.vercel.app/nazraa-logo.jpg', 'DAILY_REWARD', 'daily-rewards', 95 UNION ALL
  SELECT 'Complete Face Verification', 'One live face, one Nazraa account.', 'https://nazraa.vercel.app/nazraa-logo.jpg', 'FACE', 'face', 90 UNION ALL
  SELECT 'Join an Agency — Unlock Face Live', 'Agency and Super Admin authorization protect Face Live.', 'https://nazraa.vercel.app/nazraa-logo.jpg', 'AGENCY', 'agency', 85 UNION ALL
  SELECT 'Buy Coins from Approved Agencies', 'Choose a package and contact a verified seller on WhatsApp.', 'https://nazraa.vercel.app/nazraa-logo.jpg', 'WALLET', 'wallet', 80 UNION ALL
  SELECT 'Weekly Top Hosts / Leaderboard', 'See this week\'s real Nazraa rankings.', 'https://nazraa.vercel.app/nazraa-logo.jpg', 'RANKING', 'leaderboard', 75
) seed
WHERE @nazraa_master_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM banners banner WHERE banner.title = seed.title);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.discovery', JSON_OBJECT(
  'languages', JSON_ARRAY('Hindi','English','Bengali','Odia','Punjabi','Tamil','Telugu','Marathi','Gujarati','Urdu'),
  'categories', JSON_ARRAY('Talk','Music','Friends','Gaming','Local','Talent','Education','Lifestyle')
), @nazraa_master_id
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

INSERT INTO policy_documents
  (id, policy_key, version, title, summary, body_json, active, effective_from, updated_by)
SELECT UUID(), 'host-live-access', '1.0', 'Host Rules & Live Access Policy',
  'Rules for account integrity, hosting access, rewards, safety and moderation.',
  JSON_OBJECT('sections', JSON_ARRAY(
    JSON_OBJECT('title','Account','rules',JSON_ARRAY('Sign in with Google/Gmail.','Complete name, date of birth, gender, country and WhatsApp number.','Duplicate account or face abuse is prohibited.')),
    JSON_OBJECT('title','Access','rules',JSON_ARRAY('Unverified users may browse and join other rooms.','Face verification is required to create Party Live and use hosting interaction.','Face Live requires face verification, approved Agency membership, Agency authorization and Super Admin authorization.')),
    JSON_OBJECT('title','Rewards','rules',JSON_ARRAY('Eligible Video/Face Live time earns 3,500 coins per hour under the current server rule.','Party Board hourly reward is zero.','The server, not the phone clock, calculates eligible duration.')),
    JSON_OBJECT('title','Safety','rules',JSON_ARRAY('Use proper dress and behaviour.','No harassment, exploitation, fraud or prohibited activity.','Nazraa management and moderators may restrict rooms or accounts that breach policy.'))
  )), TRUE, CURRENT_TIMESTAMP(3), @nazraa_master_id
WHERE @nazraa_master_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM policy_documents WHERE policy_key = 'host-live-access' AND version = '1.0');

INSERT INTO level_definitions (track, level_number, points_required, badge_key)
WITH RECURSIVE levels AS (
  SELECT 1 level_number
  UNION ALL SELECT level_number + 1 FROM levels WHERE level_number < 120
)
SELECT track.name, levels.level_number,
  (levels.level_number - 1) * (levels.level_number - 1) * 500,
  CASE
    WHEN levels.level_number >= 100 THEN 'MYTHIC'
    WHEN levels.level_number >= 80 THEN 'LEGEND'
    WHEN levels.level_number >= 60 THEN 'ROYAL'
    WHEN levels.level_number >= 40 THEN 'ELITE'
    WHEN levels.level_number >= 20 THEN 'RISING'
    ELSE 'STARTER'
  END
FROM levels
CROSS JOIN (SELECT 'CONSUMPTION' name UNION ALL SELECT 'ANCHOR_INCOME') track;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.features', JSON_OBJECT(
  'videoLiveEnabled', TRUE,
  'faceLiveEnabled', TRUE,
  'beautyEnabled', TRUE,
  'withdrawalEnabled', TRUE,
  'coinSellerEnabled', TRUE,
  'gamesEnabled', TRUE,
  'dailyRewardsEnabled', TRUE,
  'diamondExchangeEnabled', TRUE
), @nazraa_master_id
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);
