-- Face Live rewards are limited to one qualifying 3,500-Diamond entitlement
-- per Host per configured business day. Historical decisions and claims remain
-- immutable and are used to seed the daily guard.

CREATE TABLE IF NOT EXISTS live_daily_reward_awards (
  id CHAR(36) PRIMARY KEY,
  application_user_id CHAR(36) NOT NULL,
  business_date DATE NOT NULL,
  live_session_accounting_id CHAR(36) NOT NULL,
  completed_hour INT UNSIGNED NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'HOST_HOURLY_DIAMONDS',
  awarded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_live_daily_reward_user FOREIGN KEY (application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_daily_reward_session FOREIGN KEY (live_session_accounting_id) REFERENCES live_session_accounting(id),
  UNIQUE KEY uq_live_daily_reward_user_day (application_user_id, business_date),
  INDEX idx_live_daily_reward_session (live_session_accounting_id, completed_hour),
  CHECK (completed_hour >= 1),
  CHECK (amount > 0),
  CHECK (source = 'HOST_HOURLY_DIAMONDS')
) ENGINE=InnoDB;

INSERT IGNORE INTO live_daily_reward_awards
  (id, application_user_id, business_date, live_session_accounting_id,
   completed_hour, amount, source, awarded_at)
SELECT UUID(), decision.host_application_user_id,
       DATE(DATE_ADD(decision.decided_at, INTERVAL 330 MINUTE)),
       decision.live_session_accounting_id, decision.completed_hour,
       decision.reward_diamonds, 'HOST_HOURLY_DIAMONDS', decision.decided_at
FROM live_hour_reward_decisions decision
WHERE decision.eligible = TRUE AND decision.reward_diamonds > 0
ORDER BY decision.decided_at, decision.completed_hour;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.rewardFrequency', 'DAILY_FIRST_ELIGIBLE_HOUR',
  '$.maximumRewardsPerBusinessDay', 1,
  '$.updatedBy', 'daily-live-reward-0068'
)
WHERE setting_key = 'mobile.live_rules';

UPDATE policy_documents
SET body_json = JSON_SET(
  body_json,
  '$.sections[2].rules[0]',
  'An eligible female Host earns one claimable 3,500-Diamond reward per business day after completing the first continuous 60-minute Face Live block. Additional Live time that day does not create another duration reward. Male and other Hosts may stream normally but receive no Live-time reward. Party Audio earns no hourly reward.'
)
WHERE policy_key = 'host-live-access' AND active = TRUE;

-- Publish the production-ready individual premium assets that were already
-- bundled in the app but never registered in the server catalogue. VIP rows
-- are entitlement grants, while only the four Mall rows have purchase prices.
SET @nazraa_master_id = (
  SELECT id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1
);

INSERT INTO gift_catalog
  (id, gift_key, name, category, catalog_type, emoji, coin_price, currency,
   validity_days, vip_tier_eligibility, sort_order, visual_url, animation_key,
   asset_config, active, created_by)
SELECT UUID(), seed.gift_key, seed.name, seed.category, seed.catalog_type,
       seed.emoji, seed.coin_price, 'COIN', 30, seed.vip_tier, seed.sort_order,
       seed.visual_url, NULL, seed.asset_config, TRUE, @nazraa_master_id
