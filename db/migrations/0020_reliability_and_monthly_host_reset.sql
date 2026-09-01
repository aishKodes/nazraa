CREATE TABLE IF NOT EXISTS monthly_host_earning_resets (
  reset_month DATE PRIMARY KEY,
  affected_users INT NOT NULL DEFAULT 0,
  expired_amount BIGINT NOT NULL DEFAULT 0,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

