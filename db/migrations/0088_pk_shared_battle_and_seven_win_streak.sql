-- PK shared-battle support: the two score panels and top-three supporter
-- strips are derived from the same authoritative gift rows.  This index keeps
-- that bounded active-PK query off the general Gift feed index.
SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND INDEX_NAME = 'idx_room_gift_pk_rank') = 0,
  'ALTER TABLE live_room_gift_events ADD INDEX idx_room_gift_pk_rank (room_id, created_at, sender_application_user_id)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- The original three-win-only constraint prevented a Host from retaining a
-- qualifying streak through the seven-win milestone. Remove only the check
-- whose expression governs current_streak, then replace it with 0..7.
SET @nazraa_pk_streak_check = (
  SELECT tc.CONSTRAINT_NAME
  FROM information_schema.TABLE_CONSTRAINTS tc
  INNER JOIN information_schema.CHECK_CONSTRAINTS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.CONSTRAINT_SCHEMA = @nazraa_schema
    AND tc.TABLE_NAME = 'pk_host_streaks'
    AND tc.CONSTRAINT_TYPE = 'CHECK'
    AND LOWER(cc.CHECK_CLAUSE) LIKE '%current_streak%'
  LIMIT 1
);
-- MariaDB uses DROP CONSTRAINT for a CHECK while MySQL accepts DROP CHECK.
-- Keep the migration portable because production runs MariaDB whereas local
-- development may use either engine.
SET @nazraa_drop_pk_check = IF(LOCATE('MariaDB', VERSION()) > 0, 'DROP CONSTRAINT', 'DROP CHECK');
SET @nazraa_sql = IF(@nazraa_pk_streak_check IS NULL,
  'SELECT 1',
  CONCAT('ALTER TABLE pk_host_streaks ', @nazraa_drop_pk_check, ' `', REPLACE(@nazraa_pk_streak_check, '`', '``'), '`'));
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = @nazraa_schema AND TABLE_NAME = 'pk_host_streaks' AND CONSTRAINT_NAME = 'chk_pk_host_streak_range') = 0,
  'ALTER TABLE pk_host_streaks ADD CONSTRAINT chk_pk_host_streak_range CHECK (current_streak BETWEEN 0 AND 7)', 'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- A row which somehow retained the retired terminal value starts a fresh
-- run. The v2 settlement code never lets this update issue coins.
UPDATE pk_host_streaks SET current_streak = 0 WHERE current_streak > 7;
