-- Close stale telemetry markers and database grants left behind by ended
-- rooms or interrupted joins. This does not terminate a currently healthy
-- media session: fresh room heartbeats remain authoritative.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_media_usage' AND INDEX_NAME = 'idx_media_usage_active') = 0,
  'ALTER TABLE live_media_usage ADD INDEX idx_media_usage_active (ended_at, last_seen_at)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE live_media_usage media_usage
INNER JOIN live_rooms room ON room.id = media_usage.room_id
SET media_usage.ended_at = COALESCE(room.ended_at, media_usage.last_seen_at, CURRENT_TIMESTAMP(3))
WHERE media_usage.ended_at IS NULL
  AND room.status = 'ENDED';

UPDATE live_media_usage
SET ended_at = COALESCE(last_seen_at, CURRENT_TIMESTAMP(3))
WHERE ended_at IS NULL
  AND last_seen_at < CURRENT_TIMESTAMP(3) - INTERVAL 2 MINUTE;

UPDATE live_media_access_grants grant_row
INNER JOIN live_rooms room ON room.id = grant_row.room_id
SET grant_row.revoked_at = COALESCE(room.ended_at, CURRENT_TIMESTAMP(3))
WHERE grant_row.revoked_at IS NULL
  AND room.status = 'ENDED';

UPDATE live_media_access_grants
SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3))
WHERE revoked_at IS NULL
  AND expires_at <= CURRENT_TIMESTAMP(3);
