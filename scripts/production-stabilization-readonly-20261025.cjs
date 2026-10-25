// Run inside the existing API container. Aggregate diagnostics only: no PII,
// credentials, financial changes or lifecycle mutations.
const mysql = require('mysql2/promise');
const queries = {
  missingOwnerReferences: `SELECT a.public_id agency_public_id,
    CASE WHEN a.application_user_id IS NULL THEN 'NULL' WHEN a.application_user_id='' THEN 'EMPTY'
      WHEN a.application_user_id REGEXP '^[0-9]+$' THEN 'NUMERIC' ELSE 'OTHER' END reference_kind,
    (SELECT COUNT(DISTINCT ca.application_user_id) FROM agency_creation_applications ca
      JOIN application_users u ON u.id=ca.application_user_id AND u.account_status='ACTIVE'
      WHERE ca.approved_agency_account_id=a.id AND ca.status='APPROVED') approved_owner_candidates,
    (SELECT COUNT(*) FROM platform_accounts same WHERE same.application_user_id=a.application_user_id AND same.role='AGENCY') shared_references
    FROM platform_accounts a WHERE a.role='AGENCY' AND a.status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM application_users u WHERE u.id=a.application_user_id
      OR u.external_user_id=a.application_user_id OR CAST(u.public_id AS CHAR)=a.application_user_id)`,
  ownerJoinSchema: `SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.columns
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('platform_accounts','agency_creation_applications')
    AND COLUMN_NAME REGEXP 'owner|application_user|removed|status'`,
  closeClassification: `SELECT
    CASE WHEN ABS(TIMESTAMPDIFF(SECOND,r.ended_at,CAST(CONCAT(DATE(r.ended_at),' 19:30:00') AS DATETIME)))<90 THEN 'SCHEDULE_BOUNDARY_IST_0100'
    WHEN EXISTS(SELECT 1 FROM room_close_attempts ca WHERE ca.room_id=r.id AND ca.close_reason='EXPLICIT_HOST_END'
      AND ABS(TIMESTAMPDIFF(SECOND,ca.created_at,r.ended_at))<20) THEN 'EXPLICIT_HOST'
    WHEN TIMESTAMPDIFF(SECOND,m.last_seen_at,r.ended_at)>=300 THEN 'HOST_HEARTBEAT_STALE_300S'
    ELSE 'OTHER_REQUIRES_CORRELATION' END observed_boundary,
    COUNT(*) room_count,
    MIN(TIMESTAMPDIFF(SECOND,a.last_media_evidence_at,r.ended_at)) min_last_media_age_seconds,
    MAX(TIMESTAMPDIFF(SECOND,a.last_media_evidence_at,r.ended_at)) max_last_media_age_seconds
    FROM live_rooms r JOIN live_session_accounting a ON a.room_id=r.id
    LEFT JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=r.host_application_user_id
    WHERE r.room_type IN ('FACE','LIVE') AND r.status='ENDED' AND r.ended_at>CURRENT_TIMESTAMP-INTERVAL 2 DAY
    GROUP BY observed_boundary`,
  currentRooms: `SELECT r.room_type,COUNT(*) room_count,
    MAX(TIMESTAMPDIFF(SECOND,m.last_seen_at,CURRENT_TIMESTAMP)) max_host_heartbeat_age_seconds
    FROM live_rooms r LEFT JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=r.host_application_user_id
    WHERE r.status IN ('ACTIVE','LOCKED') GROUP BY r.room_type`,
  accountSettings: `SELECT setting_key,setting_value FROM system_settings
    WHERE setting_key IN ('mobile.face_live_rules','mobile.room_features','mobile.app_version')`,
  storageTables: `SELECT table_name,ROUND((data_length+index_length)/1024/1024,1) mb
    FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY data_length+index_length DESC LIMIT 8`,
};
(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,timezone:'Z'});
  for(const [label,sql] of Object.entries(queries)) {
    try {const [rows]=await c.query(sql); console.log(label,JSON.stringify(rows));}
    catch(e){console.log(label,JSON.stringify({errorCode:e.code}));}
  }
  await c.end();
})().catch(e=>{console.log('auditFailed',JSON.stringify({errorCode:e.code}));process.exitCode=1;});
