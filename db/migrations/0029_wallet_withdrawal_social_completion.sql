-- Authoritative gift earnings, exact withdrawal slabs/distribution snapshots,
-- indexed social lists, and the narrowly-scoped mobile owner test override.

ALTER TABLE live_room_gift_events
  ADD COLUMN diamond_value BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER coin_value,
  ADD INDEX idx_room_gift_sender_created (sender_application_user_id, created_at),
  ADD INDEX idx_room_gift_receiver_created (receiver_application_user_id, created_at);

-- Historic rows pre-date the explicit 97% receiver rule. Preserve their
-- recorded economics while making the new field useful in reports.
UPDATE live_room_gift_events
SET diamond_value = coin_value
WHERE diamond_value = 0;

ALTER TABLE user_follows
  ADD INDEX idx_user_follow_followed_created (followed_application_user_id, created_at),
  ADD INDEX idx_user_follow_follower_created (follower_application_user_id, created_at);

CREATE TABLE mobile_access_overrides (
  application_user_id CHAR(36) PRIMARY KEY,
  host_access_override BOOLEAN NOT NULL DEFAULT FALSE,
  note VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_mobile_access_override_user FOREIGN KEY (application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

-- A missing-row SELECT is not a reliable concurrency lock. Reserve each
-- client gift request first so simultaneous transport retries serialize on
-- one durable key before either wallet is touched.
CREATE TABLE gift_idempotency_requests (
  idempotency_key VARCHAR(120) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  room_code VARCHAR(80) NOT NULL,
  gift_key VARCHAR(80) NOT NULL,
  recipient_public_id BIGINT UNSIGNED NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gift_idempotency_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CHECK (quantity BETWEEN 1 AND 99),
  INDEX idx_gift_idempotency_user_created (application_user_id, created_at)
) ENGINE=InnoDB;

INSERT INTO mobile_access_overrides (application_user_id, host_access_override, note)
SELECT id, TRUE, 'Nazraa owner mobile test account'
FROM application_users
WHERE public_id = 12000006
ON DUPLICATE KEY UPDATE host_access_override = TRUE, note = VALUES(note);

CREATE TABLE withdrawal_hierarchy_snapshots (
  withdrawal_id CHAR(36) PRIMARY KEY,
  host_application_user_id CHAR(36) NOT NULL,
  host_public_id BIGINT UNSIGNED NOT NULL,
  host_name VARCHAR(120) NOT NULL,
  agency_account_id CHAR(36) NULL,
  agency_public_id BIGINT UNSIGNED NULL,
  agency_name VARCHAR(120) NULL,
  bd_account_id CHAR(36) NULL,
  bd_public_id BIGINT UNSIGNED NULL,
  bd_name VARCHAR(120) NULL,
  admin_account_id CHAR(36) NULL,
  admin_public_id BIGINT UNSIGNED NULL,
  admin_name VARCHAR(120) NULL,
  super_admin_account_id CHAR(36) NULL,
  super_admin_public_id BIGINT UNSIGNED NULL,
  super_admin_name VARCHAR(120) NULL,
  country_manager_account_id CHAR(36) NULL,
  country_manager_public_id BIGINT UNSIGNED NULL,
  country_manager_name VARCHAR(120) NULL,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_withdrawal_hierarchy_request FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  INDEX idx_withdrawal_hierarchy_agency (agency_account_id, captured_at),
  INDEX idx_withdrawal_hierarchy_host (host_application_user_id, captured_at)
) ENGINE=InnoDB;

CREATE TABLE withdrawal_distribution_snapshots (
  withdrawal_id CHAR(36) PRIMARY KEY,
  slab_diamonds BIGINT UNSIGNED NOT NULL,
  slab_count INT UNSIGNED NOT NULL,
  total_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  host_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  agency_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  super_admin_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  admin_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  bd_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  country_manager_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  company_usd_cents_per_slab SMALLINT UNSIGNED NOT NULL,
  total_usd DECIMAL(18,2) NOT NULL,
  host_usd DECIMAL(18,2) NOT NULL,
  agency_usd DECIMAL(18,2) NOT NULL,
  super_admin_usd DECIMAL(18,2) NOT NULL,
  admin_usd DECIMAL(18,2) NOT NULL,
  bd_usd DECIMAL(18,2) NOT NULL,
  country_manager_usd DECIMAL(18,2) NOT NULL,
  company_usd DECIMAL(18,2) NOT NULL,
  usd_inr_rate DECIMAL(18,6) NOT NULL,
  total_inr DECIMAL(18,2) NOT NULL,
  host_inr DECIMAL(18,2) NOT NULL,
  agency_inr DECIMAL(18,2) NOT NULL,
  super_admin_inr DECIMAL(18,2) NOT NULL,
  admin_inr DECIMAL(18,2) NOT NULL,
  bd_inr DECIMAL(18,2) NOT NULL,
  country_manager_inr DECIMAL(18,2) NOT NULL,
  company_inr DECIMAL(18,2) NOT NULL,
  completed_by CHAR(36) NOT NULL,
  provider_reference VARCHAR(120) NOT NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_withdrawal_distribution_request FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  CONSTRAINT fk_withdrawal_distribution_actor FOREIGN KEY (completed_by) REFERENCES platform_accounts(id),
  CHECK (slab_diamonds > 0),
  CHECK (slab_count > 0),
  INDEX idx_withdrawal_distribution_completed (completed_at)
) ENGINE=InnoDB;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.gift_economy', JSON_OBJECT(
  'giftCoinUnits', 100,
  'receiverDiamondUnits', 97
), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.giftCoinUnits', 100,
  '$.receiverDiamondUnits', 97
);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'withdrawal.economy', JSON_OBJECT(
  'slabDiamonds', 100000,
  'totalUsdCents', 1170,
  'hostUsdCents', 800,
  'agencyUsdCents', 100,
  'superAdminUsdCents', 58,
  'adminUsdCents', 18,
  'bdUsdCents', 17,
  'countryManagerUsdCents', 35,
  'companyUsdCents', 142,
  'usdInrRate', 90
), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.minimumWithdrawal', 100000,
  '$.withdrawalSlab', 100000
)
WHERE setting_key = 'mobile.commerce';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.8',
  '$.latestBuild', 5318
)
WHERE setting_key = 'mobile.app_config';

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'Eligible Video/Face Live time earns 3,500 Diamonds per valid hour under the current server rule.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;
