import 'server-only';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import type {RowDataPacket} from 'mysql2/promise';
import {withTransaction} from '@/lib/db/transaction';
export const roomMusicCatalog = [
  {id:'moonlit',title:'Moonlit Lounge',asset:'audio/room_music/moonlit.m4a',durationMs:60000},
  {id:'aurora',title:'Soft Aurora',asset:'audio/room_music/aurora.m4a',durationMs:60000},
];
export async function partyMusic(identity:MobileIdentity,input:{roomCode:string;action:'state'|'search'|'play'|'pause'|'resume'|'stop';trackId?:string;query?:string}) {
  return withTransaction(async c=>{
    const [members]=await c.query<RowDataPacket[]>(`SELECT r.id,r.host_application_user_id,m.room_role FROM live_rooms r
      JOIN live_room_members m ON m.room_id=r.id AND m.application_user_id=? AND m.left_at IS NULL
      WHERE r.room_code=? AND r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED')`,[identity.userId,input.roomCode]);
    const member=members[0];if(!member)throw new Error('Join the Party room to use music.');
    const edit=member.host_application_user_id===identity.userId || member.room_role==='ADMIN';
    const [prior]=await c.query<RowDataPacket[]>('SELECT *,CURRENT_TIMESTAMP(3) server_now FROM party_room_music WHERE room_id=? FOR UPDATE',[member.id]);
    const old=prior[0];
    if(!['state','search'].includes(input.action)) {
      if(!edit)throw new Error('Only the room owner or Room Admin can change room music.');
      const track=input.action==='play'?roomMusicCatalog.find(t=>t.id===input.trackId):roomMusicCatalog.find(t=>t.id===old?.track_key);
      if(!track && input.action!=='stop')throw new Error('Choose an available room track.');
      const elapsed=old?.playing?Math.max(0,new Date(old.server_now).getTime()-new Date(old.updated_at).getTime()):0;
      const position=input.action==='play'||input.action==='stop'?0:(Number(old?.position_ms??0)+elapsed)%60000;
      await c.execute(`INSERT INTO party_room_music(room_id,track_key,playing,position_ms,updated_by)
        VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE track_key=VALUES(track_key),playing=VALUES(playing),position_ms=VALUES(position_ms),version=version+1,updated_at=CURRENT_TIMESTAMP(3),updated_by=VALUES(updated_by)`,
        [member.id,input.action==='stop'?null:track!.id,['play','resume'].includes(input.action),position,identity.userId]);
    }
    const [rows]=await c.query<RowDataPacket[]>('SELECT *,CURRENT_TIMESTAMP(3) server_now FROM party_room_music WHERE room_id=?',[member.id]);
    const row=rows[0],track=roomMusicCatalog.find(t=>t.id===row?.track_key);
    return {canEdit:edit,catalog:roomMusicCatalog.filter(t=>t.title.toLowerCase().includes((input.query??'').toLowerCase().trim())),
      state:row?{track,playing:Boolean(row.playing),positionMs:Number(row.position_ms),version:Number(row.version),updatedAt:row.updated_at,serverNow:row.server_now}:null};
  });
}
