-- LiveKit webhook evidence is independent of client heartbeats.  It never
-- mints rewards by itself; it gives the existing server-time ledger a
-- durable, provider-authenticated publishing signal.

CREATE TABLE IF NOT EXISTS livekit_media_events (
  id CHAR(36) PRIMARY KEY,
  provider_event_id VARCHAR(128) NOT NULL,
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  track_sid VARCHAR(128) NULL,
  track_kind VARCHAR(24) NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  payload_sha256 CHAR(64) NOT NULL,
  CONSTRAINT fk_livekit_event_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_livekit_event_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  UNIQUE KEY uq_livekit_provider_event (provider_event_id),
  INDEX idx_livekit_event_room_time (room_id, occurred_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS livekit_active_media_tracks (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  track_sid VARCHAR(128) NOT NULL,
  track_kind VARCHAR(24) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_event_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, application_user_id, track_sid),
  CONSTRAINT fk_livekit_track_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_livekit_track_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  INDEX idx_livekit_track_publishing (room_id, application_user_id, active, track_kind)
) ENGINE=InnoDB;
