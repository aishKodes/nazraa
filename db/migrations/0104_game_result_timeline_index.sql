-- Lucky 77 history must be chronological even when configured round duration
-- changes. Epoch/duration round_number is not a chronological cursor then.
-- Online secondary index only: no wallet/result/settlement data is rewritten.
SET @has_result_timeline_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_shared_rounds'
    AND INDEX_NAME = 'idx_shared_game_result_time'
);
SET @sql := IF(
  @has_result_timeline_index = 0,
  'ALTER TABLE game_shared_rounds ADD INDEX idx_shared_game_result_time (game_name, drawing_ends_at), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1'
);
PREPARE statement FROM @sql;
EXECUTE statement;
DEALLOCATE PREPARE statement;
