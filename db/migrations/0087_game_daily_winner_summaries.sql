-- Daily game winners are an indexed settlement projection, not a query over
-- every bet when a player opens the leaderboard.  A contribution is recorded
-- once per immutable result row, so a retry/reconciliation cannot inflate a
-- player's public total.
CREATE TABLE IF NOT EXISTS game_daily_winner_contributions (
  result_record_id CHAR(36) NOT NULL,
  game_name VARCHAR(64) NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  wager_total BIGINT UNSIGNED NOT NULL,
  payout_total BIGINT UNSIGNED NOT NULL,
  net_profit BIGINT NOT NULL,
  rounds_won TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (result_record_id),
  KEY idx_game_daily_contribution (game_name, business_date, application_user_id),
  CONSTRAINT fk_game_daily_contribution_result FOREIGN KEY (result_record_id)
    REFERENCES game_round_results(id),
  CONSTRAINT fk_game_daily_contribution_user FOREIGN KEY (application_user_id)
    REFERENCES application_users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS game_daily_winner_summaries (
  game_name VARCHAR(64) NOT NULL,
  business_date DATE NOT NULL,
  application_user_id CHAR(36) NOT NULL,
  daily_net_profit BIGINT NOT NULL DEFAULT 0,
  total_wager BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_payout BIGINT UNSIGNED NOT NULL DEFAULT 0,
  rounds_won INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (game_name, business_date, application_user_id),
  KEY idx_game_daily_top_winners (game_name, business_date, daily_net_profit, total_payout),
  CONSTRAINT fk_game_daily_summary_user FOREIGN KEY (application_user_id)
    REFERENCES application_users(id)
) ENGINE=InnoDB;

-- The existing production business day is Asia/Kolkata.  This one-time
-- backfill deliberately uses its fixed +05:30 offset; future contributions
-- are labelled by the remotely configured server timezone in application
-- code.  Historical records themselves are never changed or deleted.
INSERT IGNORE INTO game_daily_winner_contributions
  (result_record_id, game_name, application_user_id, business_date,
   wager_total, payout_total, net_profit, rounds_won, created_at)
SELECT result.id, result.game_name, result.application_user_id,
       DATE(DATE_ADD(result.created_at, INTERVAL 330 MINUTE)),
       result.wager_total, result.payout_total,
       CAST(result.payout_total AS SIGNED) - CAST(result.wager_total AS SIGNED),
       CASE WHEN result.payout_total > result.wager_total THEN 1 ELSE 0 END,
       result.created_at
FROM game_round_results result
WHERE result.wager_total > 0;

INSERT INTO game_daily_winner_summaries
  (game_name, business_date, application_user_id, daily_net_profit,
   total_wager, total_payout, rounds_won)
SELECT game_name, business_date, application_user_id,
       SUM(net_profit), SUM(wager_total), SUM(payout_total), SUM(rounds_won)
FROM game_daily_winner_contributions
GROUP BY game_name, business_date, application_user_id
ON DUPLICATE KEY UPDATE
  daily_net_profit = VALUES(daily_net_profit),
  total_wager = VALUES(total_wager),
  total_payout = VALUES(total_payout),
  rounds_won = VALUES(rounds_won),
  updated_at = CURRENT_TIMESTAMP(3);
