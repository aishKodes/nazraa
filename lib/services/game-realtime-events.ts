import type { PrincessChartActivity } from "@/lib/db/repositories/princess-chart-activity";
import { createClient, type RedisClientType } from "redis";

/** Public shared-round state only. Personal bets, wallet balances and payout
 * details remain on authenticated SQL APIs. */
export type SharedGameRealtimeState = {
  game:
    | "teen_patti"
    | "teen_patti_pro"
    | "luck77"
    | "greedy_lion"
    | "greedy_king"
    | "bounty_football"
    | "lion_vs_tiger";
  princessActivity?: PrincessChartActivity;
  tableActivity?: PrincessChartActivity;
  publicPreview?: Record<string, unknown> & { cards?: number[] };
  round: {
    id: string;
    number: number;
    phase: string;
    lifecycle: string;
    phaseEndsAt: string;
    bettingEndsAt: string;
    resultCommittedAt: string;
    resultVersion: number;
    configVersion?: number;
  };
  outcome: Record<string, unknown> | null;
  winningItemId?: string;
  settlementStatus?: "RESULT_COMMITTED";
};

let publisher: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

async function connectedPublisher(): Promise<RedisClientType | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (publisher?.isReady) return publisher;
  if (!connecting) {
    const client = createClient({ url, socket: { connectTimeout: 1500 } });
    client.on("error", () => undefined);
    connecting = client
      .connect()
      .then(() => {
        publisher = client as RedisClientType;
        return publisher;
      })
      .catch(async () => {
        await client.disconnect().catch(() => undefined);
        throw new Error("Game realtime publish unavailable");
      })
      .finally(() => {
        connecting = undefined;
      });
  }
  return connecting;
}

function tableActivityField(game:SharedGameRealtimeState['game']):'princessActivity'|'tableActivity'|undefined{return game==='teen_patti'?'princessActivity':game==='teen_patti_pro'?'tableActivity':undefined;}
const cacheActivityScript=`
 local old=redis.call('GET',KEYS[1]);local next=cjson.decode(ARGV[1]);
 if old then local prior=cjson.decode(old);
  if prior.roundNumber>next.roundNumber then return 0 end;
  if prior.roundNumber==next.roundNumber then
   if prior.roundId~=next.roundId or prior.betVersion>next.betVersion or prior.rankingVersion>next.rankingVersion then return 0 end;
   if prior.betVersion==next.betVersion and prior.rankingVersion==next.rankingVersion then return 0 end;
  end;
 end;
 redis.call('SET',KEYS[1],ARGV[1],'EX',120);return 1;`;
async function cacheTableActivity(client:RedisClientType,game:string,activity:PrincessChartActivity){return Number(await client.eval(cacheActivityScript,{keys:[`game:activity:${game}`],arguments:[JSON.stringify(activity)]}))===1;}

/** Cache the current public phase in Redis and publish only phase, result, or
 * round transitions. The Flutter countdown derives from phaseEndsAt locally. */
export async function publishSharedGameRealtimeState(
  state: SharedGameRealtimeState,
): Promise<void> {
  try {
    const client = await connectedPublisher();
    if (!client) return;
    const field=tableActivityField(state.game);
    if(field){
      const supplied=state[field];
      if(supplied)await cacheTableActivity(client,state.game,supplied);
      const raw=await client.get(`game:activity:${state.game}`);
      if(raw){const cached=JSON.parse(raw) as PrincessChartActivity;if(cached.roundId===state.round.id&&cached.roundNumber===state.round.number)state={...state,[field]:cached};}
    }
    const serialized = JSON.stringify(state);
    const key = `game:state:${state.game}`;
    if ((await client.get(key)) === serialized) return;
    await client.set(key, serialized, { EX: 120 });
    await client.publish(
      `game:${state.game}`,
      JSON.stringify({
        type: "GAME_CHANGED",
        game: state.game,
        reason: "ROUND",
        state,
        serverNow: Date.now(),
      }),
    );
  } catch {
    // Realtime must not turn a durable settlement into an apparent failure.
  }
}

/** A successful bet includes private state, so send an invalidation only. */
export async function publishSharedGameBetInvalidation(
  game: SharedGameRealtimeState["game"],
  activity?: PrincessChartActivity,
): Promise<void> {
  try {
    const client = await connectedPublisher();
    if (!client) return;
    const field=tableActivityField(game);
    if(field&&activity){
      if(!await cacheTableActivity(client,game,activity))return;
      await client.publish(`game:${game}`,JSON.stringify({type:'GAME_CHANGED',game,reason:'TABLE_ACTIVITY',roundId:activity.roundId,eventSequence:activity.betVersion,state:{game,[field]:activity},serverNow:Date.now()}));
    }else await client.publish(`game:${game}`,JSON.stringify({type:'GAME_CHANGED',game,reason:'BET',serverNow:Date.now()}));
  } catch {
    // Private HTTP reconciliation remains the fallback.
  }
}

/**
 * A shared-round settlement has committed its wallet/ledger rows. This is an
 * invalidation only: the authenticated state endpoint remains the sole source
 * for a player's wager, payout and balance. Unlike public phase state, this
 * event must never be cache-deduplicated; another player's settlement for the
 * same round can be the moment a given player becomes ready too.
 */
export async function publishSharedGameSettlementInvalidation(
  game: SharedGameRealtimeState["game"],
  roundId: string,
): Promise<void> {
  try {
    const client = await connectedPublisher();
    if (!client) return;
    await client.publish(
      `game:${game}`,
      JSON.stringify({
        type: "GAME_CHANGED",
        game,
        reason: "SETTLEMENT",
        roundId,
        serverNow: Date.now(),
      }),
    );
  } catch {
    // The next authenticated reconciliation is safe if a transient Redis
    // failure follows a committed durable settlement.
  }
}
