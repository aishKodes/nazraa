-- Server-owned publication presence and idempotent ZEGO mixer lifecycle.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'media_publishing') = 0,
  'ALTER TABLE live_room_members ADD COLUMN media_publishing BOOLEAN NOT NULL DEFAULT FALSE AFTER muted_by_staff', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'last_media_heartbeat_at') = 0,
  'ALTER TABLE live_room_members ADD COLUMN last_media_heartbeat_at DATETIME(3) NULL AFTER media_publishing', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_media_mix_tasks (
  room_id CHAR(36) PRIMARY KEY,
  task_id VARCHAR(80) NOT NULL UNIQUE,
  output_stream_id VARCHAR(160) NOT NULL UNIQUE,
  desired_hash CHAR(64) NULL,
  applied_hash CHAR(64) NULL,
  sequence_number INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('INACTIVE','SYNCING','ACTIVE','ERROR') NOT NULL DEFAULT 'INACTIVE',
  playback_url VARCHAR(1000) NULL,
  last_error VARCHAR(500) NULL,
  last_synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_media_mix_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  INDEX idx_live_media_mix_status (status, updated_at)
) ENGINE=InnoDB;
