/** One prospective policy for every normal room Gift, including ALL batches.
 * Activation is explicit; installing the additive schema never changes rates.
 * All arithmetic uses integers, including legacy ratio compatibility.
 */
export const GIFT_PLATFORM_FEE_BPS = 1500;
export function giftSettlementPolicy(gross: number, config: Record<string, unknown>, serverNow: Date) {
  if (!Number.isSafeInteger(gross) || gross < 1) throw new Error('Choose a valid gift value.');
  const activation = typeof config.platformFeeActivatedAt === 'string' ? new Date(config.platformFeeActivatedAt) : null;
  if (config.platformFeeActivatedAt != null && (activation == null || !Number.isFinite(activation.getTime())))
    throw new Error('Gift earnings configuration is invalid.');
  const active = activation != null && Number.isFinite(activation.getTime()) && serverNow >= activation;
  if (active && Number(config.giftPlatformFeeBps) !== GIFT_PLATFORM_FEE_BPS) throw new Error('Gift earnings configuration is invalid.');
  const units = active ? 10000 : Number(config.giftCoinUnits ?? 100);
  const recipientUnits = active ? 10000 - GIFT_PLATFORM_FEE_BPS : Number(config.receiverDiamondUnits ?? 97);
  if (!Number.isSafeInteger(units) || units < 1 || !Number.isSafeInteger(recipientUnits) || recipientUnits < 0 || recipientUnits > units)
    throw new Error('Gift earnings configuration is invalid.');
  const netDiamonds = Number(BigInt(gross) * BigInt(recipientUnits) / BigInt(units));
  return {grossCoins:gross,netDiamonds,platformFee:gross-netDiamonds,
    platformFeeBps:active ? GIFT_PLATFORM_FEE_BPS : null,
    policyVersion:active ? 'GIFT_FEE_15_V1' : 'LEGACY_RATIO',giftCoinUnits:units,receiverDiamondUnits:recipientUnits};
}
