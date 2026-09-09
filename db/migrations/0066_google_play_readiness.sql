-- Google Play readiness: reliable Agency lookup/application idempotency,
-- review-based selfie verification, safety/deletion queues, policy acceptance,
-- Play Billing reconciliation, and authoritative Play-v1 commerce gates.

ALTER TABLE platform_accounts
  ADD INDEX idx_agency_public_directory (role, status, full_name, public_id);

CREATE TABLE agency_membership_application_keys (
  application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (application_user_id, agency_account_id),
  CONSTRAINT fk_agency_application_key_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_agency_application_key_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO agency_membership_application_keys (application_user_id, agency_account_id)
SELECT application_user_id, agency_account_id FROM agency_membership_applications;

ALTER TABLE face_verification_requests
  ADD COLUMN client_submission_id CHAR(36) NULL AFTER application_user_id,
  ADD UNIQUE KEY uq_face_verification_submission (application_user_id, client_submission_id);

ALTER TABLE mobile_access_overrides
  ADD COLUMN play_reviewer_access_override BOOLEAN NOT NULL DEFAULT FALSE AFTER host_access_override;

CREATE TABLE play_reviewer_credentials (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  reviewer_role ENUM('HOST','VIEWER') NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_play_reviewer_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_play_reviewer_active (active, reviewer_role)
) ENGINE=InnoDB;

ALTER TABLE coin_packages
  ADD COLUMN play_product_id VARCHAR(120) NULL AFTER badge_label,
  ADD UNIQUE KEY uq_coin_package_play_product (play_product_id);

CREATE TABLE google_play_coin_purchases (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  coin_package_id CHAR(36) NOT NULL,
  product_id VARCHAR(120) NOT NULL,
  purchase_token_hash CHAR(64) NOT NULL,
  order_id VARCHAR(190) NULL,
  purchase_time_ms BIGINT UNSIGNED NULL,
  purchase_state TINYINT UNSIGNED NULL,
  acknowledgement_state TINYINT UNSIGNED NULL,
  consumption_state TINYINT UNSIGNED NULL,
  status ENUM('RECEIVED','VERIFIED','DELIVERED','DELIVERED_PENDING_CONSUME','CONSUMED','REJECTED') NOT NULL DEFAULT 'RECEIVED',
  coin_amount BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NULL,
  provider_payload JSON NULL,
  verified_at DATETIME(3) NULL,
  delivered_at DATETIME(3) NULL,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_play_purchase_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_play_purchase_package FOREIGN KEY (coin_package_id) REFERENCES coin_packages(id),
  CONSTRAINT fk_play_purchase_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  UNIQUE KEY uq_play_purchase_token (purchase_token_hash),
  INDEX idx_play_purchase_user_time (application_user_id, created_at),
  INDEX idx_play_purchase_status (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE policy_acceptances (
  application_user_id CHAR(36) NOT NULL,
  policy_key VARCHAR(80) NOT NULL,
  policy_version VARCHAR(32) NOT NULL,
  accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  source ENUM('ONBOARDING','IN_APP','PLAY_REVIEWER') NOT NULL DEFAULT 'IN_APP',
  PRIMARY KEY (application_user_id, policy_key, policy_version),
  CONSTRAINT fk_policy_acceptance_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_policy_acceptance_version (policy_key, policy_version, accepted_at)
) ENGINE=InnoDB;

CREATE TABLE safety_reports (
  id CHAR(36) PRIMARY KEY,
  client_report_id CHAR(36) NOT NULL,
  reporter_application_user_id CHAR(36) NOT NULL,
  report_type ENUM('PROFILE','USER','HOST','ROOM','CONTENT','DIRECT_MESSAGE','CHILD_SAFETY','COPYRIGHT') NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  reason_detail VARCHAR(500) NULL,
  target_application_user_id CHAR(36) NULL,
  room_id CHAR(36) NULL,
  content_id CHAR(36) NULL,
  message_id CHAR(36) NULL,
  evidence_metadata JSON NULL,
  severity ENUM('NORMAL','HIGH','CRITICAL') NOT NULL DEFAULT 'NORMAL',
  status ENUM('NEW','UNDER_REVIEW','ACTIONED','DISMISSED') NOT NULL DEFAULT 'NEW',
  assigned_to CHAR(36) NULL,
  action_note VARCHAR(500) NULL,
  actioned_by CHAR(36) NULL,
  actioned_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_safety_reporter FOREIGN KEY (reporter_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_safety_target_user FOREIGN KEY (target_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_safety_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_safety_message FOREIGN KEY (message_id) REFERENCES private_messages(id),
  CONSTRAINT fk_safety_assignee FOREIGN KEY (assigned_to) REFERENCES platform_accounts(id),
  CONSTRAINT fk_safety_actor FOREIGN KEY (actioned_by) REFERENCES platform_accounts(id),
  UNIQUE KEY uq_safety_report_client (reporter_application_user_id, client_report_id),
  INDEX idx_safety_queue (status, severity, created_at),
  INDEX idx_safety_target (target_application_user_id, created_at)
) ENGINE=InnoDB;

ALTER TABLE application_users
  ADD COLUMN deletion_requested_at DATETIME(3) NULL AFTER onboarding_completed,
  ADD COLUMN public_profile_hidden BOOLEAN NOT NULL DEFAULT FALSE AFTER deletion_requested_at;

CREATE TABLE account_deletion_requests (
  id CHAR(36) PRIMARY KEY,
  request_code VARCHAR(48) NOT NULL UNIQUE,
  application_user_id CHAR(36) NULL,
  source ENUM('IN_APP','WEB') NOT NULL,
  requester_email_hash CHAR(64) NULL,
  requester_email_encrypted LONGBLOB NULL,
  requester_email_iv BINARY(12) NULL,
  requester_email_tag BINARY(16) NULL,
  status ENUM('REQUESTED','IDENTITY_REVIEW','PROCESSING','COMPLETED','REJECTED') NOT NULL DEFAULT 'REQUESTED',
  retention_summary JSON NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  processed_by CHAR(36) NULL,
  process_note VARCHAR(500) NULL,
  CONSTRAINT fk_deletion_request_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_deletion_request_actor FOREIGN KEY (processed_by) REFERENCES platform_accounts(id),
  INDEX idx_deletion_queue (status, requested_at),
  INDEX idx_deletion_user (application_user_id, requested_at),
  INDEX idx_deletion_email (requester_email_hash, requested_at)
) ENGINE=InnoDB;

CREATE TABLE public_support_requests (
  id CHAR(36) PRIMARY KEY,
  request_code VARCHAR(48) NOT NULL UNIQUE,
  category ENUM('ACCOUNT','VERIFICATION','AGENCY','PURCHASE','SAFETY','PRIVACY','DELETION','CHILD_SAFETY','COPYRIGHT') NOT NULL,
  contact_email_hash CHAR(64) NOT NULL,
  contact_email_encrypted LONGBLOB NOT NULL,
  contact_email_iv BINARY(12) NOT NULL,
  contact_email_tag BINARY(16) NOT NULL,
  subject VARCHAR(160) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  status ENUM('NEW','UNDER_REVIEW','RESOLVED','CLOSED') NOT NULL DEFAULT 'NEW',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_public_support_queue (category, status, created_at)
) ENGINE=InnoDB;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.withdrawalEnabled', FALSE,
  '$.creatorCashWithdrawalsEnabled', FALSE,
  '$.coinSellerEnabled', FALSE,
  '$.googlePlayBillingEnabled', TRUE
)
WHERE setting_key = 'mobile.features';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.coinPurchaseMethod', 'GOOGLE_PLAY',
  '$.creatorCashWithdrawalsEnabled', FALSE
)
WHERE setting_key = 'mobile.commerce';

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.policy_config', JSON_OBJECT(
  'privacyUrl', 'https://nazraa.vercel.app/privacy',
  'termsUrl', 'https://nazraa.vercel.app/terms',
  'communityGuidelinesUrl', 'https://nazraa.vercel.app/community-guidelines',
  'childSafetyUrl', 'https://nazraa.vercel.app/child-safety',
  'accountDeletionUrl', 'https://nazraa.vercel.app/account-deletion',
  'supportUrl', 'https://nazraa.vercel.app/support',
  'refundsUrl', 'https://nazraa.vercel.app/refunds',
  'copyrightUrl', 'https://nazraa.vercel.app/copyright',
  'termsVersion', '2026-09-06',
  'communityGuidelinesVersion', '2026-09-06',
  'requiresReacceptance', TRUE,
  'reportReasons', JSON_ARRAY('sexual_content','harassment','threats','hate','scam','impersonation','privacy','violence','illegal_activity','spam','copyright','child_safety','other')
), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.30',
  '$.latestBuild', 5340
)
WHERE setting_key = 'mobile.app_config';
