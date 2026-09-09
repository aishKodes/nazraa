-- Nazraa Live 2.4.42. A room kick is a room-scoped exclusion, never an
-- account/device/Live restriction. Existing historical kicks remain active.

ALTER TABLE live_room_blocks
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE AFTER blocked_by_application_user_id,
  ADD COLUMN reason VARCHAR(500) NULL AFTER active,
  ADD COLUMN removed_at DATETIME(3) NULL AFTER created_at,
  ADD COLUMN removed_by_application_user_id CHAR(36) NULL AFTER removed_at,
  ADD CONSTRAINT fk_live_room_block_removed_by
    FOREIGN KEY (removed_by_application_user_id) REFERENCES application_users(id),
  ADD INDEX idx_live_room_block_active_lookup (room_id, application_user_id, active),
  ADD INDEX idx_live_room_block_active_list (room_id, active, created_at);

-- Sampled, bucketed request timing supports p50/p95/p99 diagnostics without
-- storing a row per mobile action or retaining user/private payload data.
CREATE TABLE IF NOT EXISTS mobile_latency_buckets (
  metric_date DATE NOT NULL,
  operation_key VARCHAR(96) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  upper_bound_ms INT UNSIGNED NOT NULL,
  sample_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (metric_date, operation_key, stage, upper_bound_ms),
  KEY idx_mobile_latency_lookup (operation_key, metric_date, stage)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS mobile_latency_counters (
  metric_date DATE NOT NULL,
  operation_key VARCHAR(96) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  sample_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  max_ms INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (metric_date, operation_key, stage),
  KEY idx_mobile_latency_counter_lookup (operation_key, metric_date, stage)
) ENGINE=InnoDB;
