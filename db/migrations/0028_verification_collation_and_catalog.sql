-- Normalize the older verification schema to the connection collation used by
-- the Control Platform. IDs and foreign-key columns are intentionally left
-- unchanged; only user-facing text/enum columns involved in comparisons are
-- converted, so the migration is safe for an existing hierarchy.

ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE application_users
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN full_name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN avatar_url VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN country_code CHAR(2) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN google_subject VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN email VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN gender ENUM('FEMALE','MALE','NON_BINARY','PREFER_NOT_TO_SAY') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN bio VARCHAR(280) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  MODIFY COLUMN language_code VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en',
  MODIFY COLUMN whatsapp_e164 VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN face_verification_status ENUM('NOT_SUBMITTED','PENDING','PROCESSING','VERIFIED','DUPLICATE','RETRY','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'NOT_SUBMITTED';

ALTER TABLE face_verification_requests
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN status ENUM('PENDING','PROCESSING','VERIFIED','DUPLICATE','RETRY','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROCESSING',
  MODIFY COLUMN provider VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN provider_face_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN embedding_reference VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN review_reason VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;

ALTER TABLE private_documents
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY COLUMN owner_type ENUM('PLATFORM_ACCOUNT','HOST_APPLICATION','FACE_VERIFICATION') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN document_type VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN original_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN mime_type VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN verification_status ENUM('PENDING','VERIFIED','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING';

-- One backend-controlled catalogue powers Mall categories. Existing rows are
-- virtual gifts, so historic gifting and ledger references remain unchanged.
ALTER TABLE gift_catalog
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  ADD COLUMN catalog_type ENUM('VIRTUAL_GIFT','ENTRY_FRAME','PROFILE_EFFECT','MEDAL','BADGE')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'VIRTUAL_GIFT' AFTER category,
  MODIFY COLUMN gift_key VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN category VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN visual_url VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY COLUMN animation_key VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  ADD INDEX idx_gift_catalog_type_active (catalog_type, active, coin_price);
