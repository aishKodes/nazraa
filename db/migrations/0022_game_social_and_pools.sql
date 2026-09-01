CREATE TABLE IF NOT EXISTS game_big_winner_events (
  id CHAR(36) PRIMARY KEY,
  result_record_id CHAR(36) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  game_name VARCHAR(64) NOT NULL,
  payout_total BIGINT UNSIGNED NOT NULL,
  outcome_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_big_winner_result FOREIGN KEY (result_record_id) REFERENCES game_round_results(id),
  CONSTRAINT fk_big_winner_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  UNIQUE KEY uq_big_winner_result (result_record_id),
  INDEX idx_big_winner_game_time (game_name, created_at),
  INDEX idx_big_winner_amount (payout_total, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_progressive_pools (
  game_name VARCHAR(64) PRIMARY KEY,
  amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_contributed BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_special_round_id CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_game_pool_special_round FOREIGN KEY (last_special_round_id) REFERENCES game_shared_rounds(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO game_progressive_pools (game_name) VALUES ('greedy_lion'), ('greedy_king');
