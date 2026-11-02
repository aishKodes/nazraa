import 'server-only';
import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';
import {db} from '@/lib/db/pool';

/** Explicit rollout fence. Staging activation never changes production. */
export async function ownerPartyPkUpdateActive(connection: Pool|PoolConnection=db()) {
  const [rows]=await connection.query<RowDataPacket[]>("SELECT setting_value,CURRENT_TIMESTAMP(3) server_now FROM system_settings WHERE setting_key='mobile.owner_party_pk_update'");
  const value=typeof rows[0]?.setting_value==='string'?JSON.parse(rows[0].setting_value):rows[0]?.setting_value;
  if(!value?.activatedAt)return false;
  const at=new Date(value.activatedAt);
  if(!Number.isFinite(at.getTime()))throw new Error('Reward configuration is unavailable.');
  return new Date(rows[0].server_now)>=at;
}

export function randomPkSettlement(prior:number,mode:string,result:'WIN'|'LOSS'|'DRAW',receivedCoins:number){
  const current=Math.max(0,Math.min(2,Math.floor(prior)));
  // Existing 5,000 gross gifting requirement and loss/draw behavior remain.
  if(mode.trim().toLowerCase()!=='random')return {wins:current,qualifying:false,completed:false};
  if(result==='LOSS')return {wins:0,qualifying:false,completed:false};
  if(result!=='WIN'||receivedCoins<5000)return {wins:current,qualifying:false,completed:false};
  return {wins:(current+1)%3,qualifying:true,completed:current===2};
}
