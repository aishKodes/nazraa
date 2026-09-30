-- Face social features extend the existing Gift and seat ledgers, not wallets.
CREATE TABLE IF NOT EXISTS face_host_admins (
  host_application_user_id CHAR(36) NOT NULL,
  admin_application_user_id CHAR(36) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (host_application_user_id, admin_application_user_id),
  FOREIGN KEY (host_application_user_id) REFERENCES application_users(id),
  FOREIGN KEY (admin_application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gift_intent_receipts (
  idempotency_key VARCHAR(160) PRIMARY KEY,
  request_json JSON NOT NULL,
  receipt_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

SET @nazraa_schema = DATABASE();
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND COLUMN_NAME = 'live_session_id') = 0,
  'ALTER TABLE live_room_gift_events ADD COLUMN live_session_id CHAR(36) NULL', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND COLUMN_NAME = 'face_host_application_user_id') = 0,
  'ALTER TABLE live_room_gift_events ADD COLUMN face_host_application_user_id CHAR(36) NULL', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- One durable session per room exists in the current ledger. Only attribute
-- historical gifts within its actual lifetime; never invent a session.
UPDATE live_room_gift_events event
JOIN live_rooms room ON room.id = event.room_id AND room.room_type IN ('FACE','LIVE')
JOIN live_session_accounting session ON session.room_id = room.id
SET event.live_session_id = session.id,
    event.face_host_application_user_id = room.host_application_user_id
WHERE event.live_session_id IS NULL
  AND event.created_at >= session.started_at
  AND (session.ended_at IS NULL OR event.created_at <= session.ended_at);

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND INDEX_NAME = 'idx_face_gift_session') = 0,
  'CREATE INDEX idx_face_gift_session ON live_room_gift_events (live_session_id, receiver_application_user_id)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND INDEX_NAME = 'idx_face_gift_host_day') = 0,
  'CREATE INDEX idx_face_gift_host_day ON live_room_gift_events (face_host_application_user_id, business_date, receiver_application_user_id, sender_application_user_id)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- Accepted Face guests receive the same durable identity as Party seats.
UPDATE live_room_members member JOIN live_rooms room ON room.id = member.room_id
SET member.seat_session_id = UUID(), member.seat_version = member.seat_version + 1
WHERE room.room_type IN ('FACE','LIVE') AND member.media_role = 'AUDIO_GUEST'
  AND member.left_at IS NULL AND member.seat_session_id IS NULL;
