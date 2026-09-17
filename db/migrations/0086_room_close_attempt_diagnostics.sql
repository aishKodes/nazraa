-- A close attempt is operational telemetry, not an authorization signal. It
-- gives incident response one durable event per UI termination attempt without
-- retaining message bodies, media credentials, camera frames or raw SDK logs.
CREATE TABLE IF NOT EXISTS room_close_attempts (
  id CHAR(36) NOT NULL,
  room_id CHAR(36) NULL,
  live_session_accounting_id CHAR(36) NULL,
  application_user_id CHAR(36) NOT NULL,
  close_reason VARCHAR(64) NOT NULL,
  trigger_source VARCHAR(96) NOT NULL,
  caller_stack VARCHAR(512) NULL,
  connection_phase VARCHAR(24) NOT NULL,
  publishing BOOLEAN NOT NULL DEFAULT FALSE,
  backend_room_state VARCHAR(32) NOT NULL,
  host_participant_present BOOLEAN NOT NULL DEFAULT FALSE,
  participant_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_room_close_attempt_room_created (room_id, created_at),
  KEY idx_room_close_attempt_user_created (application_user_id, created_at),
  KEY idx_room_close_attempt_reason_created (close_reason, created_at)
) ENGINE=InnoDB;
