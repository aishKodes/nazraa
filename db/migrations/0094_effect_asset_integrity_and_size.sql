-- Immutable Nazraa effect assets are cache-addressed by their SHA-256 digest.
-- The Control upload limit for premium Lottie/WebP/video effects is 3 MB; the
-- earlier 1 MB table check contradicted that server-side validation.

SET @nazraa_schema = DATABASE();

SET @nazraa_sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @nazraa_schema AND TABLE_NAME = 'gift_assets' AND COLUMN_NAME = 'checksum_sha256') = 0,
  'ALTER TABLE gift_assets ADD COLUMN checksum_sha256 CHAR(64) NULL AFTER byte_size',
  'SELECT 1');
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

UPDATE gift_assets
SET checksum_sha256 = SHA2(image_data, 256)
WHERE checksum_sha256 IS NULL OR checksum_sha256 = '';

ALTER TABLE gift_assets
  MODIFY COLUMN checksum_sha256 CHAR(64) NOT NULL;

SET @nazraa_gift_size_check = (
  SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
   WHERE tc.TABLE_SCHEMA = @nazraa_schema
     AND tc.TABLE_NAME = 'gift_assets'
     AND tc.CONSTRAINT_TYPE = 'CHECK'
   ORDER BY tc.CONSTRAINT_NAME
   LIMIT 1
);
SET @nazraa_sql = IF(@nazraa_gift_size_check IS NULL,
  'SELECT 1',
  -- MariaDB uses DROP CONSTRAINT for CHECK constraints (unlike MySQL's
  -- DROP CHECK syntax). Production runs MariaDB, so use the portable
  -- constraint form rather than relying on a MySQL-only migration path.
  CONCAT('ALTER TABLE gift_assets DROP CONSTRAINT `', REPLACE(@nazraa_gift_size_check, '`', '``'), '`'));
PREPARE nazraa_stmt FROM @nazraa_sql; EXECUTE nazraa_stmt; DEALLOCATE PREPARE nazraa_stmt;

ALTER TABLE gift_assets
  ADD CONSTRAINT chk_gift_assets_size CHECK (byte_size BETWEEN 1000 AND 3145728),
  ADD INDEX idx_gift_assets_checksum (checksum_sha256);
