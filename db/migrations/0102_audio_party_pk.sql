-- Audio PK is intentionally independent of Face PK and its reward/topology.
CREATE TABLE IF NOT EXISTS audio_pk_sessions (
 id CHAR(36) PRIMARY KEY,
 source_room_id CHAR(36) NOT NULL,
 target_room_id CHAR(36) NOT NULL,
 requested_by CHAR(36) NOT NULL,
 mode VARCHAR(16) NOT NULL,
 duration_minutes SMALLINT UNSIGNED NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'INVITED',
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 expires_at DATETIME(3) NOT NULL,
 started_at DATETIME(3) NULL,
 ends_at DATETIME(3) NULL,
 result_ends_at DATETIME(3) NULL,
 ended_at DATETIME(3) NULL,
 red_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
 blue_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
 rematch_requested_by CHAR(36) NULL,
 parent_session_id CHAR(36) NULL,
 version BIGINT UNSIGNED NOT NULL DEFAULT 1,
 INDEX idx_audio_pk_due(status,ends_at),
 INDEX idx_audio_pk_source(source_room_id,created_at),
 INDEX idx_audio_pk_target(target_room_id,created_at),
 FOREIGN KEY(source_room_id) REFERENCES live_rooms(id),
 FOREIGN KEY(target_room_id) REFERENCES live_rooms(id),
 FOREIGN KEY(requested_by) REFERENCES application_users(id),
 CHECK(source_room_id<>target_room_id),
 CHECK(duration_minutes IN (5,10,30))
) ENGINE=InnoDB;
-- Durable one-reservation-per-board; both links are acquired in one transaction.
CREATE TABLE IF NOT EXISTS audio_pk_room_links (
 room_id CHAR(36) PRIMARY KEY,
 session_id CHAR(36) NOT NULL,
 INDEX idx_audio_pk_link_session(session_id),
 FOREIGN KEY(room_id) REFERENCES live_rooms(id),
 FOREIGN KEY(session_id) REFERENCES audio_pk_sessions(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS audio_pk_gift_attributions (
 gift_event_id CHAR(36) PRIMARY KEY,
 session_id CHAR(36) NOT NULL,
 application_user_id CHAR(36) NOT NULL,
 team VARCHAR(4) NOT NULL,
 diamonds BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX idx_audio_pk_top(session_id,team,application_user_id),
 FOREIGN KEY(gift_event_id) REFERENCES live_room_gift_events(id),
 FOREIGN KEY(session_id) REFERENCES audio_pk_sessions(id),
 FOREIGN KEY(application_user_id) REFERENCES application_users(id),
 CHECK(team IN ('RED','BLUE'))
) ENGINE=InnoDB;
