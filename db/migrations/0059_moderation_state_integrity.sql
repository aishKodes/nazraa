-- Keep account bans, device blocks, and temporary Live restrictions independent.
-- Session revocations are tagged so an unblock can restore only the session that
-- the matching moderation action revoked, without resurrecting explicit logouts.

ALTER TABLE moderation_restrictions
  MODIFY COLUMN restriction_type ENUM('TEMP_LIVE_BAN','WARNING','SUSPENSION','ACCOUNT_BAN') NOT NULL;

ALTER TABLE mobile_sessions
  ADD COLUMN revoked_reason VARCHAR(32) NULL AFTER revoked_at,
  ADD COLUMN revoked_reference_id CHAR(36) NULL AFTER revoked_reason,
  ADD INDEX idx_mobile_session_moderation_revocation
    (application_user_id, revoked_reason, revoked_reference_id, expires_at);

-- Older permanent-ban code represented the account ban as a generic hosting
-- suspension. Reclassify only the row that coincides with a permanent-ban audit
-- event; unrelated Face Live/hosting suspensions remain separate.
UPDATE moderation_restrictions restriction_row
INNER JOIN application_users user_row
  ON user_row.id = restriction_row.application_user_id
 AND user_row.account_status = 'BANNED'
SET restriction_row.restriction_type = 'ACCOUNT_BAN'
WHERE restriction_row.restriction_type = 'SUSPENSION'
  AND restriction_row.status = 'ACTIVE'
  AND restriction_row.ends_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM audit_logs audit_row
    WHERE audit_row.action = 'user.permanent_ban'
      AND audit_row.target_type = 'application_user'
      AND audit_row.target_id = restriction_row.application_user_id
      AND ABS(TIMESTAMPDIFF(SECOND, audit_row.created_at, restriction_row.created_at)) <= 5
  );

-- Safely tag legacy sessions only when their revocation timestamp matches the
-- account-ban restriction. Ambiguous historical revocations stay untouched.
UPDATE mobile_sessions session_row
INNER JOIN moderation_restrictions restriction_row
  ON restriction_row.application_user_id = session_row.application_user_id
 AND restriction_row.restriction_type = 'ACCOUNT_BAN'
 AND restriction_row.status = 'ACTIVE'
SET session_row.revoked_reason = 'ACCOUNT_BAN',
    session_row.revoked_reference_id = restriction_row.id
WHERE session_row.revoked_at IS NOT NULL
  AND session_row.revoked_reason IS NULL
  AND ABS(TIMESTAMPDIFF(SECOND, session_row.revoked_at, restriction_row.created_at)) <= 5;
