import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { LiveKitRoomAdmin } from "@/lib/services/livekit-room-admin";
import { agencyJoinPolicy } from "@/lib/services/agency-join-policy";
import * as social from "@/lib/db/repositories/mobile-social";
import * as rooms from "@/lib/db/repositories/mobile-completion";

export async function verifyProductionStabilization(
  root: mysql.Connection,
  user: (name: string) => Promise<MobileIdentity>,
  owner: MobileIdentity,
  agencyId: string,
  agencyPublicId: string,
) {
  const original = LiveKitRoomAdmin.prototype.hostPresence;
  const makeRoom = async () => {
    const id=randomUUID(), code=`stability-${id}`;
    await root.execute("INSERT INTO live_rooms (id,room_code,host_application_user_id,room_type,started_at) VALUES (?,?,?,'FACE',CURRENT_TIMESTAMP(3)-INTERVAL 20 MINUTE)",[id,code,owner.userId]);
    await root.execute("INSERT INTO live_room_members (room_id,application_user_id,room_role,last_seen_at) VALUES (?,?,'OWNER',CURRENT_TIMESTAMP(3)-INTERVAL 10 MINUTE)",[id,owner.userId]);
    await root.execute("INSERT INTO live_session_accounting (id,room_id,host_application_user_id,room_type,started_at,last_media_heartbeat_at,last_media_evidence_at) VALUES (?,?,?,'FACE',CURRENT_TIMESTAMP(3)-INTERVAL 20 MINUTE,CURRENT_TIMESTAMP(3)-INTERVAL 10 MINUTE,CURRENT_TIMESTAMP(3)-INTERVAL 10 MINUTE)",[randomUUID(),id,owner.userId]);
    return {id,code};
  };
  const status = async (id: string) => {
    const [rows]=await root.query<mysql.RowDataPacket[]>("SELECT status FROM live_rooms WHERE id=?",[id]);
    return rows[0].status;
  };
  try {
    for (const evidence of ["PRESENT","UNKNOWN"] as const) {
      const room=await makeRoom();
      LiveKitRoomAdmin.prototype.hostPresence=async()=>evidence;
      await rooms.finalizeStaleLiveSession(room.code);
      assert.equal(await status(room.id),"ACTIVE",evidence);
    }
    // Deterministic reproduction: SFU read completes while a new API
    // heartbeat lands after selection, before the finalization transaction.
    for (const source of ["member","heartbeat","webhook"] as const) {
      const room=await makeRoom();
      LiveKitRoomAdmin.prototype.hostPresence=async()=>{
        if(source==='member')await root.execute("UPDATE live_room_members SET last_seen_at=CURRENT_TIMESTAMP(3) WHERE room_id=?",[room.id]);
        else await root.execute(`UPDATE live_session_accounting SET ${source==='webhook'?'last_media_evidence_at':'last_media_heartbeat_at'}=CURRENT_TIMESTAMP(3) WHERE room_id=?`,[room.id]);
        return "ABSENT";
      };
      await rooms.finalizeStaleLiveSession(room.code);
      assert.equal(await status(room.id),"ACTIVE",source);
    }
    LiveKitRoomAdmin.prototype.hostPresence=async()=>"ABSENT";
    const stale=await makeRoom();
    await rooms.finalizeStaleLiveSession(stale.code);
    assert.equal(await status(stale.id),"ENDED");
    await rooms.finalizeStaleLiveSession(stale.code);
    const [events]=await root.query<mysql.RowDataPacket[]>("SELECT close_reason FROM room_close_attempts WHERE room_id=? AND trigger_source='SERVER_FINALIZER'",[stale.id]);
    assert.equal(events.length,1);assert.equal(events[0].close_reason,"STALE_HOST_CONFIRMED_ABSENT");
    const returning=await makeRoom();
    let staleChecks=0;
    LiveKitRoomAdmin.prototype.hostPresence=async()=>{staleChecks++;return "ABSENT";};
    await rooms.refreshRoomPresence(owner,returning.code);
    assert.equal(await status(returning.id),"ACTIVE","returning authenticated Host refreshes before stale cleanup");
    assert.equal(staleChecks,0,"normal Host heartbeat never calls the stale-room SFU probe");
    const explicit=await makeRoom();
    await root.execute("UPDATE live_room_members SET last_seen_at=CURRENT_TIMESTAMP(3) WHERE room_id=?",[explicit.id]);
    await rooms.finalizeLiveSession(owner,explicit.code);
    assert.equal(await status(explicit.id),"ENDED","explicit Host close still works");
    console.log("PASS stale cleanup: connected Host, unavailable SFU, three heartbeat races, returning Host, confirmed departure, idempotency and explicit end");
  } finally { LiveKitRoomAdmin.prototype.hostPresence=original; }

  // A deliberately old last_active_at proves eligibility is account-based.
  await root.execute("UPDATE platform_accounts SET application_user_id=?,status='ACTIVE',removed_at=NULL WHERE id=?",[owner.userId,agencyId]);
  await root.execute("UPDATE application_users SET last_active_at='2020-01-01',account_status='ACTIVE' WHERE id=?",[owner.userId]);
  const applicant=await user("Stabilization Agency applicant");
  const search=await social.searchAgency(`  ${agencyPublicId}  `);
  assert.equal(search.results[0].canApply,true);
  const applications=await Promise.all(Array.from({length:6},()=>social.applyToJoinAgency(applicant,agencyPublicId)));
  assert.equal(new Set(applications.map(a=>a.id)).size,1);
  const pending=applications[0];
  assert.equal((await social.agencyOwnerSnapshot(owner)).joinRequests.some(a=>a.id===pending.id),true);
  await social.reviewOwnAgencyJoin(owner,{applicationId:pending.id,decision:"APPROVED"});
  await social.reviewOwnAgencyJoin(owner,{applicationId:pending.id,decision:"APPROVED"});
  const [mapping]=await root.query<mysql.RowDataPacket[]>("SELECT agency_account_id FROM application_users WHERE id=?",[applicant.userId]);
  assert.equal(mapping[0].agency_account_id,agencyId);
  for (const state of ["SUSPENDED","BANNED","INACTIVE"]) {
    await root.execute("UPDATE application_users SET account_status=? WHERE id=?",[state,owner.userId]);
    assert.equal((await social.searchAgency(agencyPublicId)).results[0].canApply,false);
    await assert.rejects(social.applyToJoinAgency(await user(`Applicant ${state}`),agencyPublicId),/owner account/);
  }
  await root.execute("UPDATE application_users SET account_status='ACTIVE' WHERE id=?",[owner.userId]);
  await root.execute("UPDATE platform_accounts SET application_user_id='missing-owner' WHERE id=?",[agencyId]);
  assert.equal((await social.searchAgency(agencyPublicId)).results[0].canApply,false);
  await assert.rejects(social.applyToJoinAgency(await user("Missing owner applicant"),agencyPublicId),/owner account link/);
  for(const agencyStatus of ["SUSPENDED","DISABLED"])assert.equal(agencyJoinPolicy({agencyStatus,ownerStatus:"ACTIVE"}).canApply,false);
  assert.equal(agencyJoinPolicy({agencyStatus:"ACTIVE",ownerStatus:"ACTIVE",removed:true}).canApply,false);
  console.log("PASS Agency: offline active owner, search/apply consistency, six concurrent retries, approval mapping, suspended/banned/inactive/missing owner and removed Agency");
}
