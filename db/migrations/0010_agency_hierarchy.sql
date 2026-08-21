-- Agency parent verification, encrypted KYC, and Admin/BD genealogy.
-- BD uses the existing ADMIN permission boundary while retaining a distinct
-- designation for hierarchy and review screens.

ALTER TABLE platform_accounts
  ADD COLUMN admin_kind ENUM('ADMIN','BD') NULL AFTER role;

UPDATE platform_accounts SET admin_kind = 'ADMIN' WHERE role = 'ADMIN' AND admin_kind IS NULL;

ALTER TABLE agency_creation_applications
  ADD COLUMN owner_name VARCHAR(120) NULL AFTER agency_name,
  ADD COLUMN parent_account_id CHAR(36) NULL AFTER business_whatsapp_e164,
  ADD COLUMN pan_last4 CHAR(4) NULL AFTER parent_account_id,
  ADD COLUMN pan_encrypted VARBINARY(512) NULL AFTER pan_last4,
  ADD COLUMN pan_iv BINARY(12) NULL AFTER pan_encrypted,
  ADD COLUMN pan_tag BINARY(16) NULL AFTER pan_iv,
  ADD COLUMN aadhaar_last4 CHAR(4) NULL AFTER pan_tag,
  ADD COLUMN aadhaar_encrypted VARBINARY(512) NULL AFTER aadhaar_last4,
  ADD COLUMN aadhaar_iv BINARY(12) NULL AFTER aadhaar_encrypted,
  ADD COLUMN aadhaar_tag BINARY(16) NULL AFTER aadhaar_iv,
  ADD COLUMN document_original_name VARCHAR(255) NULL AFTER logo_byte_size,
  ADD COLUMN document_mime_type VARCHAR(100) NULL AFTER document_original_name,
  ADD COLUMN document_byte_size INT UNSIGNED NULL AFTER document_mime_type,
  ADD COLUMN document_encrypted_data LONGBLOB NULL AFTER document_byte_size,
  ADD COLUMN document_encryption_iv BINARY(12) NULL AFTER document_encrypted_data,
  ADD COLUMN document_encryption_tag BINARY(16) NULL AFTER document_encryption_iv,
  ADD CONSTRAINT fk_agency_create_parent FOREIGN KEY (parent_account_id) REFERENCES platform_accounts(id),
  ADD INDEX idx_agency_create_parent_review (parent_account_id, status, created_at),
  ADD CONSTRAINT chk_agency_document_size CHECK (document_byte_size IS NULL OR document_byte_size BETWEEN 1 AND 2097152);

