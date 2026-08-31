-- Additive fixes only: preserve accounts, IDs, wallets and existing room data.
ALTER TABLE discovery_posts MODIFY asset_id CHAR(36) NULL;

-- Small, valid compressed images are not corrupt images.
SET @nazraa_schema = DATABASE();
SET @nazraa_drop_check = IF(LOCATE('MariaDB', VERSION()) > 0, 'DROP CONSTRAINT', 'DROP CHECK');
SET @nazraa_check = (SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = @nazraa_schema AND tc.TABLE_NAME = 'room_photo_assets' AND cc.CHECK_CLAUSE LIKE '%byte_size%' LIMIT 1);
SET @nazraa_sql = IF(@nazraa_check IS NULL, 'SELECT 1', CONCAT('ALTER TABLE room_photo_assets ', @nazraa_drop_check, ' `', @nazraa_check, '`'));
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
ALTER TABLE room_photo_assets ADD CONSTRAINT chk_room_photo_bytes CHECK (byte_size BETWEEN 1 AND 1572864);
SET @nazraa_check = (SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = @nazraa_schema AND tc.TABLE_NAME = 'discovery_post_assets' AND cc.CHECK_CLAUSE LIKE '%byte_size%' LIMIT 1);
SET @nazraa_sql = IF(@nazraa_check IS NULL, 'SELECT 1', CONCAT('ALTER TABLE discovery_post_assets ', @nazraa_drop_check, ' `', @nazraa_check, '`'));
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
ALTER TABLE discovery_post_assets ADD CONSTRAINT chk_discovery_photo_bytes CHECK (byte_size BETWEEN 1 AND 1572864);
SET @nazraa_check = (SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA = @nazraa_schema AND tc.TABLE_NAME = 'agency_creation_applications' AND cc.CHECK_CLAUSE LIKE '%logo_byte_size%' LIMIT 1);
SET @nazraa_sql = IF(@nazraa_check IS NULL, 'SELECT 1', CONCAT('ALTER TABLE agency_creation_applications ', @nazraa_drop_check, ' `', @nazraa_check, '`'));
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
ALTER TABLE agency_creation_applications ADD CONSTRAINT chk_agency_logo_bytes CHECK (logo_byte_size IS NULL OR logo_byte_size BETWEEN 1 AND 1048576);

CREATE TABLE IF NOT EXISTS private_conversations (
  user_low CHAR(36) NOT NULL,
  user_high CHAR(36) NOT NULL,
  initiated_by CHAR(36) NOT NULL,
  status ENUM('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_low, user_high),
  FOREIGN KEY (user_low) REFERENCES application_users(id),
  FOREIGN KEY (user_high) REFERENCES application_users(id),
  FOREIGN KEY (initiated_by) REFERENCES application_users(id),
  INDEX idx_conversation_high (user_high, status, updated_at),
  INDEX idx_conversation_low (user_low, status, updated_at)
) ENGINE=InnoDB;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'seat_index') = 0,
  'ALTER TABLE live_room_members ADD COLUMN seat_index TINYINT UNSIGNED NULL, ADD UNIQUE KEY idx_room_reserved_seat (room_id, seat_index)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_seat_requests (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  seat_index TINYINT UNSIGNED NOT NULL,
  status ENUM('PENDING','ACCEPTED','REJECTED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, application_user_id),
  FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_seat_request_pending (room_id, status, requested_at)
) ENGINE=InnoDB;

-- Only historical two-way conversations imply acceptance. One-way messages
-- remain requests; opening/reading a message alone never accepts it.
INSERT IGNORE INTO private_conversations (user_low, user_high, initiated_by, status, updated_at)
SELECT LEAST(sender_application_user_id, recipient_application_user_id),
       GREATEST(sender_application_user_id, recipient_application_user_id),
       MIN(sender_application_user_id),
       IF(COUNT(DISTINCT sender_application_user_id) > 1, 'ACCEPTED', 'PENDING'), MAX(created_at)
FROM private_messages
GROUP BY LEAST(sender_application_user_id, recipient_application_user_id), GREATEST(sender_application_user_id, recipient_application_user_id);

CREATE TABLE IF NOT EXISTS agency_application_documents (
  id CHAR(36) PRIMARY KEY,
  application_id CHAR(36) NOT NULL,
  slot TINYINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  encrypted_data LONGBLOB NOT NULL,
  encryption_iv BINARY(12) NOT NULL,
  encryption_tag BINARY(16) NOT NULL,
  FOREIGN KEY (application_id) REFERENCES agency_creation_applications(id),
  UNIQUE KEY idx_agency_document_slot (application_id, slot),
  CHECK (slot BETWEEN 1 AND 3),
  CHECK (byte_size BETWEEN 1 AND 2097152)
) ENGINE=InnoDB;
