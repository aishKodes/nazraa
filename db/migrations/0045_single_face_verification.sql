-- One authoritative Face Verification decision.
-- Legacy per-layer authorization columns remain synchronized for older mobile
-- releases, but current policy no longer requires repeated approval.

UPDATE application_users
SET agency_face_live_authorized = (face_verification_status = 'VERIFIED'),
    super_admin_face_live_authorized = (face_verification_status = 'VERIFIED');

INSERT INTO host_profiles
  (id, application_user_id, agency_account_id, status, verification_status)
SELECT UUID(), user.id, user.agency_account_id, 'ACTIVE',
       CASE
         WHEN user.face_verification_status = 'VERIFIED' THEN 'VERIFIED'
         WHEN user.face_verification_status = 'REJECTED' THEN 'REJECTED'
         WHEN user.face_verification_status IN ('PENDING','PROCESSING','RETRY','DUPLICATE') THEN 'PENDING'
         ELSE 'UNVERIFIED'
       END
FROM application_users user
LEFT JOIN host_profiles host ON host.application_user_id = user.id
WHERE host.id IS NULL;

UPDATE host_profiles host
INNER JOIN application_users user ON user.id = host.application_user_id
SET host.verification_status = CASE
  WHEN user.face_verification_status = 'VERIFIED' THEN 'VERIFIED'
  WHEN user.face_verification_status = 'REJECTED' THEN 'REJECTED'
  WHEN user.face_verification_status IN ('PENDING','PROCESSING','RETRY','DUPLICATE') THEN 'PENDING'
  ELSE 'UNVERIFIED'
END;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.19',
  '$.latestBuild', 5329
)
WHERE setting_key = 'mobile.app_config';
