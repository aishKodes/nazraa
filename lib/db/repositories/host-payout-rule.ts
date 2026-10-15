import 'server-only';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '@/lib/db/pool';

export type HostPayoutRule = { slabDiamonds:number; totalUsd:string; hostUsd:string; agencyUsd:string; companyUsd:string };
// Only the legacy compatibility reader knows the old minor-unit property names.
// New canonical configuration and immutable snapshots store decimal USD strings.
export function decimalUsd(value:unknown):string {
  const s=String(value).trim();
  if(!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Use decimal USD with at most two decimal places.');
  const [whole,fraction='']=s.split('.');
  const n=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(n>999999999999999999n) throw new Error('USD amount exceeds the supported range.');
  return `${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
const units=(s:string)=>BigInt(s.replace('.',''));
const text=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
export function multiplyPayoutUsd(value:string,blocks:number):string {
  if(!Number.isSafeInteger(blocks)||blocks<0) throw new Error('Choose a valid payout amount.');
  return decimalUsd(text(units(decimalUsd(value))*BigInt(blocks)));
}
export function payoutRuleFromConfig(value:unknown):HostPayoutRule {
  const source=(typeof value==='string'?JSON.parse(value):value) as Record<string,unknown>|null;
  const legacy=(key:string,fallback:string)=>source?.[key]===undefined?fallback:(Number(source[key])/100).toFixed(2);
  const slabDiamonds=Number(source?.diamondsPerBlock??source?.slabDiamonds??125000);
  if(!Number.isSafeInteger(slabDiamonds)||slabDiamonds<1) throw new Error('Choose a valid Diamond block.');
  const totalUsd=decimalUsd(source?.totalUsdPerBlock??legacy('totalUsdCents','11.70'));
  const hostUsd=decimalUsd(source?.hostUsdPerBlock??legacy('hostUsdCents','10.00'));
  const agencyUsd=decimalUsd(source?.agencyUsdPerBlock??legacy('agencyUsdCents','1.10'));
  const remainder=units(totalUsd)-units(hostUsd)-units(agencyUsd);
  if(remainder<0n) throw new Error('Total USD must cover Host payout and Agency commission.');
  return {slabDiamonds,totalUsd,hostUsd,agencyUsd,companyUsd:text(remainder)};
}
export async function loadHostPayoutRule(connection?:PoolConnection) {
  const [rows]=await (connection??db()).query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='withdrawal.economy' LIMIT 1");
  return payoutRuleFromConfig(rows[0]?.setting_value??null);
}
