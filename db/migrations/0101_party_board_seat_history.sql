-- Additive work evidence only. No wallet, payout, Live or reward changes.
CREATE TABLE IF NOT EXISTS party_board_seat_segments (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  board_owner_user_id CHAR(36) NOT NULL,
  room_id CHAR(36) NOT NULL,
  seat_session_id CHAR(36) NOT NULL,
  seat_index TINYINT UNSIGNED NOT NULL,
  board_title VARCHAR(80) NOT NULL,
  business_timezone VARCHAR(64) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  end_reason VARCHAR(64) NULL,
  active_key VARCHAR(73) GENERATED ALWAYS AS
    (IF(ended_at IS NULL,CONCAT(room_id,':',application_user_id),NULL)) STORED,
  UNIQUE KEY uq_party_board_active (active_key),
  INDEX idx_party_board_user_start (application_user_id,started_at),
  INDEX idx_party_board_room_end (room_id,ended_at),
  CONSTRAINT fk_party_board_user FOREIGN KEY(application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_party_board_owner FOREIGN KEY(board_owner_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_party_board_room FOREIGN KEY(room_id) REFERENCES live_rooms(id),
  CONSTRAINT chk_party_board_not_own CHECK(application_user_id<>board_owner_user_id)
) ENGINE=InnoDB;

-- Adopt currently eligible, already-seated Hosts from deployment time only.
-- Previous attendance cannot be invented from a mutable presence snapshot.
INSERT INTO party_board_seat_segments
  (id,application_user_id,board_owner_user_id,room_id,seat_session_id,seat_index,board_title,business_timezone)
SELECT UUID(),u.id,r.host_application_user_id,r.id,m.seat_session_id,m.seat_index,r.title,
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config.setting_value,'$.timezone')),'Asia/Kolkata')
FROM live_room_members m JOIN application_users u ON u.id=m.application_user_id
JOIN live_rooms r ON r.id=m.room_id
LEFT JOIN system_settings config ON config.setting_key='mobile.live_rules'
WHERE r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED') AND m.left_at IS NULL
  AND u.is_host=TRUE AND u.account_status='ACTIVE' AND u.id<>r.host_application_user_id
  AND m.seat_index IS NOT NULL AND m.seat_session_id IS NOT NULL
  AND (m.last_seen_at>=CURRENT_TIMESTAMP(3)-INTERVAL 30 SECOND OR
    (SELECT e.event_type FROM livekit_media_events e WHERE e.room_id=r.id AND e.application_user_id=u.id
      AND e.event_type IN ('participant_joined','participant_left') ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 1)='participant_joined')
  AND NOT EXISTS(SELECT 1 FROM party_board_seat_segments s WHERE s.room_id=r.id AND s.seat_session_id=m.seat_session_id AND s.application_user_id=u.id);
CREATE TABLE IF NOT EXISTS party_board_segment_days (
  segment_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  eligible_milliseconds BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(segment_id,business_date),
  INDEX idx_party_board_day_user (application_user_id,business_date),
  CONSTRAINT fk_party_board_day_segment FOREIGN KEY(segment_id) REFERENCES party_board_seat_segments(id)
) ENGINE=InnoDB;
