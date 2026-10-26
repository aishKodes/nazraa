-- Historical amounts/claims stay immutable. Only new units use half-hours.
ALTER TABLE livekit_media_access_grants MODIFY publish_mode ENUM('none','audio_only','video_audio','video_only') NOT NULL;
ALTER TABLE live_session_accounting
  ADD COLUMN reward_period_seconds INT UNSIGNED NOT NULL DEFAULT 3600,
  ADD COLUMN application_instance_id CHAR(36) NULL,
  ADD CONSTRAINT chk_live_reward_period CHECK (reward_period_seconds IN (1800,3600));
ALTER TABLE live_reward_entitlements
  ADD COLUMN reward_period_seconds INT UNSIGNED NOT NULL DEFAULT 3600,
  ADD CONSTRAINT chk_entitlement_reward_period CHECK (reward_period_seconds IN (1800,3600));
ALTER TABLE live_daily_reward_awards
  ADD COLUMN daily_block_index TINYINT UNSIGNED NOT NULL DEFAULT 1,
  DROP INDEX uq_live_daily_reward_user_day,
  ADD UNIQUE KEY uq_live_daily_reward_user_day_block (application_user_id,business_date,daily_block_index),
  ADD CONSTRAINT chk_live_daily_reward_block CHECK (daily_block_index BETWEEN 1 AND 2);
-- Activation is a separate guarded, audited configuration transaction.
