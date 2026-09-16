-- Staged, reversible LiveKit provider migration. ZEGO remains the default
-- until a server-side environment switch explicitly routes reviewer accounts.

CREATE TABLE IF NOT EXISTS livekit_media_access_grants (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  mobile_session_id CHAR(36) NULL,
  media_role VARCHAR(32) NOT NULL,
  publish_mode ENUM('none','audio_only','video_audio') NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  CONSTRAINT fk_livekit_grant_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_livekit_grant_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_livekit_grant_session FOREIGN KEY (mobile_session_id) REFERENCES mobile_sessions(id),
  INDEX idx_livekit_grant_room_active (room_id, revoked_at, expires_at),
  INDEX idx_livekit_grant_user_active (application_user_id, revoked_at, expires_at)
) ENGINE=InnoDB;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'media.provider', JSON_OBJECT(
  'activeProvider', 'ZEGO',
  'liveKitReviewerOnly', TRUE,
  'liveKitTokenTtlSeconds', 900,
  'updatedBy', 'livekit-staged-migration'
), id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = JSON_MERGE_PATCH(
  setting_value,
  JSON_OBJECT('activeProvider', 'ZEGO', 'liveKitReviewerOnly', TRUE,
    'liveKitTokenTtlSeconds', 900, 'updatedBy', 'livekit-staged-migration')
);
