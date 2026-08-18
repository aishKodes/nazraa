-- Nazraa Live production mobile integration.
-- This migration adds numeric public IDs, revocable mobile sessions, the
-- agency/seller commerce workflow, Face Live review, and mobile notifications.

ALTER TABLE platform_accounts
  ADD COLUMN public_id BIGINT UNSIGNED NULL AFTER id;
SET @nazraa_platform_public_id = 47999999;
UPDATE platform_accounts
SET public_id = (@nazraa_platform_public_id := @nazraa_platform_public_id + 1)
ORDER BY created_at, id;
ALTER TABLE platform_accounts
  MODIFY COLUMN public_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD UNIQUE KEY uq_platform_account_public_id (public_id);
ALTER TABLE platform_accounts AUTO_INCREMENT = 48000000;

ALTER TABLE application_users
  ADD COLUMN public_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN vip_tier TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER level_number,
  ADD COLUMN consumption_points BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER vip_tier,
  ADD COLUMN anchor_income_points BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER consumption_points,
  ADD COLUMN face_verification_status ENUM('NOT_SUBMITTED','PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'NOT_SUBMITTED' AFTER is_host;
SET @nazraa_user_public_id = 11999999;
UPDATE application_users
SET public_id = (@nazraa_user_public_id := @nazraa_user_public_id + 1)
ORDER BY created_at, id;
ALTER TABLE application_users
  MODIFY COLUMN public_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ADD UNIQUE KEY uq_application_user_public_id (public_id);
ALTER TABLE application_users AUTO_INCREMENT = 12000000;

ALTER TABLE seller_profiles
  ADD COLUMN business_whatsapp_e164 VARCHAR(20) NULL AFTER available_for_sales,
  ADD COLUMN whatsapp_public BOOLEAN NOT NULL DEFAULT FALSE AFTER business_whatsapp_e164,
  ADD COLUMN availability_status ENUM('AVAILABLE','OFFLINE') NOT NULL DEFAULT 'OFFLINE' AFTER whatsapp_public,
  ADD COLUMN supported_region VARCHAR(80) NULL AFTER availability_status;

ALTER TABLE private_documents
  MODIFY COLUMN owner_type ENUM('PLATFORM_ACCOUNT','HOST_APPLICATION','FACE_VERIFICATION') NOT NULL;

ALTER TABLE live_rooms
  MODIFY COLUMN room_type ENUM('LIVE','PARTY','FACE') NOT NULL;

CREATE TABLE mobile_sessions (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  device_label VARCHAR(120) NULL,
  expires_at DATETIME(3) NOT NULL,
  last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_mobile_session_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_mobile_session_user (application_user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

CREATE TABLE coin_packages (
  id CHAR(36) PRIMARY KEY,
  public_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  name VARCHAR(100) NOT NULL,
  coin_amount BIGINT UNSIGNED NOT NULL,
  display_price DECIMAL(18,2) NULL,
  currency CHAR(3) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_coin_package_creator FOREIGN KEY (created_by) REFERENCES platform_accounts(id),
  INDEX idx_coin_package_active (active, sort_order, coin_amount)
) ENGINE=InnoDB AUTO_INCREMENT=65000000;

CREATE TABLE seller_package_support (
  seller_account_id CHAR(36) NOT NULL,
  coin_package_id CHAR(36) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (seller_account_id, coin_package_id),
  CONSTRAINT fk_seller_package_seller FOREIGN KEY (seller_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_seller_package_package FOREIGN KEY (coin_package_id) REFERENCES coin_packages(id)
) ENGINE=InnoDB;

CREATE TABLE coin_purchase_requests (
  id CHAR(36) PRIMARY KEY,
  public_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  seller_account_id CHAR(36) NOT NULL,
  coin_package_id CHAR(36) NOT NULL,
  coin_amount BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING_CONTACT','PAYMENT_PENDING','SELLER_REVIEWING','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING_CONTACT',
  completed_ledger_transaction_id CHAR(36) NULL,
  review_note VARCHAR(500) NULL,
  completed_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_coin_order_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_coin_order_seller FOREIGN KEY (seller_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_coin_order_package FOREIGN KEY (coin_package_id) REFERENCES coin_packages(id),
  CONSTRAINT fk_coin_order_ledger FOREIGN KEY (completed_ledger_transaction_id) REFERENCES ledger_transactions(id),
  CONSTRAINT fk_coin_order_completer FOREIGN KEY (completed_by) REFERENCES platform_accounts(id),
  INDEX idx_coin_order_user (application_user_id, created_at),
  INDEX idx_coin_order_seller (seller_account_id, status, created_at)
) ENGINE=InnoDB AUTO_INCREMENT=87000000;

CREATE TABLE mobile_notifications (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  notification_type VARCHAR(48) NOT NULL,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  action_target VARCHAR(500) NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_mobile_notification_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_mobile_notification_user (application_user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE user_follows (
  follower_application_user_id CHAR(36) NOT NULL,
  followed_application_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (follower_application_user_id, followed_application_user_id),
  CONSTRAINT fk_user_follow_follower FOREIGN KEY (follower_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_user_follow_followed FOREIGN KEY (followed_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

CREATE TABLE agency_follows (
  application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (application_user_id, agency_account_id),
  CONSTRAINT fk_agency_follow_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_agency_follow_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE face_verification_requests (
  id CHAR(36) PRIMARY KEY,
  public_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  selfie_document_id CHAR(36) NULL,
  status ENUM('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_face_request_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_face_request_document FOREIGN KEY (selfie_document_id) REFERENCES private_documents(id),
  CONSTRAINT fk_face_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES platform_accounts(id),
  INDEX idx_face_request_status (status, created_at),
  INDEX idx_face_request_user (application_user_id, created_at)
) ENGINE=InnoDB AUTO_INCREMENT=91000000;

CREATE TABLE payout_methods (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  method_type ENUM('BANK','UPI','WALLET') NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  masked_destination VARCHAR(160) NOT NULL,
  destination_encrypted LONGBLOB NULL,
  destination_iv BINARY(12) NULL,
  destination_tag BINARY(16) NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_payout_method_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_payout_method_user (application_user_id, active)
) ENGINE=InnoDB;

ALTER TABLE withdrawal_requests
  ADD COLUMN payout_method_id CHAR(36) NULL AFTER payout_method_masked,
  ADD CONSTRAINT fk_withdrawal_payout_method FOREIGN KEY (payout_method_id) REFERENCES payout_methods(id);

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.features', JSON_OBJECT(
  'videoLiveEnabled', TRUE,
  'faceLiveEnabled', TRUE,
  'beautyEnabled', TRUE,
  'withdrawalEnabled', TRUE,
  'coinSellerEnabled', TRUE,
  'gamesEnabled', FALSE
), id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1;

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.commerce', JSON_OBJECT(
  'coinPurchaseMethod', 'AGENCY_WHATSAPP',
  'whatsappMessageTemplate', 'Hello, I want to purchase Nazraa Live coins.\n\nMy User ID: {userId}\nAgency ID: {agencyId}\nSelected Package: {package}\nOrder ID: {orderId}\n\nPlease share payment details.',
  'minimumWithdrawal', 1000,
  'withdrawalPortalUrl', '',
  'supportUrl', ''
), id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1;

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.levels', JSON_OBJECT(
  'maximumLevel', 120,
  'entryEffectLevel', 20,
  'premiumEntryEffectLevel', 60
), id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1;
