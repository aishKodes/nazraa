-- Align the advertised Face capacity with the server's hard maximum of three.
-- Preserve every unrelated setting and any owner-configured lower capacity.
-- A deployment audit is not impersonation of a Control account.
SET @nazraa_face_capacity_before = NULL;
SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(setting_value, '$.maxFaceAudioGuests')) AS UNSIGNED)
INTO @nazraa_face_capacity_before
FROM system_settings WHERE setting_key = 'mobile.room_features' FOR UPDATE;

UPDATE system_settings
SET setting_value = JSON_SET(setting_value, '$.maxFaceAudioGuests', 3)
WHERE setting_key = 'mobile.room_features' AND @nazraa_face_capacity_before > 3;

INSERT INTO audit_logs
  (id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
SELECT UUID(), 'MIGRATION', 'settings.face_guest_capacity_align', 'settings',
       'system_setting', 'mobile.room_features',
       JSON_OBJECT('maxFaceAudioGuests', @nazraa_face_capacity_before),
       JSON_OBJECT('maxFaceAudioGuests', 3),
       'Face master specification: align public configuration with the enforced three-guest maximum; unrelated configuration preserved'
WHERE @nazraa_face_capacity_before > 3;
