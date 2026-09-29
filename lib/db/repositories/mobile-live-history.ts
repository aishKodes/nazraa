import "server-only";

import type { RowDataPacket } from "mysql2/promise";

import type { MobileIdentity } from "@/lib/auth/mobile-session";
import { db } from "@/lib/db/pool";
import { loadFaceLiveRules } from "@/lib/services/live-business-policy";

const pageSize = 30;

type DateRow = RowDataPacket & { business_date: string | Date };
type SecondsRow = RowDataPacket & {
  business_date: string | Date;
  eligible_video_seconds: number | string | null;
};
type CoinsRow = RowDataPacket & {
  business_date: string | Date;
  coins: number | string | null;
};

function isoDate(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asNonNegativeInteger(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function beforeDate(value: string | undefined) {
  if (value == null || value.length === 0) return "9999-12-31";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("The history cursor is invalid.");
  }
  return value;
}

/**
 * Returns only the authenticated member's own ledger-derived history.  It is
 * deliberately a read model over the canonical live-session and completed
 * gift-event ledgers: no client duration, wallet-balance proxy, or UI effect
 * event can influence these figures.
 */
export async function mobileLiveHistory(
  identity: MobileIdentity,
  input: { before?: string } = {},
) {
  const rules = await loadFaceLiveRules();
  const [thresholdRows] = await db().query<
    (RowDataPacket & { minimum_eligible_seconds: number })[]
  >(
    `SELECT minimum_eligible_seconds
       FROM host_reward_rules
      WHERE room_type IN ('FACE', 'LIVE') AND enabled = TRUE
      ORDER BY effective_from DESC
      LIMIT 1`,
  );
  // Valid Day uses the same configured qualifying-duration rule as Host Live
  // rewards. One business date is counted at most once even if it contains
  // several durable publishing sessions.
  const validDayThreshold = Math.max(
    60,
    Number(thresholdRows[0]?.minimum_eligible_seconds ?? 3600),
  );
  const before = beforeDate(input.before);

  const [summaryLive, summarySent, summaryReceived, dateRows] =
    await Promise.all([
      db().query<
        (RowDataPacket & { video_seconds: number | string | null; valid_days: number | string | null })[]
      >(
        `SELECT COALESCE(SUM(day_rows.eligible_video_seconds), 0) video_seconds,
                COALESCE(SUM(day_rows.eligible_video_seconds >= ?), 0) valid_days
           FROM (
             SELECT business_date,
                    SUM(GREATEST(COALESCE(eligible_seconds_committed, 0), COALESCE(valid_media_seconds, 0))) eligible_video_seconds
               FROM live_session_accounting
              WHERE host_application_user_id = ?
                AND room_type IN ('FACE', 'LIVE')
                AND status <> 'VOID'
              GROUP BY business_date
           ) day_rows`,
        [validDayThreshold, identity.userId],
      ),
      db().query<(RowDataPacket & { coins: number | string | null })[]>(
        `SELECT COALESCE(SUM(coin_value), 0) coins
           FROM live_room_gift_events
          WHERE sender_application_user_id = ?`,
        [identity.userId],
      ),
      db().query<(RowDataPacket & { coins: number | string | null })[]>(
        `SELECT COALESCE(SUM(coin_value), 0) coins
           FROM live_room_gift_events
          WHERE receiver_application_user_id = ?`,
        [identity.userId],
      ),
      db().query<DateRow[]>(
        `SELECT business_date
           FROM (
             SELECT business_date
               FROM live_session_accounting
              WHERE host_application_user_id = ?
                AND room_type IN ('FACE', 'LIVE')
                AND status <> 'VOID'
                AND business_date < ?
             UNION
             SELECT business_date
               FROM live_room_gift_events
              WHERE sender_application_user_id = ? AND business_date < ?
             UNION
             SELECT business_date
               FROM live_room_gift_events
              WHERE receiver_application_user_id = ? AND business_date < ?
           ) activity_dates
          GROUP BY business_date
          ORDER BY business_date DESC
          LIMIT ?`,
        [
          identity.userId,
          before,
          identity.userId,
          before,
          identity.userId,
          before,
          pageSize + 1,
        ],
      ),
    ]);

  const allDates = dateRows[0].map((row) => isoDate(row.business_date));
  const pageDates = allDates.slice(0, pageSize);
  const placeholders = pageDates.map(() => "?").join(",");
  const [liveRows, sentRows, receivedRows] = pageDates.length === 0
    ? [[], [], []]
    : await Promise.all([
        db().query<SecondsRow[]>(
          `SELECT business_date,
                  SUM(GREATEST(COALESCE(eligible_seconds_committed, 0), COALESCE(valid_media_seconds, 0))) eligible_video_seconds
             FROM live_session_accounting
            WHERE host_application_user_id = ?
              AND room_type IN ('FACE', 'LIVE')
              AND status <> 'VOID'
              AND business_date IN (${placeholders})
            GROUP BY business_date`,
          [identity.userId, ...pageDates],
        ),
        db().query<CoinsRow[]>(
          `SELECT business_date, SUM(coin_value) coins
             FROM live_room_gift_events
            WHERE sender_application_user_id = ?
              AND business_date IN (${placeholders})
            GROUP BY business_date`,
          [identity.userId, ...pageDates],
        ),
        db().query<CoinsRow[]>(
          `SELECT business_date, SUM(coin_value) coins
             FROM live_room_gift_events
            WHERE receiver_application_user_id = ?
              AND business_date IN (${placeholders})
            GROUP BY business_date`,
          [identity.userId, ...pageDates],
        ),
      ]);

  const byDate = <T extends { business_date: string | Date }>(
    rows: T[],
    read: (row: T) => number,
  ) => new Map(rows.map((row) => [isoDate(row.business_date), read(row)]));
  const videoByDate = byDate(liveRows[0], (row) =>
    asNonNegativeInteger(row.eligible_video_seconds),
  );
  const sentByDate = byDate(sentRows[0], (row) => asNonNegativeInteger(row.coins));
  const receivedByDate = byDate(receivedRows[0], (row) =>
    asNonNegativeInteger(row.coins),
  );

  return {
    timezone: rules.timezone,
    summary: {
      videoSeconds: asNonNegativeInteger(summaryLive[0][0]?.video_seconds),
      validDays: asNonNegativeInteger(summaryLive[0][0]?.valid_days),
      sendingCoins: asNonNegativeInteger(summarySent[0][0]?.coins),
      receivedCoins: asNonNegativeInteger(summaryReceived[0][0]?.coins),
    },
    days: pageDates.map((date) => {
      const eligibleVideoSeconds = videoByDate.get(date) ?? 0;
      return {
        date,
        eligibleVideoSeconds,
        validDay: eligibleVideoSeconds >= validDayThreshold,
        sendingCoins: sentByDate.get(date) ?? 0,
        receivedCoins: receivedByDate.get(date) ?? 0,
      };
    }),
    nextBefore:
      allDates.length > pageSize ? pageDates[pageDates.length - 1] ?? null : null,
  };
}
