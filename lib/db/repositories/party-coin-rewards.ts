import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { MobileIdentity } from '@/lib/auth/mobile-session';
import { withIdempotentTransaction } from '@/lib/db/transaction';
import { businessDateFor } from '@/lib/services/live-business-policy';
import { splitPartyBoardInterval } from '@/lib/services/party-board-time';
import { partyRewardState, pickPartyReward, rewardWeights } from '@/lib/policy/party-coin-reward';

function utc(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'));
}
async function context(connection: PoolConnection, userId: string) {
  // One durable per-user mutex serializes every device, day and room.
  // INSERT IGNORE on an existing row takes shared duplicate-key locks; twelve
  // claimers then upgrading them to FOR UPDATE can deadlock each other.
  // The no-op upsert obtains the exclusive mutex directly, including first use.
  await connection.execute('INSERT INTO party_reward_clocks(application_user_id) VALUES (?) ON DUPLICATE KEY UPDATE application_user_id=VALUES(application_user_id)', [userId]);
  const [clocks] = await connection.query<RowDataPacket[]>('SELECT *,CURRENT_TIMESTAMP(3) now FROM party_reward_clocks WHERE application_user_id=? FOR UPDATE', [userId]);
  const [settings] = await connection.query<RowDataPacket[]>("SELECT setting_value FROM system_settings WHERE setting_key='mobile.party_coin_rewards'");
  const raw = settings[0]?.setting_value;
  const config = typeof raw === 'string' || Buffer.isBuffer(raw) ? JSON.parse(String(raw)) : raw ?? {};
  const timezone = config.timezone ?? 'Asia/Kolkata';
  const now = utc(clocks[0].now), day = businessDateFor(timezone, now);
  await connection.execute('INSERT IGNORE INTO party_reward_days(application_user_id,reward_day,business_timezone) VALUES (?,?,?)', [userId, day, timezone]);
  return {clock:clocks[0], config, timezone, now, day};
}
async function snapshot(connection: PoolConnection, userId: string, ctx: Awaited<ReturnType<typeof context>>) {
  const [days] = await connection.query<RowDataPacket[]>('SELECT eligible_milliseconds FROM party_reward_days WHERE application_user_id=? AND reward_day=?', [userId,ctx.day]);
  const [claims] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) count FROM party_reward_claims WHERE application_user_id=? AND reward_day=?', [userId,ctx.day]);
  return {enabled:ctx.config.enabled === true, rewardDay:ctx.day, timezone:ctx.timezone,
    serverNow:ctx.now.toISOString(), ...partyRewardState(Number(days[0].eligible_milliseconds),Number(claims[0].count))};
}

/** Presence checkpoint only; never accepts phone elapsed time. A missing or
 * offline checkpoint >30s earns ZERO gap time. Previous earned time survives.
 * This is independent of Host-only paid Live-hour economics. */
