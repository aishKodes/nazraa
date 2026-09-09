import "server-only";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";

export const FACE_LIVE_SCHEDULE_MESSAGE = "Live streaming is available from 8:00 AM to 1:00 AM.";

export type FaceLiveRules = {
  timezone: string;
  startTime: string;
  endTime: string;
  closingNoticeMinutes: number;
  rewardEnabled: boolean;
  /**
   * The amount for every eligible Host.  The legacy gender-specific fields
   * remain in the returned shape while existing remote config rolls forward.
   */
  hourlyRewardDiamonds: number;
  femaleHourlyRewardDiamonds: number;
  maleHourlyRewardDiamonds: number;
  agencyAuthorizationRequired: boolean;
};

export type FaceLiveSchedule = {
  allowed: boolean;
  timezone: string;
  startTime: string;
  endTime: string;
  serverTime: string;
  localTime: string;
  opensAt: string;
  closesAt: string | null;
  lastClosedAt: string | null;
  secondsUntilClose: number | null;
  closingSoon: boolean;
  closingNotice: string | null;
  unavailableMessage: string;
};

export type LiveHourlyRewardEligibilityInput = {
  gender: string | null;
  accountActive: boolean;
  isHost: boolean;
  hostProfileActive: boolean;
  faceVerified: boolean;
  agencyAuthorized: boolean;
  activelyRestricted: boolean;
  validBroadcastSession: boolean;
  roomType: string;
};

export type LiveHourlyRewardEligibility = {
  eligible: boolean;
  diamondsPerHour: number;
  reason: string;
};

const DEFAULT_FACE_LIVE_RULES: FaceLiveRules = Object.freeze({
  timezone: "Asia/Kolkata",
  startTime: "08:00",
  endTime: "01:00",
  closingNoticeMinutes: 15,
  rewardEnabled: true,
  hourlyRewardDiamonds: 3500,
  femaleHourlyRewardDiamonds: 3500,
  maleHourlyRewardDiamonds: 3500,
  agencyAuthorizationRequired: true,
});

type Queryable = Pick<Pool | PoolConnection, "query">;

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validTimezone(value: unknown) {
  if (typeof value !== "string" || value.length > 80) return DEFAULT_FACE_LIVE_RULES.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_FACE_LIVE_RULES.timezone;
  }
}

function validClock(value: unknown, fallback: string) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return fallback;
  return value;
}

function nonNegativeWhole(value: unknown, fallback: number, maximum = 100_000_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : fallback;
}

export function faceLiveRulesFromSetting(value: unknown): FaceLiveRules {
  const setting = asObject(value);
  // Existing production config used a female-only field.  It becomes the
  // all-eligible-Host amount until a Master explicitly changes the new field.
  // This is intentionally server-side; a profile edit can never affect it.
  const hourlyRewardDiamonds = nonNegativeWhole(
    setting.hourlyRewardDiamonds ?? setting.femaleHourlyRewardDiamonds,
    DEFAULT_FACE_LIVE_RULES.hourlyRewardDiamonds,
  );
  return {
    timezone: validTimezone(setting.timezone),
    startTime: validClock(setting.startTime, DEFAULT_FACE_LIVE_RULES.startTime),
    endTime: validClock(setting.endTime, DEFAULT_FACE_LIVE_RULES.endTime),
    closingNoticeMinutes: Math.max(1, Math.min(120, nonNegativeWhole(setting.closingNoticeMinutes, DEFAULT_FACE_LIVE_RULES.closingNoticeMinutes, 120))),
    rewardEnabled: setting.rewardEnabled !== false,
    hourlyRewardDiamonds,
    // Keep the fields in API/admin payloads compatible while one authoritative
    // amount applies to every qualifying Host, regardless of gender.
    femaleHourlyRewardDiamonds: hourlyRewardDiamonds,
    maleHourlyRewardDiamonds: hourlyRewardDiamonds,
    agencyAuthorizationRequired: setting.agencyAuthorizationRequired !== false,
  };
}

export async function loadFaceLiveRules(connection: Queryable = db()): Promise<FaceLiveRules> {
  const [rows] = await connection.query<(RowDataPacket & { setting_value: unknown })[]>(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'mobile.live_rules' LIMIT 1",
  );
  return faceLiveRulesFromSetting(rows[0]?.setting_value);
}

function clockSeconds(clock: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 3600 + minute * 60;
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function addLocalDays(parts: ZonedParts, days: number): ZonedParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function zonedDateTimeToUtc(parts: ZonedParts, timezone: string) {
  const desiredWallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = new Date(desiredWallClock);
  // Two corrections cover normal offsets and DST transitions without relying
  // on the database server having IANA timezone tables installed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(candidate, timezone);
    const observedWallClock = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const correction = desiredWallClock - observedWallClock;
    if (correction === 0) break;
    candidate = new Date(candidate.getTime() + correction);
  }
  return candidate;
}

function boundaryForDay(day: ZonedParts, clock: string, timezone: string) {
  const [hour, minute] = clock.split(":").map(Number);
  return zonedDateTimeToUtc({ ...day, hour, minute, second: 0 }, timezone);
}

