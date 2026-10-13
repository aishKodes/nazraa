-- Presentation only. Wallets, seats, RTC routing and reward rules unchanged.
CREATE TABLE IF NOT EXISTS owner_room_profiles (
  owner_application_user_id CHAR(36) PRIMARY KEY,
  title VARCHAR(80) NOT NULL,
  seat_count TINYINT UNSIGNED NOT NULL,
  theme_index TINYINT UNSIGNED NOT NULL,
  theme_enabled BOOLEAN NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_owner_room_profile_user FOREIGN KEY (owner_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;
-- Uses the existing validated upload/BLOB pipeline. Campaigns may be smaller
-- than the legacy Gift asset table's 1,000-byte minimum; do not weaken Gifts.
CREATE TABLE IF NOT EXISTS startup_campaign_assets (
  id CHAR(36) PRIMARY KEY,
  mime_type VARCHAR(30) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_startup_asset_uploader FOREIGN KEY (uploaded_by) REFERENCES platform_accounts(id),
  CONSTRAINT chk_startup_asset_size CHECK (byte_size BETWEEN 1 AND 2097152),
  CONSTRAINT chk_startup_asset_type CHECK (mime_type IN ('image/webp','video/mp4'))
) ENGINE=InnoDB;
SET @schema_name = DATABASE();
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'config_version') = 0,
  'ALTER TABLE live_rooms ADD COLUMN config_version INT UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
SET @ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @schema_name AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'presentation_snapshot') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN presentation_snapshot JSON NULL', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
