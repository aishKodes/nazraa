-- FCM device tokens are private identifiers.  Keep the usable token encrypted
-- at rest and retain only a SHA-256 lookup key for deduplication/audit.
CREATE TABLE mobile_push_devices (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  installation_id VARCHAR(160) NOT NULL,
  platform ENUM('ANDROID') NOT NULL,
  app_version VARCHAR(64) NULL,
  token_hash CHAR(64) NOT NULL,
  token_encrypted MEDIUMBLOB NOT NULL,
  token_iv VARBINARY(32) NOT NULL,
  token_tag VARBINARY(32) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  invalidated_at DATETIME(3) NULL,
  invalid_reason VARCHAR(96) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mobile_push_devices_token_hash (token_hash),
  UNIQUE KEY uq_mobile_push_devices_installation (application_user_id, installation_id),
  KEY idx_mobile_push_devices_active_user (application_user_id, active, last_seen_at),
  CONSTRAINT fk_mobile_push_devices_user FOREIGN KEY (application_user_id) REFERENCES application_users(id)
) ENGINE=InnoDB;

-- A campaign is the durable idempotency boundary.  `reference_key` makes a
-- follower notification one-per-Live-session even when LiveKit retries its
-- authenticated `track_published` webhook.
CREATE TABLE mobile_push_campaigns (
  id CHAR(36) PRIMARY KEY,
  campaign_type ENUM('LIVE_FOLLOWER','MASTER_DIRECT','MASTER_BROADCAST') NOT NULL,
  reference_key VARCHAR(180) NOT NULL,
  title VARCHAR(120) NOT NULL,
  message VARCHAR(500) NOT NULL,
  action_target VARCHAR(180) NULL,
  payload JSON NULL,
  created_by_platform_account_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mobile_push_campaign_reference (reference_key),
  KEY idx_mobile_push_campaigns_created (campaign_type, created_at),
  CONSTRAINT fk_mobile_push_campaigns_creator FOREIGN KEY (created_by_platform_account_id) REFERENCES platform_accounts(id)
) ENGINE=InnoDB;

CREATE TABLE mobile_push_jobs (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  device_id CHAR(36) NOT NULL,
  status ENUM('PENDING','PROCESSING','SENT','FAILED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  fcm_message_id VARCHAR(255) NULL,
  failure_code VARCHAR(96) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mobile_push_jobs_campaign_device (campaign_id, device_id),
  KEY idx_mobile_push_jobs_delivery (status, available_at, created_at),
  KEY idx_mobile_push_jobs_user (application_user_id, created_at),
  CONSTRAINT fk_mobile_push_jobs_campaign FOREIGN KEY (campaign_id) REFERENCES mobile_push_campaigns(id),
  CONSTRAINT fk_mobile_push_jobs_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_mobile_push_jobs_device FOREIGN KEY (device_id) REFERENCES mobile_push_devices(id)
) ENGINE=InnoDB;

CREATE TABLE mobile_push_delivery_audits (
  id CHAR(36) PRIMARY KEY,
  job_id CHAR(36) NOT NULL,
  event_type ENUM('QUEUED','SENT','RETRY','INVALID_TOKEN','FAILED') NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  failure_code VARCHAR(96) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_mobile_push_delivery_audits_job (job_id, created_at),
  CONSTRAINT fk_mobile_push_delivery_audits_job FOREIGN KEY (job_id) REFERENCES mobile_push_jobs(id)
) ENGINE=InnoDB;
