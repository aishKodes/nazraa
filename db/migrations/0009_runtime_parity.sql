-- Runtime parity: real room presence, room-scoped gift history, and an
-- idempotent server-owned game wallet that uses the user's COIN balance.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'last_seen_at') = 0,
  'ALTER TABLE live_room_members ADD COLUMN last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER joined_at', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND INDEX_NAME = 'idx_room_member_presence') = 0,
  'ALTER TABLE live_room_members ADD INDEX idx_room_member_presence (room_id, left_at, last_seen_at)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

CREATE TABLE IF NOT EXISTS live_room_gift_events (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  sender_application_user_id CHAR(36) NOT NULL,
  receiver_application_user_id CHAR(36) NOT NULL,
  gift_catalog_id CHAR(36) NOT NULL,
  quantity TINYINT UNSIGNED NOT NULL,
  coin_value BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_room_gift_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_room_gift_sender FOREIGN KEY (sender_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_room_gift_receiver FOREIGN KEY (receiver_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_room_gift_catalog FOREIGN KEY (gift_catalog_id) REFERENCES gift_catalog(id),
  INDEX idx_room_gift_feed (room_id, created_at),
  INDEX idx_room_gift_receiver (room_id, receiver_application_user_id, created_at),
  CHECK (quantity BETWEEN 1 AND 99),
  CHECK (coin_value > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_wallet_events (
  id CHAR(36) PRIMARY KEY,
  client_transaction_id CHAR(36) NOT NULL UNIQUE,
  application_user_id CHAR(36) NOT NULL,
  direction ENUM('DEBIT','CREDIT') NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  game_name VARCHAR(120) NOT NULL,
  reason VARCHAR(240) NOT NULL,
  balance_after BIGINT UNSIGNED NOT NULL,
  ledger_transaction_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_game_wallet_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_game_wallet_ledger FOREIGN KEY (ledger_transaction_id) REFERENCES ledger_transactions(id),
  INDEX idx_game_wallet_user (application_user_id, created_at),
  CHECK (amount > 0)
) ENGINE=InnoDB;

-- Historical rooms without a present owner are ghosts and must not remain in
-- discovery. Keep accounting intact; only close their active lifecycle state.
UPDATE live_rooms room
SET room.status = 'ENDED', room.ended_at = COALESCE(room.ended_at, CURRENT_TIMESTAMP(3)), room.audience_count = 0
WHERE room.status IN ('ACTIVE','LOCKED')
  AND NOT EXISTS (
    SELECT 1 FROM live_room_members member
    WHERE member.room_id = room.id AND member.room_role = 'OWNER' AND member.left_at IS NULL
  );

UPDATE live_rooms room
SET room.audience_count = (
  SELECT COUNT(*) FROM live_room_members member
  WHERE member.room_id = room.id AND member.left_at IS NULL
)
WHERE room.status IN ('ACTIVE','LOCKED');

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion',
  '2.3.0'
)
WHERE setting_key = 'mobile.app_config';
