import type { ConfigurableGameId, GameEconomyMode, GameEconomyPreset, GameRuntimeConfig } from "./game-config";
import { calculateTargetConfiguration, targetRtpPolicy } from "./target-rtp";

export const economyModeLabels: Record<GameEconomyMode, string> = {
  NORMAL: "Normal",
  HIGH_PAYOUT: "High payout / promotional",
  CUSTOM: "Custom",
};

export function captureEconomyPreset(config: GameRuntimeConfig): GameEconomyPreset {
  return {
    targetRtp: config.targetRtp,
    payoutScalePpm: config.payoutScalePpm,
    maximumPayoutMultiplier: config.maximumPayoutMultiplier,
    maximumBet: config.maximumBet,
    princessPayoutProfile: config.princessPayoutProfile,
    princessServiceFeeBps: config.princessServiceFeeBps,
    princessPreviewQuotes: config.princessPreviewQuotes,
    outcomeWeights: config.outcomeWeights,
  };
}

export function savedEconomyPreset(config: GameRuntimeConfig, mode: GameEconomyMode) {
  if ((config.economyMode ?? "NORMAL") === mode) return captureEconomyPreset(config);
  return config.economyPresets?.[mode];
}

export function economyModePreview(
  game: ConfigurableGameId, current: GameRuntimeConfig, mode: GameEconomyMode,
  targetRtp: number, maximumBet: number, maximumPayoutMultiplier: number,
) {
  const saved = savedEconomyPreset(current, mode);
  const policy = targetRtpPolicy(game, current, mode);
  const base = { ...current, economyMode: mode, maximumBet, maximumPayoutMultiplier };

  // Selecting an existing mode restores the exact advertised payout settings.
  // An independent chip or availability edit must not reprice the current game.
  if (saved && Math.abs(targetRtp - saved.targetRtp) < 1e-9 && maximumPayoutMultiplier === saved.maximumPayoutMultiplier) {
    return { ...base, ...saved, maximumBet };
  }
  if (!policy.editable) {
    if (mode !== (current.economyMode ?? "NORMAL") || Math.abs(targetRtp - current.targetRtp) >= 1e-9 ||
        maximumPayoutMultiplier !== current.maximumPayoutMultiplier) throw Error(policy.note);
    return base;
  }
  return { ...base, ...calculateTargetConfiguration(game, base, targetRtp) };
}
