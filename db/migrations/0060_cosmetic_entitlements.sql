-- One entitlement/equipment model powers both VIP grants and Mall purchases.
-- Existing virtual-gift rows keep their identifiers and ledger relationships.

ALTER TABLE gift_catalog
  MODIFY COLUMN catalog_type ENUM(
    'VIRTUAL_GIFT',
    'ENTRY_FRAME',
    'ENTRY_EFFECT',
    'AVATAR_FRAME',
    'PROFILE_EFFECT',
    'CHAT_FRAME',
    'MEDAL',
    'BADGE'
  ) NOT NULL DEFAULT 'VIRTUAL_GIFT',
  MODIFY COLUMN animation_key VARCHAR(500) NULL,
  ADD COLUMN currency ENUM('COIN') NOT NULL DEFAULT 'COIN' AFTER coin_price,
  ADD COLUMN validity_days SMALLINT UNSIGNED NOT NULL DEFAULT 30 AFTER currency,
  ADD COLUMN vip_tier_eligibility TINYINT UNSIGNED NULL AFTER validity_days,
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER vip_tier_eligibility,
  ADD COLUMN asset_config JSON NULL AFTER animation_key,
  ADD INDEX idx_catalog_mobile_order (catalog_type, active, sort_order, coin_price),
  ADD INDEX idx_catalog_vip_grant (vip_tier_eligibility, active);

CREATE TABLE user_cosmetic_entitlements (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  gift_catalog_id CHAR(36) NOT NULL,
  source ENUM('MALL','VIP') NOT NULL,
  acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  equipped_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  grant_reference VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_cosmetic_entitlement_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_cosmetic_entitlement_catalog FOREIGN KEY (gift_catalog_id) REFERENCES gift_catalog(id),
  INDEX idx_cosmetic_user_active (application_user_id, revoked_at, expires_at),
  INDEX idx_cosmetic_user_equipped (application_user_id, equipped_at, expires_at),
  INDEX idx_cosmetic_catalog (gift_catalog_id)
) ENGINE=InnoDB;

CREATE TABLE cosmetic_purchase_requests (
  id CHAR(36) PRIMARY KEY,
  request_key VARCHAR(120) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  gift_catalog_id CHAR(36) NOT NULL,
  entitlement_id CHAR(36) NULL,
  coin_price BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  CONSTRAINT fk_cosmetic_purchase_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_cosmetic_purchase_catalog FOREIGN KEY (gift_catalog_id) REFERENCES gift_catalog(id),
  CONSTRAINT fk_cosmetic_purchase_entitlement FOREIGN KEY (entitlement_id) REFERENCES user_cosmetic_entitlements(id),
  INDEX idx_cosmetic_purchase_user (application_user_id, created_at)
) ENGINE=InnoDB;
