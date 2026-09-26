-- A Master device ban applies to the device identifier across every Nazraa
-- account. The row also serializes login and ban transactions for that hash.
-- Account-scoped mobile_device_blocks remain independent and unchanged.
CREATE TABLE mobile_device_security_state (
  id CHAR(36) PRIMARY KEY,
  device_id_hash CHAR(64) NOT NULL,
  status ENUM('ALLOWED','BANNED') NOT NULL DEFAULT 'ALLOWED',
  reason VARCHAR(500) NULL,
  banned_by CHAR(36) NULL,
  banned_at DATETIME(3) NULL,
  unbanned_by CHAR(36) NULL,
  unbanned_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mobile_device_security_hash (device_id_hash),
  INDEX idx_mobile_device_security_status (status, banned_at),
  CONSTRAINT fk_mobile_device_security_banner FOREIGN KEY (banned_by) REFERENCES platform_accounts(id),
  CONSTRAINT fk_mobile_device_security_unbanner FOREIGN KEY (unbanned_by) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

ALTER TABLE mobile_sessions
  ADD COLUMN device_identity_kind ENUM('ANDROID_ID','INSTALLATION') NULL AFTER device_id_hash;