function secondsBetween(from: Date, to: Date) {
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 1000));
}

function displayClock(clock: string) {
  const [rawHour, minute] = clock.split(":").map(Number);
  const suffix = rawHour < 12 ? "AM" : "PM";
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function evaluateFaceLiveSchedule(
  rules: FaceLiveRules,
  serverNow: Date = new Date(),
): FaceLiveSchedule {
  const local = zonedParts(serverNow, rules.timezone);
  const localSecond = local.hour * 3600 + local.minute * 60 + local.second;
  const startSecond = clockSeconds(rules.startTime);
  const endSecond = clockSeconds(rules.endTime);
  const crossesMidnight = endSecond < startSecond;
  const allowed = startSecond === endSecond
    ? false
    : crossesMidnight
      ? localSecond >= startSecond || localSecond < endSecond
      : localSecond >= startSecond && localSecond < endSecond;

  let opensAt: Date;
  let closesAt: Date | null = null;
  let lastClosedAt: Date | null = null;
  if (crossesMidnight) {
    if (localSecond >= startSecond) {
      opensAt = boundaryForDay(local, rules.startTime, rules.timezone);
      closesAt = boundaryForDay(addLocalDays(local, 1), rules.endTime, rules.timezone);
      lastClosedAt = boundaryForDay(local, rules.endTime, rules.timezone);
    } else if (localSecond < endSecond) {
      opensAt = boundaryForDay(addLocalDays(local, -1), rules.startTime, rules.timezone);
      closesAt = boundaryForDay(local, rules.endTime, rules.timezone);
      lastClosedAt = boundaryForDay(addLocalDays(local, -1), rules.endTime, rules.timezone);
    } else {
      opensAt = boundaryForDay(local, rules.startTime, rules.timezone);
      lastClosedAt = boundaryForDay(local, rules.endTime, rules.timezone);
    }
  } else if (startSecond !== endSecond) {
    if (localSecond < startSecond) {
      opensAt = boundaryForDay(local, rules.startTime, rules.timezone);
      lastClosedAt = boundaryForDay(addLocalDays(local, -1), rules.endTime, rules.timezone);
    } else if (localSecond < endSecond) {
      opensAt = boundaryForDay(local, rules.startTime, rules.timezone);
      closesAt = boundaryForDay(local, rules.endTime, rules.timezone);
      lastClosedAt = boundaryForDay(addLocalDays(local, -1), rules.endTime, rules.timezone);
    } else {
      opensAt = boundaryForDay(addLocalDays(local, 1), rules.startTime, rules.timezone);
      lastClosedAt = boundaryForDay(local, rules.endTime, rules.timezone);
    }
  } else {
    opensAt = boundaryForDay(addLocalDays(local, 1), rules.startTime, rules.timezone);
    lastClosedAt = boundaryForDay(local, rules.endTime, rules.timezone);
  }

  const secondsUntilClose = allowed && closesAt ? secondsBetween(serverNow, closesAt) : null;
  const closingSoon = secondsUntilClose != null && secondsUntilClose <= rules.closingNoticeMinutes * 60;
  return {
    allowed,
    timezone: rules.timezone,
    startTime: rules.startTime,
    endTime: rules.endTime,
    serverTime: serverNow.toISOString(),
    localTime: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:${String(local.second).padStart(2, "0")}`,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt?.toISOString() ?? null,
    lastClosedAt: lastClosedAt?.toISOString() ?? null,
    secondsUntilClose,
    closingSoon,
    closingNotice: closingSoon ? `Live will end at ${displayClock(rules.endTime)}` : null,
    unavailableMessage: `Live streaming is available from ${displayClock(rules.startTime)} to ${displayClock(rules.endTime)}.`,
  };
}

export function liveHourlyRewardEligibility(
  rules: FaceLiveRules,
  input: LiveHourlyRewardEligibilityInput,
): LiveHourlyRewardEligibility {
  if (!rules.rewardEnabled) return { eligible: false, diamondsPerHour: 0, reason: "REWARD_DISABLED" };
  if (!input.validBroadcastSession || !["FACE", "LIVE"].includes(input.roomType)) return { eligible: false, diamondsPerHour: 0, reason: "INVALID_BROADCAST_SESSION" };
  if (!input.accountActive || !input.isHost || !input.hostProfileActive) return { eligible: false, diamondsPerHour: 0, reason: "HOST_NOT_ELIGIBLE" };
  if (!input.faceVerified) return { eligible: false, diamondsPerHour: 0, reason: "LIVE_PERMISSION_MISSING" };
  if (rules.agencyAuthorizationRequired && !input.agencyAuthorized) return { eligible: false, diamondsPerHour: 0, reason: "AGENCY_AUTHORIZATION_MISSING" };
  if (input.activelyRestricted) return { eligible: false, diamondsPerHour: 0, reason: "LIVE_RESTRICTED" };
  if (rules.hourlyRewardDiamonds <= 0) return { eligible: false, diamondsPerHour: 0, reason: "REWARD_AMOUNT_ZERO" };
  return { eligible: true, diamondsPerHour: rules.hourlyRewardDiamonds, reason: "ELIGIBLE" };
}
