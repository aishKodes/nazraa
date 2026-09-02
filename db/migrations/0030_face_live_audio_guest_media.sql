-- Face Live audio-only guest controls and the host's optional text backdrop.

ALTER TABLE live_rooms
  ADD COLUMN audio_join_requests_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER pk_requests_enabled,
  ADD COLUMN face_background_asset_id CHAR(36) NULL AFTER room_photo_asset_id,
  ADD CONSTRAINT fk_live_room_face_background
    FOREIGN KEY (face_background_asset_id) REFERENCES room_photo_assets(id);

ALTER TABLE live_room_members
  ADD COLUMN muted_by_staff BOOLEAN NOT NULL DEFAULT FALSE AFTER muted;

CREATE TABLE live_room_blocks (
  room_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  blocked_by_application_user_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, application_user_id),
  CONSTRAINT fk_live_room_block_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_room_block_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_room_block_actor FOREIGN KEY (blocked_by_application_user_id) REFERENCES application_users(id),
  INDEX idx_live_room_block_actor (blocked_by_application_user_id, created_at)
) ENGINE=InnoDB;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.9',
  '$.latestBuild', 5319
)
WHERE setting_key = 'mobile.app_config';
