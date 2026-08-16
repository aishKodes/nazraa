-- Nazraa Control Platform: MySQL 8.0+ initial schema.
-- Apply with a least-privileged deployment user. This migration has no public client access.

CREATE TABLE IF NOT EXISTS platform_accounts (
  id CHAR(36) PRIMARY KEY,
  role ENUM('MASTER','SUPER_ADMIN','ADMIN','AGENCY','COIN_SELLER','MONITORING_CS') NOT NULL,
  role_code VARCHAR(32) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  application_user_id VARCHAR(80) NULL UNIQUE,
  email VARCHAR(190) NULL UNIQUE,
  mobile VARCHAR(24) NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  parent_account_id CHAR(36) NULL,
  country_code CHAR(2) NULL,
  created_by CHAR(36) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_account_parent FOREIGN KEY (parent_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_account_creator FOREIGN KEY (created_by) REFERENCES platform_accounts(id),
  INDEX idx_account_parent (parent_account_id),
  INDEX idx_account_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS application_users (
  id CHAR(36) PRIMARY KEY,
  external_user_id VARCHAR(80) NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  country_code CHAR(2) NULL,
  account_status ENUM('ACTIVE','INACTIVE','SUSPENDED','BANNED') NOT NULL DEFAULT 'ACTIVE',
  level_number INT NOT NULL DEFAULT 1,
  agency_account_id CHAR(36) NULL,
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  last_active_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id),
  INDEX idx_user_agency (agency_account_id),
  INDEX idx_user_status (account_status, created_at),
  INDEX idx_user_external (external_user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS host_profiles (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL UNIQUE,
  agency_account_id CHAR(36) NULL,
  status ENUM('PENDING','APPROVED','ACTIVE','INACTIVE','SUSPENDED','REJECTED') NOT NULL DEFAULT 'PENDING',
  verification_status ENUM('UNVERIFIED','PENDING','VERIFIED','REJECTED','EXPIRED') NOT NULL DEFAULT 'UNVERIFIED',
  live_minutes_30d INT NOT NULL DEFAULT 0,
  sessions_30d INT NOT NULL DEFAULT 0,
  gifts_value_30d BIGINT NOT NULL DEFAULT 0,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_host_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_host_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_host_reviewer FOREIGN KEY (reviewed_by) REFERENCES platform_accounts(id),
  INDEX idx_host_agency_status (agency_account_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wallet_balances (
  id CHAR(36) PRIMARY KEY,
  owner_type ENUM('PLATFORM_ACCOUNT','APPLICATION_USER') NOT NULL,
  owner_id CHAR(36) NOT NULL,
  asset_type ENUM('COIN','DIAMOND') NOT NULL,
  available_balance BIGINT NOT NULL DEFAULT 0,
  reserved_balance BIGINT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wallet_owner_asset (owner_type, owner_id, asset_type),
  CHECK (available_balance >= 0),
  CHECK (reserved_balance >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id CHAR(36) PRIMARY KEY,
  transaction_code VARCHAR(48) NOT NULL UNIQUE,
  idempotency_key VARCHAR(120) NULL UNIQUE,
  asset_type ENUM('COIN','DIAMOND','CASH') NOT NULL,
  transaction_type VARCHAR(48) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id CHAR(36) NULL,
  destination_type VARCHAR(32) NOT NULL,
  destination_id CHAR(36) NULL,
  amount BIGINT NOT NULL,
  money_amount DECIMAL(18,2) NULL,
  currency CHAR(3) NULL,
  payment_method VARCHAR(40) NULL,
  status ENUM('PENDING','COMPLETED','REVERSED','FAILED') NOT NULL DEFAULT 'COMPLETED',
  reason VARCHAR(500) NULL,
  actor_account_id CHAR(36) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ledger_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_ledger_source (source_id, created_at),
  INDEX idx_ledger_destination (destination_id, created_at),
  INDEX idx_ledger_created (created_at),
  INDEX idx_ledger_type_status (transaction_type, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coin_transfers (
  id CHAR(36) PRIMARY KEY,
  transfer_code VARCHAR(48) NOT NULL UNIQUE,
  sender_account_id CHAR(36) NOT NULL,
  recipient_application_user_id CHAR(36) NOT NULL,
  amount BIGINT NOT NULL,
  sender_before BIGINT NOT NULL,
  sender_after BIGINT NOT NULL,
  recipient_before BIGINT NOT NULL,
  recipient_after BIGINT NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_transfer_sender FOREIGN KEY (sender_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_transfer_recipient FOREIGN KEY (recipient_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_transfer_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  CHECK (amount > 0),
  INDEX idx_transfer_sender_created (sender_account_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id CHAR(36) PRIMARY KEY,
  withdrawal_code VARCHAR(48) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NULL,
  amount BIGINT NOT NULL,
  net_payout DECIMAL(18,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  payout_method_masked VARCHAR(160) NULL,
  status ENUM('PENDING','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_reason VARCHAR(500) NULL,
  provider_reference VARCHAR(120) NULL,
  CONSTRAINT fk_withdrawal_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_withdrawal_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id),
  CONSTRAINT fk_withdrawal_reviewer FOREIGN KEY (reviewed_by) REFERENCES platform_accounts(id),
  INDEX idx_withdrawal_status_requested (status, requested_at),
  INDEX idx_withdrawal_agency (agency_account_id, requested_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS withdrawal_status_history (
  id CHAR(36) PRIMARY KEY,
  withdrawal_id CHAR(36) NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NOT NULL,
  actor_account_id CHAR(36) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_withdrawal_history_request FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  CONSTRAINT fk_withdrawal_history_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_withdrawal_history (withdrawal_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_rooms (
  id CHAR(36) PRIMARY KEY,
  room_code VARCHAR(80) NOT NULL UNIQUE,
  host_application_user_id CHAR(36) NOT NULL,
  agency_account_id CHAR(36) NULL,
  room_type ENUM('LIVE','PARTY') NOT NULL,
  status ENUM('ACTIVE','ENDED','LOCKED') NOT NULL DEFAULT 'ACTIVE',
  audience_count INT NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  CONSTRAINT fk_room_host FOREIGN KEY (host_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_room_agency FOREIGN KEY (agency_account_id) REFERENCES platform_accounts(id),
  INDEX idx_room_status (status, room_type, started_at),
  INDEX idx_room_agency (agency_account_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_restrictions (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  restriction_type ENUM('TEMP_LIVE_BAN','WARNING','SUSPENSION') NOT NULL,
  starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ends_at DATETIME(3) NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('ACTIVE','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  actor_account_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_restriction_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_restriction_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_restriction_user_status (application_user_id, status, ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id CHAR(36) PRIMARY KEY,
  actor_account_id CHAR(36) NULL,
  actor_role VARCHAR(32) NULL,
  action VARCHAR(100) NOT NULL,
  module VARCHAR(60) NOT NULL,
  target_type VARCHAR(60) NOT NULL,
  target_id CHAR(36) NULL,
  previous_data JSON NULL,
  new_data JSON NULL,
  reason VARCHAR(500) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_account_id) REFERENCES platform_accounts(id),
  INDEX idx_audit_target (target_type, target_id, created_at),
  INDEX idx_audit_actor_created (actor_account_id, created_at),
  INDEX idx_audit_module_created (module, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS risk_flags (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NULL,
  severity ENUM('LOW','MEDIUM','HIGH') NOT NULL,
  status ENUM('OPEN','REVIEWING','RESOLVED') NOT NULL DEFAULT 'OPEN',
  rule_key VARCHAR(80) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_by CHAR(36) NULL,
  resolved_at DATETIME(3) NULL,
  CONSTRAINT fk_risk_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_risk_resolver FOREIGN KEY (resolved_by) REFERENCES platform_accounts(id),
  INDEX idx_risk_status_severity (status, severity, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS country_document_types (
  id CHAR(36) PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  document_name VARCHAR(100) NOT NULL,
  front_required BOOLEAN NOT NULL DEFAULT TRUE,
  back_required BOOLEAN NOT NULL DEFAULT FALSE,
  validation_hint VARCHAR(255) NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_country_document (country_code, document_name)
) ENGINE=InnoDB;

INSERT IGNORE INTO country_document_types (id, country_code, document_name, front_required, back_required, validation_hint)
VALUES
  (UUID(), 'IN', 'Aadhaar / supported ID', TRUE, TRUE, 'Use a valid government-issued ID.'),
  (UUID(), 'BD', 'National ID', TRUE, TRUE, 'Use a valid National ID.'),
  (UUID(), 'NP', 'Citizenship / supported ID', TRUE, TRUE, 'Use a valid citizenship document.');
