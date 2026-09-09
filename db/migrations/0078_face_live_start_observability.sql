-- Aggregate-only Face Live start outcomes.  This is intentionally separate
-- from room/session data: no user ID, room ID, request body, device ID, or
-- error text is retained.  It lets Master identify production failure trends
-- without making the start path depend on analytics.

CREATE TABLE IF NOT EXISTS mobile_face_start_outcomes (
  metric_date DATE NOT NULL,
  outcome ENUM('SUCCESS', 'FAILURE') NOT NULL,
  category VARCHAR(32) NOT NULL,
  attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (metric_date, outcome, category),
  KEY idx_mobile_face_start_outcomes_date (metric_date)
) ENGINE=InnoDB;
