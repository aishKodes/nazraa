export const configurableGameIds = [
  "luck77",
  "greedy_lion",
  "greedy_king",
  "bounty_football",
  "jungle_hunt",
] as const;

export type ConfigurableGameId = typeof configurableGameIds[number];

export type GameRuntimeConfig = {
  enabled: boolean;
  maintenance: boolean;
  bettingSeconds: number;
  drawingSeconds: number;
  resultSeconds: number;
  minimumBet: number;
  maximumBet: number;
  denominations: number[];
  historyLength: number;
  bigWinThreshold: number;
  repeatBet: boolean;
  autoPlay: boolean;
  outcomeWeights?: number[];
  saladWeight?: number;
  pizzaWeight?: number;
  poolContributionBps?: number;
  poolMinimumForSpecial?: number;
};

export type MobileGamesConfig = {
  target_win_rate: number;
  winnings_deduction_rate: number;
  games: Record<ConfigurableGameId, GameRuntimeConfig>;
};

export const defaultMobileGamesConfig: MobileGamesConfig = {
  target_win_rate: 0.6,
  winnings_deduction_rate: 0.01,
  games: {
    luck77: {
      enabled: true, maintenance: false, bettingSeconds: 10, drawingSeconds: 3,
      resultSeconds: 3, minimumBet: 100, maximumBet: 50_000_000,
      denominations: [100, 500, 1000, 10_000, 50_000], historyLength: 12,
      bigWinThreshold: 1_000_000, repeatBet: true, autoPlay: false,
      outcomeWeights: [1, 4, 4],
    },
    greedy_lion: {
      enabled: true, maintenance: false, bettingSeconds: 20, drawingSeconds: 3,
      resultSeconds: 4, minimumBet: 500, maximumBet: 50_000_000,
      denominations: [500, 1000, 10_000, 50_000], historyLength: 12,
      bigWinThreshold: 1_000_000, repeatBet: true, autoPlay: true,
      // The references do not establish these probabilities or contribution
      // rules, so both special outcomes and pool funding stay disabled until
      // Master publishes verified values.
      saladWeight: 0, pizzaWeight: 0, poolContributionBps: 0,
      poolMinimumForSpecial: 0,
    },
    greedy_king: {
      enabled: true, maintenance: false, bettingSeconds: 30, drawingSeconds: 3,
      resultSeconds: 4, minimumBet: 500, maximumBet: 50_000_000,
      denominations: [500, 1000, 5000, 10_000, 50_000], historyLength: 12,
      bigWinThreshold: 1_000_000, repeatBet: true, autoPlay: false,
      saladWeight: 0, pizzaWeight: 0, poolContributionBps: 0,
      poolMinimumForSpecial: 0,
    },
    bounty_football: {
      enabled: true, maintenance: false, bettingSeconds: 10, drawingSeconds: 4,
      resultSeconds: 4, minimumBet: 500, maximumBet: 50_000_000,
      denominations: [500, 1000, 5000, 50_000, 100_000], historyLength: 12,
      bigWinThreshold: 1_000_000, repeatBet: true, autoPlay: false,
      outcomeWeights: [490000, 196000, 122500, 54444, 14848, 19600, 9800, 11136, 32667, 49000],
    },
    jungle_hunt: {
      enabled: true, maintenance: false, bettingSeconds: 0, drawingSeconds: 0,
      resultSeconds: 0, minimumBet: 150, maximumBet: 3000,
      denominations: [150, 300, 750, 1500, 3000], historyLength: 10,
      bigWinThreshold: 500_000, repeatBet: false, autoPlay: true,
    },
  },
};

function object(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function numberArray(value: unknown, fallback: number[], length?: number) {
  if (!Array.isArray(value) || (length != null && value.length !== length)) return fallback;
  const parsed = value.map(Number);
  return parsed.every((item) => Number.isSafeInteger(item) && item >= 0) ? parsed : fallback;
}

export function mobileGamesConfig(value: unknown): MobileGamesConfig {
  const root = object(value);
  const storedGames = object(root.games);
  const games = Object.fromEntries(configurableGameIds.map((id) => {
    const fallback = defaultMobileGamesConfig.games[id];
    const stored = object(storedGames[id]);
    const outcomeLength = id === "luck77" ? 3 : id === "bounty_football" ? 10 : undefined;
    return [id, {
      ...fallback,
      enabled: typeof stored.enabled === "boolean" ? stored.enabled : fallback.enabled,
      maintenance: typeof stored.maintenance === "boolean" ? stored.maintenance : fallback.maintenance,
      bettingSeconds: integer(stored.bettingSeconds, fallback.bettingSeconds, 0, 300),
      drawingSeconds: integer(stored.drawingSeconds, fallback.drawingSeconds, 0, 60),
      resultSeconds: integer(stored.resultSeconds, fallback.resultSeconds, 0, 60),
      minimumBet: integer(stored.minimumBet, fallback.minimumBet, 1, 50_000_000),
      maximumBet: integer(stored.maximumBet, fallback.maximumBet, 1, 50_000_000),
      denominations: (() => {
        const values = numberArray(stored.denominations, fallback.denominations).filter((item) => item > 0);
        return values.length ? values : fallback.denominations;
      })(),
      historyLength: integer(stored.historyLength, fallback.historyLength, 1, 50),
      bigWinThreshold: integer(stored.bigWinThreshold, fallback.bigWinThreshold, 1, 1_000_000_000),
      repeatBet: typeof stored.repeatBet === "boolean" ? stored.repeatBet : fallback.repeatBet,
      autoPlay: typeof stored.autoPlay === "boolean" ? stored.autoPlay : fallback.autoPlay,
      outcomeWeights: outcomeLength == null
        ? fallback.outcomeWeights
        : numberArray(stored.outcomeWeights, fallback.outcomeWeights ?? [], outcomeLength),
      saladWeight: integer(stored.saladWeight, fallback.saladWeight ?? 0, 0, 1_000_000),
      pizzaWeight: integer(stored.pizzaWeight, fallback.pizzaWeight ?? 0, 0, 1_000_000),
      poolContributionBps: integer(stored.poolContributionBps, fallback.poolContributionBps ?? 0, 0, 10_000),
      poolMinimumForSpecial: integer(stored.poolMinimumForSpecial, fallback.poolMinimumForSpecial ?? 0, 0, 1_000_000_000),
    } satisfies GameRuntimeConfig];
  })) as Record<ConfigurableGameId, GameRuntimeConfig>;
  const targetWinRate = root.target_win_rate ?? root.targetWinRate;
  const deductionRate = root.winnings_deduction_rate ?? root.winningsDeductionRate;
  return {
    target_win_rate: Number.isFinite(Number(targetWinRate))
      ? Math.max(0, Math.min(1, Number(targetWinRate)))
      : defaultMobileGamesConfig.target_win_rate,
    winnings_deduction_rate: Number.isFinite(Number(deductionRate))
      ? Math.max(0, Math.min(1, Number(deductionRate)))
      : defaultMobileGamesConfig.winnings_deduction_rate,
    games,
  };
}
