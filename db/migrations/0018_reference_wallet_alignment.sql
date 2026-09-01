-- Align the production wallet with the behavior verified in both Vyno and the
-- user-owned Golden Spotlight implementation:
--   * Gifts and games spend the same COIN balance.
--   * Game payouts return to COIN.
--   * Received gifts credit DIAMOND income.
--   * DIAMOND income exchanges to COIN at 2:1.
-- The game endpoints already use wallet_balances(COIN); this migration only
-- corrects the previously seeded 1:1 Diamond conversion rule.

UPDATE diamond_conversion_rules
SET diamonds = 1000,
    coins = 500,
    minimum_diamonds = GREATEST(minimum_diamonds, 1000),
    maximum_diamonds = GREATEST(maximum_diamonds, 1000)
WHERE enabled = TRUE;

UPDATE system_settings
SET setting_value = JSON_SET(
      setting_value,
      '$.rate', 0.5,
      '$.minimum', 1000
    )
WHERE setting_key = 'economy.diamond_conversion';
