-- Profile Live History reads the same durable media and completed Gift-event
-- ledgers used by rewards/economy. These stamped business dates make the
-- bounded date aggregation indexable without relying on MySQL IANA timezone
-- tables at request time. Historical production policy is Asia/Kolkata.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND COLUMN_NAME = 'business_date') = 0,
  'ALTER TABLE live_session_accounting ADD COLUMN business_date DATE NULL AFTER started_at',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND COLUMN_NAME = 'business_date') = 0,
  'ALTER TABLE live_room_gift_events ADD COLUMN business_date DATE NULL AFTER created_at',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

-- Existing Nazraa business history uses Asia/Kolkata. New writes are stamped
-- in Node from the active Live rules, so a future timezone policy change does
-- not reinterpret historical rows.
UPDATE live_session_accounting
SET business_date = DATE(DATE_ADD(started_at, INTERVAL 330 MINUTE))
WHERE business_date IS NULL;

UPDATE live_room_gift_events
SET business_date = DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE))
WHERE business_date IS NULL;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_session_accounting' AND INDEX_NAME = 'idx_live_history_host_day') = 0,
  'ALTER TABLE live_session_accounting ADD INDEX idx_live_history_host_day (host_application_user_id, business_date, status)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND INDEX_NAME = 'idx_gift_history_sender_day') = 0,
  'ALTER TABLE live_room_gift_events ADD INDEX idx_gift_history_sender_day (sender_application_user_id, business_date)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'live_room_gift_events' AND INDEX_NAME = 'idx_gift_history_receiver_day') = 0,
  'ALTER TABLE live_room_gift_events ADD INDEX idx_gift_history_receiver_day (receiver_application_user_id, business_date)',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;
