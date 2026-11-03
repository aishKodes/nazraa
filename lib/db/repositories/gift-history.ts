import 'server-only';
import type {RowDataPacket} from 'mysql2/promise';
import type {MobileIdentity} from '@/lib/auth/mobile-session';
import {db} from '@/lib/db/pool';
import {publicApiOrigin} from '@/lib/config/public-api-origin';
import {rankingPeriod} from '@/lib/policy/ranking-period';

/** Read-only history. Room activity cursors and Clear Chat never alter this ledger. */
export async function giftHistory(identity:MobileIdentity,input:{scope:'received'|'sent'|'room';period:'all'|'monthly';roomCode?:string;before?:string},now=new Date()){
 const filters:string[]=[],values:unknown[]=[];
 if(input.scope==='room'){
  const [rooms]=await db().query<RowDataPacket[]>(`SELECT room.id FROM live_rooms room WHERE room.room_code=? AND
    (room.host_application_user_id=? OR EXISTS(SELECT 1 FROM live_room_members m WHERE m.room_id=room.id AND m.application_user_id=? AND m.left_at IS NULL)) LIMIT 1`,[input.roomCode??'',identity.userId,identity.userId]);
  if(!rooms[0])throw Error('Join the room before viewing its gift records.');
  filters.push('e.room_id=?');values.push(rooms[0].id);
 }else {filters.push(input.scope==='sent'?'e.sender_application_user_id=?':'e.receiver_application_user_id=?');values.push(identity.userId);}
 const period=rankingPeriod('monthly',now);
 if(input.period==='monthly'){filters.push('e.created_at>=? AND e.created_at<?');values.push(period.start,period.end);}
 if(input.before){
  let cursor:{at:string;id:string};try{cursor=JSON.parse(Buffer.from(input.before,'base64url').toString('utf8'));}catch{throw Error('Refresh the gift records to continue.');}
  const at=new Date(cursor.at);if(!Number.isFinite(at.getTime())||!/^[-a-zA-Z0-9]{1,80}$/.test(cursor.id))throw Error('Refresh the gift records to continue.');
  filters.push('(e.created_at<? OR (e.created_at=? AND e.id<?))');values.push(at,at,cursor.id);
 }
 const [rows]=await db().query<RowDataPacket[]>(`SELECT e.*,g.gift_key,g.name gift_name,g.emoji,g.visual_url,g.animation_key,g.asset_config,
  sender.public_id sender_id,sender.full_name sender_name,CASE WHEN sa.updated_at IS NOT NULL THEN CONCAT('${publicApiOrigin()}/api/v1/mobile/avatar/',sender.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(sa.updated_at)*1000)) ELSE sender.avatar_url END sender_avatar,
  receiver.public_id receiver_id,receiver.full_name receiver_name,CASE WHEN ra.updated_at IS NOT NULL THEN CONCAT('${publicApiOrigin()}/api/v1/mobile/avatar/',receiver.public_id,'?v=',FLOOR(UNIX_TIMESTAMP(ra.updated_at)*1000)) ELSE receiver.avatar_url END receiver_avatar,
  lucky.won,lucky.tier_id,lucky.multiplier_bps,lucky.reward_coins,lucky.company_allocation
  FROM live_room_gift_events e INNER JOIN gift_catalog g ON g.id=e.gift_catalog_id
  INNER JOIN application_users sender ON sender.id=e.sender_application_user_id
  INNER JOIN application_users receiver ON receiver.id=e.receiver_application_user_id
  LEFT JOIN application_user_avatars sa ON sa.application_user_id=sender.id
  LEFT JOIN application_user_avatars ra ON ra.application_user_id=receiver.id
  LEFT JOIN lucky_gift_results lucky ON lucky.gift_event_id=e.id
  WHERE ${filters.join(' AND ')} ORDER BY e.created_at DESC,e.id DESC LIMIT 21`,values);
 const [totals]=await db().query<RowDataPacket[]>(`SELECT
   COALESCE(SUM(CASE WHEN sender_application_user_id=? THEN coin_value ELSE 0 END),0) sentCoins,
   COALESCE(SUM(CASE WHEN receiver_application_user_id=? THEN coin_value ELSE 0 END),0) receivedCoins,
   COALESCE(SUM(CASE WHEN receiver_application_user_id=? THEN diamond_value ELSE 0 END),0) receivedDiamonds
   FROM live_room_gift_events WHERE created_at>=? AND created_at<? AND (sender_application_user_id=? OR receiver_application_user_id=?)`,
   [identity.userId,identity.userId,identity.userId,period.start,period.end,identity.userId,identity.userId]);
 const page=rows.slice(0,20),last=page.at(-1);
 function config(v:unknown){if(typeof v==='string'){try{return JSON.parse(v);}catch{return {};}}return v??{};}
 return {records:page.map(r=>({id:String(r.id),quantity:Number(r.quantity),value:Number(r.coin_value),diamondValue:Number(r.diamond_value),createdAt:r.created_at,status:'COMPLETED',
  giftEconomyType:r.gift_economy_type,companyAllocation:Number(r.company_allocation??r.platform_fee??0),
  gift:{id:r.gift_key,name:r.gift_name,symbol:r.emoji??'🎁',imageUrl:r.visual_url,animationKey:r.animation_key,economyType:r.gift_economy_type,effectConfig:config(r.asset_config)},
  sender:{id:String(r.sender_id),name:r.sender_name,avatarUrl:r.sender_avatar},receiver:{id:String(r.receiver_id),name:r.receiver_name,avatarUrl:r.receiver_avatar},
  ...(r.gift_economy_type==='LUCKY'?{lucky:{won:Boolean(r.won),tierId:r.tier_id,multiplierBps:Number(r.multiplier_bps??0),payoutCoins:Number(r.reward_coins??0)}}:{})})),
  next:rows.length>20&&last?Buffer.from(JSON.stringify({at:new Date(last.created_at).toISOString(),id:String(last.id)})).toString('base64url'):null,
  monthly:{businessMonth:period.businessMonth,timezone:'Asia/Kolkata',startsAt:period.start,endsAt:period.end,sentCoins:Number(totals[0].sentCoins),receivedCoins:Number(totals[0].receivedCoins),receivedDiamonds:Number(totals[0].receivedDiamonds)}};
}
