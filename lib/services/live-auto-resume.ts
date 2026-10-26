import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolConnection, RowDataPacket} from 'mysql2/promise';
import {businessDateFor, loadFaceLiveRules} from '@/lib/services/live-business-policy';
import {publishingCheckpoint} from '@/lib/services/live-session-checkpoint';
import {autoResumeDecision, AUTO_RESUME_SECONDS} from '@/lib/services/live-auto-resume-policy';

/** Called inside the EXISTING room/accounting transaction. Room lock first;
 * then session; then host/day mutex. Heartbeat and signed provider evidence
 * share one cursor and one interruption. Never credits a wallet. */
export async function checkpointHostLive(connection: PoolConnection, input: {
  accountingId: string; publishing: boolean; source: 'HEARTBEAT'|'PROVIDER';
  applicationInterrupted?: boolean; occurredAt?: Date;
  mobileSessionId?: string;
  publisherGrantId?: string;
  applicationInstanceId?: string;
}) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT *, CURRENT_TIMESTAMP(3) server_now FROM live_session_accounting
     WHERE id=? AND status='ACTIVE' LIMIT 1 FOR UPDATE`, [input.accountingId]);
  const row = rows[0];
  if (!row) return null;
  if (input.source==='HEARTBEAT' && (input.mobileSessionId || input.publisherGrantId)) {
    const [grants]=await connection.query<RowDataPacket[]>(`SELECT id,mobile_session_id FROM livekit_media_access_grants
      WHERE room_id=? AND application_user_id=? AND revoked_at IS NULL AND publish_mode<>'none'
      ORDER BY issued_at DESC LIMIT 1`,[row.room_id,row.host_application_user_id]);
    if((grants[0]?.mobile_session_id && grants[0].mobile_session_id!==input.mobileSessionId) ||
      (input.publisherGrantId && grants[0]?.id!==input.publisherGrantId))return row;
  }
  const now = new Date(row.server_now), evidenceCursor=row.last_media_evidence_at??row.last_media_heartbeat_at;
  const previous = evidenceCursor ? new Date(evidenceCursor) : null;
  const wasPublishing = Boolean(row.media_publishing);
  const instanceChanged=Boolean(input.applicationInstanceId && row.application_instance_id && input.applicationInstanceId!==row.application_instance_id);
  const applicationInterrupted=input.applicationInterrupted===true || instanceChanged;
  const legacySignals=!row.application_instance_id && !input.applicationInstanceId;
  // A delayed old transport event must not suspend the restored publisher.
  if (input.occurredAt && previous && input.occurredAt < previous) return row;
  const effectiveNow = input.occurredAt ? new Date(Math.min(+now, +input.occurredAt)) : now;
  const gap = previous ? +effectiveNow - +previous : 0;
  let segment = Number(row.media_segment_seconds), completed = Number(row.eligible_duration_seconds);
  let valid = Number(row.valid_media_seconds), committed = Number(row.eligible_seconds_committed);
  let cycle = Number(row.reward_cycle_version), interruptionId = row.auto_resume_interruption_id as string|null;
  const checkpoint = publishingCheckpoint({wasPublishing, publishingNow:input.publishing,
    previousEvidence:previous, serverTime:effectiveNow, evidenceWindowSeconds:30});
  // A destroy/false event can arrive only after the provider's disconnect
  // timeout. It proves that publishing stopped, not that media continued up
  // to that timestamp. Conservatively retain the last positive checkpoint;
  // never award the unconfirmed tail of a crashed/offline publisher.
  const confirmedSeconds=input.publishing?checkpoint.seconds:0;
  segment += confirmedSeconds; valid += confirmedSeconds; committed += confirmedSeconds;

  // Crash detection is conservative: the last server-confirmed checkpoint,
  // not receipt time or an imagined offline interval, is the interruption.
  const missedCheckpoint = wasPublishing && previous != null && gap > 30_000;
  const legacyInterrupted = !wasPublishing && input.publishing && segment>0 && previous!=null;
  if (!interruptionId && (missedCheckpoint || legacyInterrupted || (wasPublishing && !input.publishing))) {
    const at = previous ?? effectiveNow;
    interruptionId = randomUUID();
    await connection.execute(`INSERT INTO live_session_interruptions
      (id,live_session_accounting_id,host_application_user_id,live_type,disconnected_at,
       grace_expires_at,saved_continuous_seconds,reward_cycle_version,qualifying,source)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [interruptionId,row.id,row.host_application_user_id,
      row.room_type==='PARTY'?'PARTY':'FACE',at,new Date(+at+AUTO_RESUME_SECONDS*1000),segment,cycle,
      applicationInterrupted || (legacySignals && input.source==='HEARTBEAT' && input.publishing && (missedCheckpoint || (legacyInterrupted && gap>30_000))),input.source]);
  }
  if (interruptionId) {
    const [interruptions] = await connection.query<RowDataPacket[]>(
      'SELECT * FROM live_session_interruptions WHERE id=? FOR UPDATE',[interruptionId]);
    const interruption = interruptions[0];
    if (interruption?.resume_status === 'PENDING') {
      const at = new Date(interruption.disconnected_at);
      // Elapsed transport downtime is not an application interruption. A
      // surviving foreground process can reconnect without consuming quota.
      const qualifying = Boolean(interruption.qualifying) || applicationInterrupted;
      if (qualifying && !interruption.qualifying) await connection.execute(
        'UPDATE live_session_interruptions SET qualifying=TRUE WHERE id=?',[interruptionId]);
      if (input.publishing) {
        const rules = await loadFaceLiveRules(connection), day=businessDateFor(rules.timezone,now);
        await connection.execute(`INSERT INTO live_auto_resume_days(host_application_user_id,business_date)
          VALUES (?,?) ON DUPLICATE KEY UPDATE host_application_user_id=VALUES(host_application_user_id)`,[row.host_application_user_id,day]);
        const [days] = await connection.query<RowDataPacket[]>(
          'SELECT successful_resumes FROM live_auto_resume_days WHERE host_application_user_id=? AND business_date=? FOR UPDATE',[row.host_application_user_id,day]);
        const decision=autoResumeDecision({interruptedAt:at,serverNow:effectiveNow,qualifying:qualifying&&segment>0,successfulToday:Number(days[0].successful_resumes)});
        if (decision==='STALE') return row;
        if (decision==='RESUMED') await connection.execute(`UPDATE live_auto_resume_days
          SET successful_resumes=successful_resumes+1 WHERE host_application_user_id=? AND business_date=? AND successful_resumes<5`,[row.host_application_user_id,day]);
        if (decision==='EXPIRED'||decision==='QUOTA_EXHAUSTED') {
          // Preserve completed decisions/claimable units and actual history;
          // discard ONLY unfinished continuous progress for the new cycle.
          const period=Number(row.reward_period_seconds??3600);
          completed += Math.floor(segment/period)*period; segment=0; cycle++;
        }
        await connection.execute(`UPDATE live_session_interruptions SET resume_status=?,resumed_at=?,resume_business_date=?
          WHERE id=? AND resume_status='PENDING'`,[decision,now,day,interruptionId]);
        interruptionId=null;
      }
    }
  }
  const state=input.publishing?'PUBLISHING':interruptionId?'GRACE':'STARTING';
  await connection.execute(`UPDATE live_session_accounting SET media_publishing=?,
    current_publish_started_at=CASE WHEN ? THEN COALESCE(current_publish_started_at,?) ELSE NULL END,
    last_media_heartbeat_at=CASE WHEN ?='HEARTBEAT' THEN ? ELSE last_media_heartbeat_at END,
    last_heartbeat_at=CASE WHEN ?='HEARTBEAT' THEN ? ELSE last_heartbeat_at END,
    last_media_evidence_at=CASE WHEN ? THEN ? ELSE last_media_evidence_at END,
    media_segment_seconds=?, valid_media_seconds=?, eligible_duration_seconds=?, eligible_seconds_committed=?,
    reconnect_state=?, accounting_accuracy='CONFIRMED',auto_resume_interruption_id=?,reward_cycle_version=?,
    application_instance_id=COALESCE(?,application_instance_id)
    WHERE id=? AND status='ACTIVE'`,[input.publishing,input.publishing,now,input.source,now,input.source,now,
      input.publishing,checkpoint.cursor,segment,valid,completed,committed,state,interruptionId,cycle,input.applicationInstanceId??null,row.id]);
  return {...row, media_publishing:input.publishing,media_segment_seconds:segment,valid_media_seconds:valid,
    eligible_duration_seconds:completed,eligible_seconds_committed:committed,reconnect_state:state,
    auto_resume_interruption_id:interruptionId,reward_cycle_version:cycle};
}
