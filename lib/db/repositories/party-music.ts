import 'server-only';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {RowDataPacket} from 'mysql2/promise';
import {withTransaction} from '@/lib/db/transaction';
// Legacy owned tracks remain readable; new Android clients broadcast local PCM.
export const roomMusicCatalog=[{id:'moonlit',title:'Moonlit Lounge',asset:'audio/room_music/moonlit.m4a',durationMs:60000},{id:'aurora',title:'Soft Aurora',asset:'audio/room_music/aurora.m4a',durationMs:60000}];
export type MusicAction='state'|'search'|'play'|'local-start'|'pause'|'resume'|'stop'|'heartbeat';
export async function partyMusic(identity:MobileIdentity,input:{roomCode:string;action:MusicAction;trackId?:string;query?:string;fileName?:string;generation?:number}){
 return withTransaction(async c=>{
  const [members]=await c.query<RowDataPacket[]>(`SELECT r.id,r.room_type,r.host_application_user_id,m.room_role,m.media_role,
    m.muted_by_staff,EXISTS(SELECT 1 FROM party_room_admins a WHERE a.room_id=r.id AND a.application_user_id=m.application_user_id AND a.revoked_at IS NULL) permanent_admin
    FROM live_rooms r JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=? AND m.left_at IS NULL
    WHERE r.room_code=? AND r.status IN ('ACTIVE','LOCKED') FOR UPDATE`,[identity.userId,input.roomCode]);
  const member=members[0];if(!member)throw Error('Join this room to use music.');
  const owner=String(member.host_application_user_id)===identity.userId;
  const edit=owner||(member.room_type==='PARTY'&&member.permanent_admin);
  const canStart=Boolean(edit&&!member.muted_by_staff&&['HOST','PARTY_OWNER','RTC_SPEAKER'].includes(member.media_role));
  const [prior]=await c.query<RowDataPacket[]>('SELECT *,CURRENT_TIMESTAMP(3) server_now FROM party_room_music WHERE room_id=? FOR UPDATE',[member.id]);let old=prior[0];
  if(old?.source_kind==='LOCAL_PCM'&&old.lease_expires_at&&new Date(old.lease_expires_at)<new Date(old.server_now)){
    await c.execute('UPDATE party_room_music SET playing=FALSE,track_key=NULL,controller_user_id=NULL,version=version+1 WHERE room_id=?',[member.id]);old={...old,playing:false,track_key:null,controller_user_id:null} as RowDataPacket;
  }
  if(!['state','search'].includes(input.action)){
    if(!edit)throw Error('Only the Host or an authorized Room Admin controls music.');
    if(input.generation!=null&&Number(old?.publication_generation)!==input.generation)throw Error('Room music changed. Refresh and try again.');
    if(['play','local-start','resume'].includes(input.action)&&!canStart)throw Error('Take an authorized microphone seat before sharing music.');
    if(old?.controller_user_id&&String(old.controller_user_id)!==identity.userId&&input.action!=='stop')throw Error('Another controller is already sharing room music.');
    if(input.action==='local-start'){
      const name=input.fileName?.trim();if(!name||name.length>128||/[\\/\r\n\u0000]/.test(name)||/^[a-z]+:/i.test(name))throw Error('Choose a valid audio file name.');
      await c.execute(`INSERT INTO party_room_music(room_id,track_key,playing,position_ms,updated_by,source_kind,display_name,controller_user_id,publication_generation,lease_expires_at)
        VALUES(?,'local',TRUE,0,?,'LOCAL_PCM',?,?,1,CURRENT_TIMESTAMP(3)+INTERVAL 60 SECOND)
        ON DUPLICATE KEY UPDATE track_key='local',playing=TRUE,position_ms=0,updated_by=VALUES(updated_by),source_kind='LOCAL_PCM',display_name=VALUES(display_name),controller_user_id=VALUES(controller_user_id),publication_generation=publication_generation+1,lease_expires_at=VALUES(lease_expires_at),version=version+1,updated_at=CURRENT_TIMESTAMP(3)`,[member.id,identity.userId,name,identity.userId]);
    }else if(old?.source_kind==='LOCAL_PCM'){
      if(!old.controller_user_id&&input.action!=='stop')throw Error('Select music to start sharing.');
      if(input.action==='heartbeat'){
        if(String(old.controller_user_id)!==identity.userId)throw Error('Only the current music controller can refresh playback.');
        await c.execute('UPDATE party_room_music SET lease_expires_at=CURRENT_TIMESTAMP(3)+INTERVAL 60 SECOND WHERE room_id=?',[member.id]);
      }else await c.execute(`UPDATE party_room_music SET playing=?,track_key=IF(?='stop',NULL,track_key),controller_user_id=IF(?='stop',NULL,controller_user_id),position_ms=IF(?='stop',0,position_ms),version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP(3),lease_expires_at=CURRENT_TIMESTAMP(3)+INTERVAL 60 SECOND WHERE room_id=?`,[input.action==='resume',input.action,input.action,input.action,identity.userId,member.id]);
    }else if(input.action!=='heartbeat'){
      const track=input.action==='play'?roomMusicCatalog.find(t=>t.id===input.trackId):roomMusicCatalog.find(t=>t.id===old?.track_key);
      if(!track&&input.action!=='stop')throw Error('Choose an available room track.');
      const elapsed=old?.playing?Math.max(0,new Date(old.server_now).getTime()-new Date(old.updated_at).getTime()):0;
      const position=['play','stop'].includes(input.action)?0:(Number(old?.position_ms??0)+elapsed)%60000;
      await c.execute(`INSERT INTO party_room_music(room_id,track_key,playing,position_ms,updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE track_key=VALUES(track_key),playing=VALUES(playing),position_ms=VALUES(position_ms),version=version+1,updated_at=CURRENT_TIMESTAMP(3),updated_by=VALUES(updated_by)`,[member.id,input.action==='stop'?null:track!.id,['play','resume'].includes(input.action),position,identity.userId]);
    }
  }
  const [rows]=await c.query<RowDataPacket[]>(`SELECT music.*,u.public_id controller_public_id,CURRENT_TIMESTAMP(3) server_now FROM party_room_music music LEFT JOIN application_users u ON u.id=music.controller_user_id WHERE music.room_id=?`,[member.id]);
  const row=rows[0];const track=row?.source_kind==='LOCAL_PCM'?(row.track_key?{id:'local',title:String(row.display_name)}:null):roomMusicCatalog.find(t=>t.id===row?.track_key);
  return {canEdit:Boolean(edit),canStart,catalog:roomMusicCatalog.filter(t=>t.title.toLowerCase().includes((input.query??'').toLowerCase().trim())),state:row?{track,sourceKind:row.source_kind,controllerId:row.controller_public_id==null?null:String(row.controller_public_id),generation:Number(row.publication_generation),playing:Boolean(row.playing),positionMs:Number(row.position_ms),version:Number(row.version),updatedAt:row.updated_at,serverNow:row.server_now}:null};
 });
}
