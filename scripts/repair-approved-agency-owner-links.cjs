// Owner-approved maintenance only. No API route. No ownership guessed from
// names, membership, online status or partial emails. A caller must supply the
// exact reviewed public-ID pairs; every premise is rechecked under row locks.
const mysql = require('mysql2/promise');
const {randomUUID} = require('node:crypto');

async function repair(connection, pairs, apply) {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 5 ||
      pairs.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isSafeInteger(v)||v<=0)) ||
      new Set(pairs.map(p=>p[0])).size!==pairs.length || new Set(pairs.map(p=>p[1])).size!==pairs.length) {
    throw new Error('Invalid approved ownership manifest');
  }
  await connection.beginTransaction();
  try {
    const changes=[];
    for(const [agencyPublicId,userPublicId] of pairs) {
      const [rows]=await connection.query(`SELECT a.id agency_id,a.application_user_id old_reference,
        u.id owner_id,u.public_id owner_public_id,u.external_user_id
        FROM platform_accounts a JOIN application_users u ON u.public_id=? AND u.email=a.email
        WHERE a.public_id=? AND a.role='AGENCY' AND a.status='ACTIVE' AND a.removed_at IS NULL
          AND u.account_status='ACTIVE' AND u.google_subject IS NOT NULL
          AND (SELECT COUNT(*) FROM application_users same WHERE same.email=a.email)=1
        FOR UPDATE`,[userPublicId,agencyPublicId]);
      if(rows.length!==1)throw new Error('Reviewed identity evidence changed');
      const r=rows[0];
      if(r.old_reference===r.owner_id)continue; // Safe to retry after a successful commit.
      const [resolved]=await connection.query(`SELECT id FROM application_users
        WHERE id=TRIM(?) OR external_user_id=TRIM(?) OR CAST(public_id AS CHAR)=TRIM(?)`,
        [r.old_reference,r.old_reference,r.old_reference]);
      if(resolved.length)throw new Error('Existing owner now resolves; review required');
      const [other]=await connection.query(`SELECT id FROM platform_accounts WHERE role='AGENCY' AND id<>?
        AND (TRIM(application_user_id)=? OR TRIM(application_user_id)=? OR TRIM(application_user_id)=?)`,
        [r.agency_id,r.owner_id,r.external_user_id,String(r.owner_public_id)]);
      if(other.length)throw new Error('Candidate already owns another Agency');
      changes.push({agencyPublicId,userPublicId,...r});
    }
    if(apply)for(const r of changes) {
      const [result]=await connection.execute(`UPDATE platform_accounts SET application_user_id=?
        WHERE id=? AND application_user_id <=> ?`,[r.owner_id,r.agency_id,r.old_reference]);
      if(result.affectedRows!==1)throw new Error('Ownership changed concurrently');
      await connection.execute(`INSERT INTO audit_logs
        (id,actor_role,action,module,target_type,target_id,previous_data,new_data,reason)
        VALUES (?,'SYSTEM','agency.owner_link_repaired','agencies','platform_account',?,?,?,?)`,
        [randomUUID(),r.agency_id,JSON.stringify({applicationUserId:r.old_reference}),
          JSON.stringify({applicationUserId:r.owner_id,publicUserId:r.userPublicId}),
          'Owner-approved 2026-10-25: exact reviewed User ID; unique active Google-authenticated account matches recorded owner email; old reference unresolved.']);
    }
    if(apply)await connection.commit();else await connection.rollback();
    return {applied:apply,count:changes.length,pairs:changes.map(r=>[r.agencyPublicId,r.userPublicId])};
  } catch(error) {await connection.rollback();throw error;}
}
module.exports={repair};
if(require.main===module)(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,charset:'utf8mb4_general_ci'});
  try{console.log(JSON.stringify(await repair(c,JSON.parse(process.argv[2]),process.argv.includes('--apply'))));}
  finally{await c.end();}
})().catch(()=>{console.error('OWNER_LINK_REPAIR_ABORTED; transaction rolled back; inspect reviewed evidence');process.exitCode=1;});