FROM (
  SELECT 'mall_celestial_empress_frame' gift_key, 'Celestial Empress Frame' name, 'Premium Frames' category, 'AVATAR_FRAME' catalog_type, '👑' emoji, 8000 coin_price, NULL vip_tier, 110 sort_order,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/mall_celestial_empress_frame.webp' visual_url,
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','accent',4294942776) asset_config UNION ALL
  SELECT 'mall_emerald_dragon_frame','Emerald Dragon Frame','Premium Frames','AVATAR_FRAME','🐉',12000,NULL,120,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/mall_emerald_dragon_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','accent',4284010285) UNION ALL
  SELECT 'mall_obsidian_lion_frame','Obsidian Lion Frame','Premium Frames','AVATAR_FRAME','🦁',16000,NULL,130,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/mall_obsidian_lion_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','accent',4291113395) UNION ALL
  SELECT 'mall_phoenix_crystal_frame','Phoenix Crystal Frame','Premium Frames','AVATAR_FRAME','🔥',22000,NULL,140,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/mall_phoenix_crystal_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','accent',4294939454) UNION ALL

  SELECT 'vip_platinum_crystal_lion_frame','Platinum Crystal Lion Frame','VIP Grants','AVATAR_FRAME','💎',0,2,210,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/vip_platinum_crystal_lion_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL') UNION ALL
  SELECT 'vip_diamond_white_gold_lion_frame','Diamond White Gold Lion Frame','VIP Grants','AVATAR_FRAME','💠',0,3,220,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/vip_diamond_white_gold_lion_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL') UNION ALL
  SELECT 'vip_legend_phoenix_frame','Legend Phoenix Frame','VIP Grants','AVATAR_FRAME','🪽',0,5,230,
    'Nazraa_Premium_Assets_Pack/02_production_webp/avatar_seat_frames/vip_legend_phoenix_frame.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA','displayMode','FULL') UNION ALL

  SELECT 'entry_celestial_empress','Celestial Empress Entry','VIP Entries','ENTRY_EFFECT','✨',0,1,310,
    'Nazraa_Premium_Assets_Pack/02_production_webp/entry_banners/entry_celestial_empress_banner.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','durationMs',2400,'gameBehavior','COMPACT','modalBehavior','COMPACT','position','BOTTOM') UNION ALL
  SELECT 'entry_crown_wings_fiery_throne','Crown Wings Entry','VIP Entries','ENTRY_EFFECT','🔥',0,2,320,
    'Nazraa_Premium_Assets_Pack/02_production_webp/entry_banners/entry_crown_wings_fiery_throne_banner.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','durationMs',2500,'gameBehavior','COMPACT','modalBehavior','COMPACT','position','BOTTOM') UNION ALL
  SELECT 'entry_infernal_royal_lion','Infernal Royal Lion Entry','VIP Entries','ENTRY_EFFECT','🦁',0,3,330,
    'Nazraa_Premium_Assets_Pack/02_production_webp/entry_banners/entry_infernal_royal_lion_banner.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM','displayMode','FULL','durationMs',2700,'gameBehavior','COMPACT','modalBehavior','COMPACT','position','BOTTOM') UNION ALL
  SELECT 'entry_inferno_queen','Inferno Queen Entry','VIP Entries','ENTRY_EFFECT','👸',0,4,340,
    'Nazraa_Premium_Assets_Pack/02_production_webp/entry_banners/entry_inferno_queen_banner.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA','displayMode','FULL','durationMs',2900,'gameBehavior','COMPACT','modalBehavior','COMPACT','position','BOTTOM') UNION ALL
  SELECT 'entry_underworld_emperor','Underworld Emperor Entry','VIP Entries','ENTRY_EFFECT','♛',0,5,350,
    'Nazraa_Premium_Assets_Pack/02_production_webp/entry_banners/entry_underworld_emperor_banner.webp',
    JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA','displayMode','FULL','durationMs',3200,'gameBehavior','COMPACT','modalBehavior','COMPACT','position','BOTTOM') UNION ALL

  SELECT 'profile_fiery_phoenix_crown','Fiery Phoenix Profile','VIP Profile','PROFILE_EFFECT','🔥',0,1,410,
    'Nazraa_Premium_Assets_Pack/02_production_webp/profile_effects/profile_fiery_phoenix_crown.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'profile_lava_queen_molten_crown','Lava Queen Profile','VIP Profile','PROFILE_EFFECT','👑',0,2,420,
    'Nazraa_Premium_Assets_Pack/02_production_webp/profile_effects/profile_lava_queen_molten_crown.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'profile_shadow_emperor_gold','Shadow Emperor Profile','VIP Profile','PROFILE_EFFECT','♛',0,3,430,
    'Nazraa_Premium_Assets_Pack/02_production_webp/profile_effects/profile_shadow_emperor_gold.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'profile_volcanic_fire_sorceress','Volcanic Sorceress Profile','VIP Profile','PROFILE_EFFECT','🌋',0,4,440,
    'Nazraa_Premium_Assets_Pack/02_production_webp/profile_effects/profile_volcanic_fire_sorceress.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA') UNION ALL
  SELECT 'profile_shadow_king','Shadow King Profile','VIP Profile','PROFILE_EFFECT','👑',0,5,450,
    'Nazraa_Premium_Assets_Pack/02_production_webp/profile_effects/profile_shadow_king.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA') UNION ALL

  SELECT 'chat_celestial_aurora_queen','Celestial Aurora Chat Frame','VIP Chat','CHAT_FRAME','💬',0,4,510,
    'Nazraa_Premium_Assets_Pack/02_production_webp/chat_message_frames/chat_celestial_aurora_queen_frame.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'chat_regal_crystal_wings','Regal Crystal Wings Chat Frame','VIP Chat','CHAT_FRAME','🪽',0,5,520,
    'Nazraa_Premium_Assets_Pack/02_production_webp/chat_message_frames/chat_regal_crystal_wings_frame.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA') UNION ALL

  SELECT 'badge_gold_vip_lion','Gold VIP Lion Badge','VIP Badges','BADGE','🦁',0,1,610,
    'Nazraa_Premium_Assets_Pack/02_production_webp/badges_medals/badge_gold_vip_lion_emblem.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'badge_diamond_vip_crystal_crown','Diamond Crystal Crown Badge','VIP Badges','BADGE','💎',0,3,620,
    'Nazraa_Premium_Assets_Pack/02_production_webp/badges_medals/badge_diamond_vip_crystal_crown.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','PREMIUM') UNION ALL
  SELECT 'badge_legend_vip_royal_crest','Legend Royal Crest Badge','VIP Badges','BADGE','🏆',0,5,630,
    'Nazraa_Premium_Assets_Pack/02_production_webp/badges_medals/badge_legend_vip_royal_crest.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA') UNION ALL
  SELECT 'medal_shadow_king_crown','Shadow King Crown Medal','VIP Medals','MEDAL','🏅',0,5,710,
    'Nazraa_Premium_Assets_Pack/02_production_webp/badges_medals/medal_shadow_king_crown_crest.webp',JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA')
) seed
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  name = VALUES(name), category = VALUES(category),
  catalog_type = VALUES(catalog_type), emoji = VALUES(emoji),
  coin_price = VALUES(coin_price), currency = VALUES(currency),
  validity_days = VALUES(validity_days),
  vip_tier_eligibility = VALUES(vip_tier_eligibility),
  sort_order = VALUES(sort_order), visual_url = VALUES(visual_url),
  animation_key = VALUES(animation_key), asset_config = VALUES(asset_config),
  active = TRUE;

-- Use the supplied transparent premium icon for the existing Rocket gift.
-- Its price, animation key and room-wide Rocket mechanics remain unchanged.
UPDATE gift_catalog
SET visual_url = 'Nazraa_Premium_Assets_Pack/02_production_webp/gift_icons/gift_royal_jewel_rocket.webp',
    asset_config = JSON_MERGE_PATCH(
      COALESCE(asset_config, JSON_OBJECT()),
      JSON_OBJECT('assetType','STATIC_IMAGE','presentationTier','ULTRA','transparent',TRUE)
    )
WHERE gift_key = 'rocket' AND catalog_type = 'VIRTUAL_GIFT';

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.31',
  '$.latestBuild', 5341
)
WHERE setting_key = 'mobile.app_config';
