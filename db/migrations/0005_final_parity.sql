-- Final mobile parity primitives. All membership and paid-message mutations
-- remain server-authoritative; uploaded public media is stored behind Nazraa
-- asset routes instead of operator-supplied URLs.

SET @nazraa_management_public_id = 99999;
UPDATE platform_accounts
SET public_id = (@nazraa_management_public_id := @nazraa_management_public_id + 1)
ORDER BY created_at, id;
ALTER TABLE platform_accounts
  MODIFY COLUMN public_id INT UNSIGNED NOT NULL,
  ADD CONSTRAINT chk_platform_account_public_id CHECK (public_id BETWEEN 100000 AND 999999);

CREATE TABLE agency_membership_applications (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NOT NULL,
  status ENUM('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_agency_join_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_agency_join_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_agency_join_reviewer FOREIGN KEY (reviewed_by) REFERENCES platform_accounts(id),
  INDEX idx_agency_join_user (application_user_id, status, created_at),
  INDEX idx_agency_join_review (agency_account_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE agency_creation_applications (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  agency_name VARCHAR(120) NOT NULL,
  country_code CHAR(2) NOT NULL,
  business_whatsapp_e164 VARCHAR(20) NOT NULL,
  logo_mime_type VARCHAR(80) NULL,
  logo_data MEDIUMBLOB NULL,
  logo_byte_size INT UNSIGNED NULL,
  status ENUM('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  approved_agency_account_id CHAR(36) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_agency_create_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_agency_create_account FOREIGN KEY (approved_agency_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_agency_create_reviewer FOREIGN KEY (reviewed_by) REFERENCES platform_accounts(id),
  INDEX idx_agency_create_user (application_user_id, status, created_at),
  INDEX idx_agency_create_review (status, created_at),
  CHECK (logo_byte_size IS NULL OR logo_byte_size BETWEEN 1000 AND 1048576)
) ENGINE=InnoDB;

CREATE TABLE gift_assets (
  id CHAR(36) PRIMARY KEY,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gift_asset_uploader FOREIGN KEY (uploaded_by) REFERENCES platform_accounts(id),
  CHECK (byte_size BETWEEN 1000 AND 1048576)
) ENGINE=InnoDB;

CREATE TABLE banner_assets (
  id CHAR(36) PRIMARY KEY,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_banner_asset_uploader FOREIGN KEY (uploaded_by) REFERENCES platform_accounts(id),
  CHECK (byte_size BETWEEN 1000 AND 2097152)
) ENGINE=InnoDB;

CREATE TABLE room_photo_assets (
  id CHAR(36) PRIMARY KEY,
  owner_application_user_id CHAR(36) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_room_photo_owner FOREIGN KEY (owner_application_user_id) REFERENCES application_users(id),
  CHECK (byte_size BETWEEN 1000 AND 1572864)
) ENGINE=InnoDB;

CREATE TABLE discovery_post_assets (
  id CHAR(36) PRIMARY KEY,
  owner_application_user_id CHAR(36) NOT NULL,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_discovery_asset_owner FOREIGN KEY (owner_application_user_id) REFERENCES application_users(id),
  CHECK (byte_size BETWEEN 1000 AND 1572864)
) ENGINE=InnoDB;

CREATE TABLE discovery_posts (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  asset_id CHAR(36) NOT NULL,
  caption VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('VISIBLE','UNDER_REVIEW','HIDDEN','REMOVED') NOT NULL DEFAULT 'VISIBLE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_discovery_post_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_discovery_post_asset FOREIGN KEY (asset_id) REFERENCES discovery_post_assets(id),
  INDEX idx_discovery_post_feed (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE discovery_post_reports (
  post_id CHAR(36) NOT NULL,
  reporter_application_user_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (post_id, reporter_application_user_id),
  CONSTRAINT fk_discovery_report_post FOREIGN KEY (post_id) REFERENCES discovery_posts(id),
  CONSTRAINT fk_discovery_report_user FOREIGN KEY (reporter_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

CREATE TABLE private_messages (
  id CHAR(36) PRIMARY KEY,
  client_message_id CHAR(36) NOT NULL,
  sender_application_user_id CHAR(36) NOT NULL,
  recipient_application_user_id CHAR(36) NOT NULL,
  body VARCHAR(1000) NOT NULL,
  coin_cost BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_private_message_sender FOREIGN KEY (sender_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_private_message_recipient FOREIGN KEY (recipient_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_private_message_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  INDEX idx_private_message_sender (sender_application_user_id, recipient_application_user_id, created_at),
  INDEX idx_private_message_recipient (recipient_application_user_id, sender_application_user_id, read_at, created_at),
  UNIQUE KEY uq_private_message_client (sender_application_user_id, client_message_id)
) ENGINE=InnoDB;

CREATE TABLE private_message_blocks (
  blocker_application_user_id CHAR(36) NOT NULL,
  blocked_application_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (blocker_application_user_id, blocked_application_user_id),
  CONSTRAINT fk_message_blocker FOREIGN KEY (blocker_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_message_blocked FOREIGN KEY (blocked_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

CREATE TABLE private_message_reports (
  message_id CHAR(36) NOT NULL,
  reporter_application_user_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id, reporter_application_user_id),
  CONSTRAINT fk_message_report_message FOREIGN KEY (message_id) REFERENCES private_messages(id),
  CONSTRAINT fk_message_report_user FOREIGN KEY (reporter_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

ALTER TABLE live_rooms
  ADD COLUMN title VARCHAR(80) NOT NULL DEFAULT 'Nazraa room' AFTER room_type,
  ADD COLUMN category VARCHAR(40) NOT NULL DEFAULT 'Talk' AFTER title,
  ADD COLUMN language_code VARCHAR(32) NOT NULL DEFAULT 'Hindi' AFTER category,
  ADD COLUMN privacy ENUM('PUBLIC','FOLLOWERS','LOCKED') NOT NULL DEFAULT 'PUBLIC' AFTER language_code,
  ADD COLUMN seat_count TINYINT UNSIGNED NOT NULL DEFAULT 8 AFTER privacy,
  ADD COLUMN theme_index TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER seat_count,
  ADD COLUMN room_photo_asset_id CHAR(36) NULL AFTER audience_count,
  ADD COLUMN country_code CHAR(2) NULL AFTER room_photo_asset_id,
  ADD CONSTRAINT fk_live_room_photo FOREIGN KEY (room_photo_asset_id) REFERENCES room_photo_assets(id);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.social', JSON_OBJECT('private_message_coin_cost', 50), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = JSON_SET(setting_value, '$.private_message_coin_cost', 50);
