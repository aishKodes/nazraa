import 'server-only';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {publicApiOrigin} from '@/lib/config/public-api-origin';
export type TableGame='teen_patti'|'teen_patti_pro';
export type TablePlayer={userId:string;displayName:string;avatarUrl:string|null;amount:number};
export type SharedTableActivity={
 gameId:TableGame;roundId:string;roundNumber:number;betVersion:number;rankingVersion:number;serverTimestamp:string;
 winnerScope:'ROUND';winnersRoundId:string;settledAt:string|null;targetTotals:Record<string,number>;
 participants:Record<string,TablePlayer[]>;participantCounts:Record<string,number>;top3:Record<string,TablePlayer[]>;
 roundTopWinners:TablePlayer[];recentBets:Array<TablePlayer&{betId:string;chartId:string;acceptedAt:string;eventSequence:number}>;
};
function player(r:RowDataPacket,amount:number):TablePlayer{return {userId:String(r.public_id),displayName:String(r.full_name||'Player'),
 avatarUrl:r.avatar_updated_at?`${publicApiOrigin()}/api/v1/mobile/avatar/${r.public_id}?v=${new Date(r.avatar_updated_at).getTime()}`:r.avatar_url?String(r.avatar_url):null,amount};}
/** A read-only, consistent transaction over existing accepted bets and settlements.
 * No daily cache, wallet writes, client winners, new ledgers or financial rules. */
export async function sharedTableActivity(c:PoolConnection,game:TableGame,roundId:string,roundNumber:number):Promise<SharedTableActivity>{
 const sides=game==='teen_patti'?['green','blue','red']:['0','1','2','crown'];
 const [rounds]=await c.query<RowDataPacket[]>('SELECT game_name,round_number,outcome_json,drawing_ends_at FROM game_shared_rounds WHERE id=? LIMIT 1',[roundId]);
 const round=rounds[0];if(!round||round.game_name!==game||Number(round.round_number)!==roundNumber)throw Error('Game round changed.');
 const [bets]=await c.query<RowDataPacket[]>(`SELECT b.target_id,u.public_id,u.full_name,u.avatar_url,a.updated_at avatar_updated_at,SUM(b.amount) amount,COUNT(*) accepted_lines
 FROM game_shared_bets b JOIN application_users u ON u.id=b.application_user_id LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
 WHERE b.round_id=? AND b.game_name=? GROUP BY b.target_id,u.id,u.public_id,u.full_name,u.avatar_url,a.updated_at ORDER BY MAX(b.created_at) DESC,u.public_id`,[roundId,game]);
 const totals=Object.fromEntries(sides.map(k=>[k,0])),participants=Object.fromEntries(sides.map(k=>[k,[] as TablePlayer[]])),participantCounts=Object.fromEntries(sides.map(k=>[k,0]));let betVersion=0;
 for(const b of bets){const side=String(b.target_id);if(!(side in totals))continue;betVersion+=Number(b.accepted_lines);totals[side]+=Number(b.amount);participantCounts[side]++;if(participants[side].length<4)participants[side].push(player(b,Number(b.amount)));}
 const [recent]=await c.query<RowDataPacket[]>(`SELECT b.id,b.target_id,b.amount,b.created_at,u.public_id,u.full_name,u.avatar_url,a.updated_at avatar_updated_at
 FROM game_shared_bets b JOIN application_users u ON u.id=b.application_user_id LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
 WHERE b.round_id=? AND b.game_name=? ORDER BY b.created_at DESC,b.id DESC LIMIT 12`,[roundId,game]);
 const [settlements]=await c.query<RowDataPacket[]>(`SELECT s.payout_total,s.settled_at,u.public_id,u.full_name,u.avatar_url,a.updated_at avatar_updated_at
 FROM game_shared_settlements s JOIN application_users u ON u.id=s.application_user_id LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
 WHERE s.round_id=? ORDER BY s.payout_total DESC,u.public_id`,[roundId]);
 const ready=Date.now()>=new Date(round.drawing_ends_at).getTime();
 const winners=ready?settlements.filter(s=>Number(s.payout_total)>0).slice(0,3).map(s=>player(s,Number(s.payout_total))):[];
 const top3=Object.fromEntries(sides.map(k=>[k,[] as TablePlayer[]]));const outcome=typeof round.outcome_json==='string'?JSON.parse(round.outcome_json):round.outcome_json;
 if(game==='teen_patti'&&ready&&sides.includes(outcome?.winner))top3[outcome.winner]=winners;
 const settledAt=ready&&settlements.length?new Date(Math.max(...settlements.map(s=>new Date(s.settled_at).getTime()))).toISOString():null;
 return {gameId:game,roundId,roundNumber,betVersion,rankingVersion:ready?settlements.length:0,serverTimestamp:new Date().toISOString(),winnerScope:'ROUND',winnersRoundId:roundId,settledAt,
 targetTotals:totals,participants,participantCounts,top3,roundTopWinners:winners,
 recentBets:recent.map(b=>({...player(b,Number(b.amount)),betId:String(b.id),chartId:String(b.target_id),acceptedAt:new Date(b.created_at).toISOString(),eventSequence:betVersion}))};
}
