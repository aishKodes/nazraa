-- Role hierarchy, device controls, soft-removal metadata, and query indexes.
-- Existing branches remain visible so Master can reassign legacy nodes safely.

ALTER TABLE platform_accounts
  MODIFY COLUMN role ENUM(
    'MASTER','COUNTRY_MANAGER','SUPER_ADMIN','ADMIN','BD','AGENCY',
    'COIN_SELLER','MONITORING_CS'
  ) NOT NULL,
  ADD COLUMN removed_at DATETIME(3) NULL AFTER last_login_at,
  ADD COLUMN removed_by CHAR(36) NULL AFTER removed_at,
  ADD CONSTRAINT fk_account_remover FOREIGN KEY (removed_by) REFERENCES platform_accounts(id),
  ADD INDEX idx_account_parent_status_role (parent_account_id, status, role),
  ADD INDEX idx_account_country_role_status (country_code, role, status),
  ADD INDEX idx_account_name (full_name);

UPDATE platform_accounts
SET role = 'BD', admin_kind = NULL
WHERE role = 'ADMIN' AND admin_kind = 'BD';

ALTER TABLE mobile_sessions
  ADD COLUMN device_id_hash CHAR(64) NULL AFTER device_label,
  ADD INDEX idx_mobile_session_user_activity (application_user_id, revoked_at, expires_at, last_used_at),
  ADD INDEX idx_mobile_session_device (device_id_hash, revoked_at, expires_at);

CREATE TABLE mobile_device_blocks (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  mobile_session_id CHAR(36) NULL,
  device_id_hash CHAR(64) NULL,
  device_label VARCHAR(120) NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('ACTIVE','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  blocked_by CHAR(36) NOT NULL,
  blocked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_by CHAR(36) NULL,
  revoked_at DATETIME(3) NULL,
  CONSTRAINT fk_device_block_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_device_block_session FOREIGN KEY (mobile_session_id) REFERENCES mobile_sessions(id),
  CONSTRAINT fk_device_block_actor FOREIGN KEY (blocked_by) REFERENCES platform_accounts(id),
  CONSTRAINT fk_device_block_revoker FOREIGN KEY (revoked_by) REFERENCES platform_accounts(id),
  INDEX idx_device_block_user_status (application_user_id, status, blocked_at),
  INDEX idx_device_block_hash_status (device_id_hash, status),
  INDEX idx_device_block_session_status (mobile_session_id, status)
) ENGINE=InnoDB;

ALTER TABLE application_users
  ADD INDEX idx_user_agency_created (agency_account_id, created_at),
  ADD INDEX idx_user_agency_public (agency_account_id, public_id),
  ADD INDEX idx_user_country_created (country_code, created_at),
  ADD INDEX idx_user_name (full_name),
  ADD INDEX idx_user_whatsapp (whatsapp_e164);

ALTER TABLE host_profiles
  ADD INDEX idx_host_agency_updated (agency_account_id, updated_at),
  ADD INDEX idx_host_status_updated (status, updated_at);

ALTER TABLE ledger_transactions
  ADD INDEX idx_ledger_actor_created (actor_account_id, created_at),
  ADD INDEX idx_ledger_asset_status_created (asset_type, status, created_at);

ALTER TABLE withdrawal_requests
  ADD INDEX idx_withdrawal_agency_status_requested (agency_account_id, status, requested_at);

ALTER TABLE live_rooms
  ADD INDEX idx_room_agency_status_started (agency_account_id, status, started_at);

ALTER TABLE moderation_restrictions
  ADD INDEX idx_restriction_expiry (status, ends_at, restriction_type);

ALTER TABLE support_tickets
  ADD INDEX idx_support_user_updated (application_user_id, updated_at),
  ADD INDEX idx_support_status_priority_updated (status, priority, updated_at);

ALTER TABLE risk_flags
  ADD INDEX idx_risk_user_status_created (application_user_id, status, created_at);

ALTER TABLE agency_membership_applications
  ADD INDEX idx_agency_join_agency_status_created (agency_account_id, status, created_at);

ALTER TABLE face_verification_requests
  ADD INDEX idx_face_user_status_created (application_user_id, status, created_at);
