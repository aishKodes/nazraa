-- A Party seat is authoritative room state, not a side effect of a temporary
-- microphone, socket or media transport failure.  Every assignment receives
-- a new immutable session id and monotonic version so delayed callbacks can
-- never terminate a newer seat.
SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'seat_session_id') = 0,
  'ALTER TABLE live_room_members ADD COLUMN seat_session_id CHAR(36) NULL AFTER seat_index', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_members' AND COLUMN_NAME = 'seat_version') = 0,
  'ALTER TABLE live_room_members ADD COLUMN seat_version BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER seat_session_id', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- Preserve an already occupied seat through this rollout as a real
-- server-owned session.  Without this backfill a reconnect immediately after
-- deployment would look like an unversioned legacy assignment to the client.
UPDATE live_room_members
   SET seat_session_id = UUID(),
       seat_version = GREATEST(seat_version, 1)
 WHERE seat_index IS NOT NULL
   AND left_at IS NULL
   AND seat_session_id IS NULL;

CREATE TABLE IF NOT EXISTS live_room_seat_transitions (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  seat_index TINYINT UNSIGNED NULL,
  seat_session_id CHAR(36) NULL,
  seat_version BIGINT UNSIGNED NOT NULL,
  previous_state VARCHAR(32) NOT NULL,
  next_state VARCHAR(32) NOT NULL,
  desired_mic_state VARCHAR(32) NOT NULL,
  event_source VARCHAR(64) NOT NULL,
  termination_reason VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_seat_transition_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_seat_transition_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_live_seat_transition_member (room_id, application_user_id, created_at),
  INDEX idx_live_seat_transition_session (seat_session_id, created_at)
) ENGINE=InnoDB;

-- A network/system interruption has no PK winner and must not be translated
-- into a loss or streak reset.  Manual cancellation stays distinct as well.
ALTER TABLE live_pk_sessions
  MODIFY COLUMN status ENUM('REQUESTED','ACTIVE','REJECTED','CANCELLED','NETWORK_INTERRUPTED','COMPLETED','EXPIRED') NOT NULL DEFAULT 'REQUESTED';

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'pk_host_streaks' AND COLUMN_NAME = 'streak_cycle_id') = 0,
  'ALTER TABLE pk_host_streaks ADD COLUMN streak_cycle_id CHAR(36) NULL AFTER current_streak', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'pk_host_streak_events' AND COLUMN_NAME = 'streak_cycle_id') = 0,
  'ALTER TABLE pk_host_streak_events ADD COLUMN streak_cycle_id CHAR(36) NULL AFTER application_user_id, ADD INDEX idx_pk_streak_cycle (streak_cycle_id, created_at)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
