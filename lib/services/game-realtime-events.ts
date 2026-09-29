import { createClient, type RedisClientType } from "redis";

/** Public shared-round state only. Personal bets, wallet balances and payout
 * details remain on authenticated SQL APIs. */
export type SharedGameRealtimeState = {
  game: "teen_patti_pro" | "luck77" | "greedy_lion" | "greedy_king" | "bounty_football";
  round: {
    id: string;
    number: number;
    phase: string;
    lifecycle: string;
    phaseEndsAt: string;
    bettingEndsAt: string;
    resultCommittedAt: string;
    resultVersion: number;
  };
  outcome: Record<string, unknown> | null;
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
    connecting = client.connect().then(() => {
      publisher = client as RedisClientType;
      return publisher;
    }).catch(async () => {
      await client.disconnect().catch(() => undefined);
      throw new Error("Game realtime publish unavailable");
    }).finally(() => { connecting = undefined; });
  }
  return connecting;
}

/** Cache the current public phase in Redis and publish only phase, result, or
 * round transitions. The Flutter countdown derives from phaseEndsAt locally. */
export async function publishSharedGameRealtimeState(state: SharedGameRealtimeState): Promise<void> {
  try {
    const client = await connectedPublisher();
    if (!client) return;
    const serialized = JSON.stringify(state);
    const key = `game:state:${state.game}`;
    if (await client.get(key) === serialized) return;
    await client.set(key, serialized, { EX: 120 });
    await client.publish(
      `game:${state.game}`,
      JSON.stringify({ type: "GAME_CHANGED", game: state.game, reason: "ROUND", state, serverNow: Date.now() }),
    );
  } catch {
    // Realtime must not turn a durable settlement into an apparent failure.
  }
}

/** A successful bet includes private state, so send an invalidation only. */
export async function publishSharedGameBetInvalidation(game: SharedGameRealtimeState["game"]): Promise<void> {
  try {
    const client = await connectedPublisher();
    if (!client) return;
    await client.publish(
      `game:${game}`,
      JSON.stringify({ type: "GAME_CHANGED", game, reason: "BET", serverNow: Date.now() }),
    );
  } catch {
    // Private HTTP reconciliation remains the fallback.
  }
}
