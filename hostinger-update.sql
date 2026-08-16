-- Nazraa Control Platform operational modules.
-- Import once after 0001_initial.sql on existing Hostinger databases.

ALTER TABLE host_profiles
  ADD COLUMN legal_name VARCHAR(120) NULL AFTER application_user_id,
  ADD COLUMN country_code CHAR(2) NULL AFTER agency_account_id,
  ADD COLUMN government_id_type VARCHAR(80) NULL AFTER verification_status,
  ADD COLUMN government_id_last4 VARCHAR(8) NULL AFTER government_id_type,
  ADD COLUMN applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER government_id_last4;

CREATE TABLE private_documents (
  id CHAR(36) PRIMARY KEY,
  owner_type ENUM('PLATFORM_ACCOUNT','HOST_APPLICATION') NOT NULL,
  owner_id CHAR(36) NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  encrypted_data LONGBLOB NOT NULL,
  encryption_iv BINARY(12) NOT NULL,
  encryption_tag BINARY(16) NOT NULL,
  verification_status ENUM('PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
  uploaded_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_private_document_uploader FOREIGN KEY (uploaded_by) REFERENCES platform_accounts(id),
  INDEX idx_private_document_owner (owner_type, owner_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE account_status_history (
  id CHAR(36) PRIMARY KEY,
  account_id CHAR(36) NOT NULL,
  from_status VARCHAR(24) NOT NULL,
  to_status VARCHAR(24) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  actor_account_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_account_history_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_account_history_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_account_history (account_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE seller_profiles (
  account_id CHAR(36) PRIMARY KEY,
  verification_status ENUM('UNVERIFIED','PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'PENDING',
  commission_rate DECIMAL(7,4) NOT NULL DEFAULT 0,
  available_for_sales BOOLEAN NOT NULL DEFAULT FALSE,
  support_url VARCHAR(500) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_seller_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE gift_catalog (
  id CHAR(36) PRIMARY KEY,
  gift_key VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(60) NOT NULL,
  coin_price BIGINT UNSIGNED NOT NULL,
  visual_url VARCHAR(500) NULL,
  animation_key VARCHAR(120) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_gift_creator FOREIGN KEY (created_by) REFERENCES platform_accounts(id),
  INDEX idx_gift_active_order (active, coin_price)
) ENGINE=InnoDB;

CREATE TABLE banners (
  id CHAR(36) PRIMARY KEY,
  placement VARCHAR(60) NOT NULL,
  title VARCHAR(120) NOT NULL,
  subtitle VARCHAR(240) NULL,
  image_url VARCHAR(500) NOT NULL,
  action_type VARCHAR(40) NOT NULL DEFAULT 'NONE',
  action_target VARCHAR(500) NULL,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  priority INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_banner_creator FOREIGN KEY (created_by) REFERENCES platform_accounts(id),
  INDEX idx_banner_publish (placement, active, starts_at, ends_at, priority)
) ENGINE=InnoDB;

CREATE TABLE platform_notifications (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  audience_role VARCHAR(32) NULL,
  audience_account_id CHAR(36) NULL,
  action_target VARCHAR(500) NULL,
  status ENUM('DRAFT','SCHEDULED','PUBLISHED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  scheduled_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notification_audience FOREIGN KEY (audience_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_notification_creator FOREIGN KEY (created_by) REFERENCES platform_accounts(id),
  INDEX idx_notification_status_schedule (status, scheduled_at)
) ENGINE=InnoDB;

CREATE TABLE support_tickets (
  id CHAR(36) PRIMARY KEY,
  ticket_code VARCHAR(40) NOT NULL UNIQUE,
  application_user_id CHAR(36) NULL,
  subject VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  priority ENUM('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
  status ENUM('OPEN','IN_PROGRESS','WAITING_USER','RESOLVED','CLOSED') NOT NULL DEFAULT 'OPEN',
  assigned_to CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ticket_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_ticket_assignee FOREIGN KEY (assigned_to) REFERENCES platform_accounts(id),
  INDEX idx_ticket_queue (status, priority, updated_at)
) ENGINE=InnoDB;

CREATE TABLE support_messages (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  sender_type ENUM('APPLICATION_USER','PLATFORM_ACCOUNT','SYSTEM') NOT NULL,
  sender_id CHAR(36) NULL,
  message VARCHAR(2000) NOT NULL,
  internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_support_message_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
  INDEX idx_support_message_thread (ticket_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE system_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by CHAR(36) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_setting_updater FOREIGN KEY (updated_by) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'economy.diamond_conversion', JSON_OBJECT('rate', 1, 'minimum', 1000, 'currency', 'INR'), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1;
