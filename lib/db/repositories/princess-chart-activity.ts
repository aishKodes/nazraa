import "server-only";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { publicApiOrigin } from "@/lib/config/public-api-origin";
import {
  loadFaceLiveRules,
  businessDateFor,
} from "@/lib/services/live-business-policy";

export type PrincessChartPlayer = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  amount: number;
};
export type PrincessChartActivity = {
  roundId: string;
  roundNumber: number;
  betVersion: number;
  rankingVersion: number;
  businessDate: string;
  serverTimestamp: string;
  targetTotals: Record<string, number>;
  participants: Record<string, PrincessChartPlayer[]>;
  top3: Record<string, PrincessChartPlayer[]>;
};
const chairs = ["green", "blue", "red"] as const;
let rankingCache:
  | {
      date: string;
      expires: number;
      version: number;
      top3: PrincessChartActivity["top3"];
    }
  | undefined;
export function invalidatePrincessChartRanking() {
  rankingCache = undefined;
}
function avatar(row: RowDataPacket) {
  return row.avatar_updated_at
    ? `${publicApiOrigin()}/api/v1/mobile/avatar/${row.public_id}?v=${new Date(row.avatar_updated_at as Date).getTime()}`
    : row.avatar_url
      ? String(row.avatar_url)
      : null;
}
function player(row: RowDataPacket, amount: number): PrincessChartPlayer {
  return {
    userId: String(row.public_id),
    displayName: String(row.full_name || "Player"),
    avatarUrl: avatar(row),
    amount,
  };
}
/** Presentation projection over existing accepted bets and immutable daily
 * contributions. Never writes a wallet, result, payout or ranking amount. */
export async function princessChartActivity(
  c: PoolConnection,
  roundId: string,
  roundNumber: number,
): Promise<PrincessChartActivity> {
  const { timezone } = await loadFaceLiveRules(c),
    date = businessDateFor(timezone, new Date());
  const [bets] = await c.query<RowDataPacket[]>(
    `SELECT b.target_id,u.public_id,u.full_name,u.avatar_url,a.updated_at avatar_updated_at,SUM(b.amount) amount,COUNT(*) accepted_commands
 FROM game_shared_bets b JOIN application_users u ON u.id=b.application_user_id LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
 WHERE b.round_id=? AND b.game_name='teen_patti' GROUP BY b.target_id,u.id,u.public_id,u.full_name,u.avatar_url,a.updated_at ORDER BY MIN(b.created_at),u.public_id`,
    [roundId],
  );
  const totals = Object.fromEntries(chairs.map((k) => [k, 0])),
    participants = Object.fromEntries(
      chairs.map((k) => [k, [] as PrincessChartPlayer[]]),
    );
  let version = 0;
  for (const r of bets) {
    const k = String(r.target_id);
    if (!(k in totals)) continue;
    version += Number(r.accepted_commands);
    totals[k] += Number(r.amount);
    if (participants[k].length < 3)
      participants[k].push(player(r, Number(r.amount)));
  }
  if (
    !rankingCache ||
    rankingCache.date !== date ||
    rankingCache.expires < Date.now()
  ) {
    // Indexed business-day contributions avoid touching raw historical bets.
    // A payout has one winning chair. The actual net credited payout is used,
    // never wallet balance, wager, total across all chairs or gross coefficient.
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT JSON_UNQUOTE(JSON_EXTRACT(r.outcome_json,'$.winner')) chair,u.public_id,u.full_name,u.avatar_url,a.updated_at avatar_updated_at,SUM(d.payout_total) amount,COUNT(*) winning_rounds
 FROM game_daily_winner_contributions d JOIN game_round_results r ON r.id=d.result_record_id JOIN application_users u ON u.id=d.application_user_id LEFT JOIN application_user_avatars a ON a.application_user_id=u.id
 WHERE d.game_name='teen_patti' AND d.business_date=? AND d.payout_total>0
 GROUP BY chair,u.id,u.public_id,u.full_name,u.avatar_url,a.updated_at ORDER BY amount DESC,u.public_id`,
      [date],
    );
    const top3 = Object.fromEntries(
      chairs.map((k) => [k, [] as PrincessChartPlayer[]]),
    );
    let rankingVersion = 0;
    for (const r of rows) {
      rankingVersion += Number(r.winning_rounds);
      const k = String(r.chair);
      if (k in top3 && top3[k].length < 3)
        top3[k].push(player(r, Number(r.amount)));
    }
    rankingCache = {
      date,
      expires: Date.now() + 5000,
      version: rankingVersion,
      top3,
    };
  }
  return {
    roundId,
    roundNumber,
    betVersion: version,
    rankingVersion: rankingCache.version,
    businessDate: date,
    serverTimestamp: new Date().toISOString(),
    targetTotals: totals,
    participants,
    top3: rankingCache.top3,
  };
}
