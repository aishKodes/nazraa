-- A shared-round result is immutable before it is rendered.  These fields
-- make the public result event versioned, so a fast following round cannot
-- overwrite the previous authoritative result on a reconnecting client.
SET @schema_name := DATABASE();

SET @has_result_committed_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'game_shared_rounds'
    AND COLUMN_NAME = 'result_committed_at'
);
SET @sql := IF(
  @has_result_committed_at = 0,
  'ALTER TABLE game_shared_rounds ADD COLUMN result_committed_at DATETIME(3) NULL AFTER drawing_ends_at',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @has_result_version := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'game_shared_rounds'
    AND COLUMN_NAME = 'result_version'
);
SET @sql := IF(
  @has_result_version = 0,
  'ALTER TABLE game_shared_rounds ADD COLUMN result_version BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER result_committed_at',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

-- Existing completed rounds are still real results.  Backfill their
-- commitment timestamp from the server-defined draw boundary, never a phone
-- clock or a client animation time.
UPDATE game_shared_rounds
SET result_committed_at = drawing_ends_at
WHERE result_committed_at IS NULL
  AND drawing_ends_at <= UTC_TIMESTAMP(3);

-- Daily ranking is by actual daily winnings (settled payout) for the selected
-- game.  Net profit remains in the projection for finance/audit views.
SET @has_daily_winnings := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'game_daily_winner_summaries'
    AND COLUMN_NAME = 'daily_winnings'
);
SET @sql := IF(
  @has_daily_winnings = 0,
  'ALTER TABLE game_daily_winner_summaries ADD COLUMN daily_winnings BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER daily_net_profit',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

UPDATE game_daily_winner_summaries
SET daily_winnings = total_payout
WHERE daily_winnings = 0 AND total_payout > 0;

SET @has_daily_winnings_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'game_daily_winner_summaries'
    AND INDEX_NAME = 'idx_game_daily_winnings_top20'
);
SET @sql := IF(
  @has_daily_winnings_index = 0,
  'CREATE INDEX idx_game_daily_winnings_top20 ON game_daily_winner_summaries (game_name, business_date, daily_winnings, application_user_id)',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;

-- Published runtime defaults.  Existing Master overrides continue to win;
-- these values are the fallback for a clean configuration.
UPDATE system_settings
SET setting_value = JSON_SET(
  setting_value,
  '$.games.luck77.historyLength', 20,
  '$.games.greedy_king.historyLength', 10,
  '$.games.greedy_lion.historyLength', 10
)
WHERE setting_key = 'mobile.games'
  AND JSON_VALID(setting_value);
