-- Durable room authority, separate from transient presence. No expiry.
CREATE TABLE IF NOT EXISTS party_room_admins (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  granted_by_application_user_id CHAR(36) NOT NULL,
  granted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at TIMESTAMP(3) NULL,
  PRIMARY KEY (room_id, application_user_id),
  CONSTRAINT fk_party_admin_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_party_admin_user FOREIGN KEY (application_user_id) REFERENCES application_users(id)
);
INSERT IGNORE INTO party_room_admins (room_id,application_user_id,granted_by_application_user_id)
SELECT m.room_id,m.application_user_id,r.host_application_user_id
FROM live_room_members m JOIN live_rooms r ON r.id=m.room_id
WHERE r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED') AND m.room_role='ADMIN';
UPDATE live_seat_requests q JOIN live_rooms r ON r.id=q.room_id
SET q.status='EXPIRED' WHERE r.room_type='PARTY' AND q.status='PENDING';

-- New web channel reuses canonical withdrawal requests and reserved wallet.
SET @schema_name=DATABASE();
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='withdrawal_requests' AND COLUMN_NAME='request_channel')=0,
  'ALTER TABLE withdrawal_requests ADD COLUMN request_channel VARCHAR(24) NOT NULL DEFAULT ''LEGACY''','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='withdrawal_requests' AND COLUMN_NAME='request_idempotency_key')=0,
  'ALTER TABLE withdrawal_requests ADD COLUMN request_idempotency_key VARCHAR(120) NULL','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@schema_name AND TABLE_NAME='withdrawal_requests' AND INDEX_NAME='uq_withdrawal_request_identity')=0,
  'ALTER TABLE withdrawal_requests ADD UNIQUE INDEX uq_withdrawal_request_identity (application_user_id,request_idempotency_key)','SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
ALTER TABLE withdrawal_requests MODIFY COLUMN status ENUM('PENDING','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED','FAILED','REVERSED') NOT NULL DEFAULT 'PENDING';
CREATE TABLE IF NOT EXISTS host_payout_snapshots (
  withdrawal_id CHAR(36) NOT NULL PRIMARY KEY,
  country_code VARCHAR(8) NOT NULL,
  host_public_id BIGINT NOT NULL,
  host_name VARCHAR(180) NOT NULL,
  agency_account_id CHAR(36) NULL,
  agency_public_id BIGINT NULL,
  agency_name VARCHAR(180) NULL,
  slab_diamonds BIGINT NOT NULL,
  rule_snapshot JSON NOT NULL,
  total_usd DECIMAL(18,2) NOT NULL,
  host_usd DECIMAL(18,2) NOT NULL,
  agency_usd DECIMAL(18,2) NOT NULL,
  company_usd DECIMAL(18,2) NOT NULL,
  payout_type VARCHAR(16) NOT NULL,
  payout_masked VARCHAR(180) NOT NULL,
  payout_encrypted_data LONGBLOB NOT NULL,
  payout_encryption_iv VARBINARY(12) NOT NULL,
  payout_encryption_tag VARBINARY(16) NOT NULL,
  approved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  paid_at TIMESTAMP(3) NULL,
  reversed_at TIMESTAMP(3) NULL,
  agency_paid_at TIMESTAMP(3) NULL,
  agency_reversed_at TIMESTAMP(3) NULL,
  agency_payment_reference VARCHAR(255) NULL,
  CONSTRAINT fk_host_payout_request FOREIGN KEY (withdrawal_id) REFERENCES withdrawal_requests(id),
  INDEX ix_host_payout_agency (agency_account_id,approved_at),
  INDEX ix_host_payout_country (country_code,approved_at)
);
