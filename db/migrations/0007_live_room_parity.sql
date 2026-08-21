-- Server-owned Party/Live interaction, PK, Rocket, and presence configuration.
-- RTC media still flows directly through ZEGOCLOUD; these tables persist the
-- authorization/audit state used by mobile and the Control Platform.

-- DDL auto-commits in MySQL, so each addition is guarded independently. This
-- lets deployment resume safely if an earlier build created only part of the
-- room schema before the migration marker could be written.
SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'password_hash') = 0,
  'ALTER TABLE live_rooms ADD COLUMN password_hash VARCHAR(100) NULL AFTER privacy', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'password_length') = 0,
  'ALTER TABLE live_rooms ADD COLUMN password_length TINYINT UNSIGNED NULL AFTER password_hash', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'chat_locked') = 0,
  'ALTER TABLE live_rooms ADD COLUMN chat_locked BOOLEAN NOT NULL DEFAULT FALSE AFTER password_length', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'interactions_enabled') = 0,
  'ALTER TABLE live_rooms ADD COLUMN interactions_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER chat_locked', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'theme_enabled') = 0,
  'ALTER TABLE live_rooms ADD COLUMN theme_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER interactions_enabled', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'pk_requests_enabled') = 0,
  'ALTER TABLE live_rooms ADD COLUMN pk_requests_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER theme_enabled', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND COLUMN_NAME = 'top_application_user_id') = 0,
  'ALTER TABLE live_rooms ADD COLUMN top_application_user_id CHAR(36) NULL AFTER pk_requests_enabled', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND CONSTRAINT_NAME = 'chk_live_room_password_length') = 0,
  'ALTER TABLE live_rooms ADD CONSTRAINT chk_live_room_password_length CHECK (password_length IS NULL OR password_length IN (4, 6, 10))', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_rooms' AND CONSTRAINT_NAME = 'fk_live_room_top_user') = 0,
  'ALTER TABLE live_rooms ADD CONSTRAINT fk_live_room_top_user FOREIGN KEY (top_application_user_id) REFERENCES application_users(id)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_room_messages (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  sender_application_user_id CHAR(36) NOT NULL,
  body VARCHAR(500) NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  cleared_by_application_user_id CHAR(36) NULL,
  cleared_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_room_message_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_room_message_sender FOREIGN KEY (sender_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_room_message_clearer FOREIGN KEY (cleared_by_application_user_id) REFERENCES application_users(id),
  INDEX idx_live_room_message_feed (room_id, visible, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS room_interaction_events (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  sender_application_user_id CHAR(36) NOT NULL,
  target_application_user_id CHAR(36) NOT NULL,
  interaction_key VARCHAR(40) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_room_interaction_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_room_interaction_sender FOREIGN KEY (sender_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_room_interaction_target FOREIGN KEY (target_application_user_id) REFERENCES application_users(id),
  INDEX idx_room_interaction_feed (room_id, created_at),
  INDEX idx_room_interaction_sender (sender_application_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS room_interaction_assets (
  id CHAR(36) PRIMARY KEY,
  mime_type VARCHAR(80) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  uploaded_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_room_interaction_asset_uploader FOREIGN KEY (uploaded_by) REFERENCES platform_accounts(id),
  CHECK (byte_size BETWEEN 1000 AND 1048576)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS live_pk_sessions (
  id CHAR(36) PRIMARY KEY,
  source_room_id CHAR(36) NOT NULL,
  target_room_id CHAR(36) NOT NULL,
  requested_by_application_user_id CHAR(36) NOT NULL,
  mode VARCHAR(32) NOT NULL,
  duration_minutes TINYINT UNSIGNED NOT NULL,
  status ENUM('REQUESTED','ACTIVE','REJECTED','CANCELLED','COMPLETED','EXPIRED') NOT NULL DEFAULT 'REQUESTED',
  started_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_pk_source FOREIGN KEY (source_room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_pk_target FOREIGN KEY (target_room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_pk_requester FOREIGN KEY (requested_by_application_user_id) REFERENCES application_users(id),
  INDEX idx_live_pk_source (source_room_id, status, created_at),
  INDEX idx_live_pk_target (target_room_id, status, created_at),
  CHECK (duration_minutes IN (2, 5, 10))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS face_live_presence_incidents (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  host_application_user_id CHAR(36) NOT NULL,
  incident_type ENUM('CAMERA_OFF','PERSON_NOT_DETECTED','LIVE_AUTO_STOPPED') NOT NULL,
  consecutive_failures TINYINT UNSIGNED NOT NULL DEFAULT 0,
  evidence_metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_face_presence_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_face_presence_host FOREIGN KEY (host_application_user_id) REFERENCES application_users(id),
  INDEX idx_face_presence_host (host_application_user_id, created_at),
  INDEX idx_face_presence_room (room_id, created_at)
) ENGINE=InnoDB;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.room_features', JSON_OBJECT(
  'interactions', JSON_ARRAY(
    JSON_OBJECT('key', 'kiss', 'label', 'Kiss', 'emoji', '💋', 'enabled', TRUE),
    JSON_OBJECT('key', 'love', 'label', 'Love', 'emoji', '💖', 'enabled', TRUE),
    JSON_OBJECT('key', 'hug', 'label', 'Hug', 'emoji', '🤗', 'enabled', TRUE)
  ),
  'pkDurations', JSON_ARRAY(2, 5, 10),
  'pkModes', JSON_ARRAY('Classic', 'Auto PK', 'Individual', 'Random'),
  'rocketLevels', JSON_ARRAY(
    JSON_OBJECT('level', 1, 'requiredCoins', 10000, 'rewardCoins', 500),
    JSON_OBJECT('level', 2, 'requiredCoins', 50000, 'rewardCoins', 3000),
    JSON_OBJECT('level', 3, 'requiredCoins', 100000, 'rewardCoins', 7500)
  ),
  'rocketEnabled', TRUE,
  'presenceWarningLimit', 10,
  'presenceSuspensionLimit', 5
), id
FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'mobile.app_config', JSON_OBJECT(
  'minimumVersion', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(existing.setting_value, '$.minimumVersion')), '2.1.0'),
  'latestVersion', '2.2.0',
  'maintenance', FALSE,
  'maintenanceMessage', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(existing.setting_value, '$.maintenanceMessage')), ''),
  'updateUrl', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(existing.setting_value, '$.updateUrl')), ''),
  'supportUrl', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(existing.setting_value, '$.supportUrl')), ''),
  'withdrawalUrl', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(existing.setting_value, '$.withdrawalUrl')), '')
), master.id
FROM platform_accounts master
LEFT JOIN system_settings existing ON existing.setting_key = 'mobile.app_config'
WHERE master.role = 'MASTER'
ORDER BY master.created_at LIMIT 1
ON DUPLICATE KEY UPDATE
  setting_value = JSON_SET(setting_value, '$.latestVersion', '2.2.0');