export async function partyCoinReward(identity: MobileIdentity, input: {
  action:'state'|'heartbeat'|'suspend'|'claim'; roomCode?:string; intervalIndex?:number; requestId?:string;
}) {
  return withIdempotentTransaction(async connection => {
    const ctx = await context(connection, identity.userId);
    if (input.action === 'heartbeat' || input.action === 'suspend') {
      const [members] = input.roomCode ? await connection.query<RowDataPacket[]>(
        `SELECT r.id,(SELECT e.occurred_at FROM livekit_media_events e WHERE e.room_id=r.id AND e.application_user_id=u.id
           AND e.event_type IN ('participant_joined','participant_left') ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 1) evidence_at
         FROM live_rooms r JOIN live_room_members m ON m.room_id=r.id
         JOIN application_users u ON u.id=m.application_user_id
         WHERE r.room_code=? AND r.room_type='PARTY' AND r.status IN ('ACTIVE','LOCKED')
           AND m.application_user_id=? AND m.left_at IS NULL AND u.account_status='ACTIVE'
           AND NOT EXISTS(SELECT 1 FROM live_room_blocks b WHERE b.room_id=r.id AND b.application_user_id=u.id AND b.active=TRUE)
           AND COALESCE((SELECT e.event_type FROM livekit_media_events e WHERE e.room_id=r.id AND e.application_user_id=u.id
             AND e.event_type IN ('participant_joined','participant_left') ORDER BY e.occurred_at DESC,e.received_at DESC LIMIT 1),'participant_joined')='participant_joined'`,
        [input.roomCode,identity.userId]) : [[]];
      const roomId = members[0]?.id;
      const last = ctx.clock.last_checkpoint_at ? utc(ctx.clock.last_checkpoint_at) : null;
      const gap = last ? ctx.now.getTime() - last.getTime() : 0;
      // Same member in same room at both endpoints; no overlap across devices.
      if (ctx.config.enabled === true && roomId && roomId === ctx.clock.room_id && last && gap > 0 && gap <= 30_000) {
        // A signed rejoin inside this heartbeat interval starts a new segment;
        // never credit the preceding disconnected portion of the gap.
        const evidence=members[0]?.evidence_at?utc(members[0].evidence_at):null;
        const start=evidence&&evidence>last?evidence:last;
        for (const part of splitPartyBoardInterval(start, ctx.now, ctx.timezone)) {
          await connection.execute(`INSERT INTO party_reward_days(application_user_id,reward_day,business_timezone,eligible_milliseconds)
            VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE eligible_milliseconds=LEAST(1500000,eligible_milliseconds+VALUES(eligible_milliseconds))`,
          [identity.userId,part.date,ctx.timezone,Math.min(1500000,part.milliseconds)]);
        }
      }
      await connection.execute('UPDATE party_reward_clocks SET room_id=?,last_checkpoint_at=? WHERE application_user_id=?',
        [input.action==='suspend'?null:roomId??null,ctx.now,identity.userId]);
    }
    if (input.action !== 'claim') return snapshot(connection, identity.userId, ctx);
    const [prior] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM party_reward_claims WHERE application_user_id=? AND (request_id=? OR (reward_day=? AND interval_index=?)) LIMIT 1`,
      [identity.userId,input.requestId??null,ctx.day,input.intervalIndex??null]);
    if (prior[0]) {
      const [wallets]=await connection.query<RowDataPacket[]>("SELECT available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'",[identity.userId]);
      return {...await snapshot(connection,identity.userId,ctx),alreadyClaimed:true,amount:Number(prior[0].amount),resultingBalance:Number(wallets[0]?.available_balance??0),transactionId:prior[0].ledger_transaction_id};
    }
    const state = await snapshot(connection, identity.userId, ctx);
    if (!state.enabled || !state.ready || input.intervalIndex !== state.intervalIndex) {
      return {...state, claimed:false, message:state.claimsCompleted>=5?'All five rewards are complete today.':'Your next reward is not ready yet.'};
    }
    const amount = pickPartyReward(rewardWeights(ctx.config.weights)), ledgerId=randomUUID();
    await connection.execute("INSERT IGNORE INTO wallet_balances(id,owner_type,owner_id,asset_type) VALUES (?,'APPLICATION_USER',?,'COIN')",[randomUUID(),identity.userId]);
    const [wallets]=await connection.query<RowDataPacket[]>("SELECT id,available_balance FROM wallet_balances WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN' FOR UPDATE",[identity.userId]);
    const balance=Number(wallets[0].available_balance)+amount;
    await connection.execute('UPDATE wallet_balances SET available_balance=? WHERE id=?',[balance,wallets[0].id]);
    await connection.execute(`INSERT INTO ledger_transactions(id,transaction_code,idempotency_key,asset_type,transaction_type,source_type,destination_type,destination_id,amount,status,reason)
      VALUES (?,?,?,'COIN','PARTY_DAILY_REWARD','SYSTEM','APPLICATION_USER',?,?,'COMPLETED','Eligible Party Board time reward')`,
      [ledgerId,`PARTY-${ledgerId}`,`party-reward:${identity.userId}:${ctx.day}:${input.intervalIndex}`,identity.userId,amount]);
    await connection.execute(`INSERT INTO party_reward_claims(id,application_user_id,reward_day,interval_index,request_id,amount,ledger_transaction_id,balance_after)
      VALUES (?,?,?,?,?,?,?,?)`,[randomUUID(),identity.userId,ctx.day,input.intervalIndex!,input.requestId!,amount,ledgerId,balance]);
    return {...await snapshot(connection,identity.userId,ctx),claimed:true,amount,resultingBalance:balance,transactionId:ledgerId};
  });
}
