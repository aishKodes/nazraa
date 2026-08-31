-- Preserve Agency membership history when an owner removes a host.
-- Membership still changes only through the authenticated Agency workflow.
ALTER TABLE agency_membership_applications
  MODIFY COLUMN status ENUM('PENDING','APPROVED','REJECTED','SUSPENDED','REMOVED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN ended_by CHAR(36) NULL AFTER review_reason,
  ADD COLUMN ended_at DATETIME(3) NULL AFTER ended_by,
  ADD COLUMN end_reason VARCHAR(500) NULL AFTER ended_at,
  ADD CONSTRAINT fk_agency_join_ended_by FOREIGN KEY (ended_by) REFERENCES platform_accounts(id),
  ADD INDEX idx_agency_join_membership (application_user_id, status, updated_at);
