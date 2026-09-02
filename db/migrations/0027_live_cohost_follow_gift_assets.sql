-- Server-authoritative Video/Face Live co-host requests, supplied gift
-- animation alignment, and the 2.4.5 mobile release marker.

CREATE TABLE IF NOT EXISTS live_cohost_requests (
  id CHAR(36) PRIMARY KEY,
  room_id CHAR(36) NOT NULL,
  requester_application_user_id CHAR(36) NOT NULL,
  status ENUM('PENDING','ACCEPTED','REJECTED','CANCELED','ENDED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  responded_at DATETIME(3) NULL,
  responder_application_user_id CHAR(36) NULL,
  ended_at DATETIME(3) NULL,
  CONSTRAINT fk_live_cohost_room FOREIGN KEY (room_id) REFERENCES live_rooms(id),
  CONSTRAINT fk_live_cohost_requester FOREIGN KEY (requester_application_user_id) REFERENCES application_users(id),
  CONSTRAINT fk_live_cohost_responder FOREIGN KEY (responder_application_user_id) REFERENCES application_users(id),
  UNIQUE KEY uq_live_cohost_requester (room_id, requester_application_user_id),
  INDEX idx_live_cohost_pending (room_id, status, requested_at)
) ENGINE=InnoDB;

SET @nazraa_master_id = (SELECT id FROM platform_accounts WHERE role = 'MASTER' ORDER BY created_at LIMIT 1);

-- Only publish gifts for which the bundled icon and celebration genuinely
-- depict the same gift. Older catalog rows remain for ledger history.
UPDATE gift_catalog SET active = FALSE;

INSERT INTO gift_catalog
  (id, gift_key, name, category, emoji, coin_price, visual_url, animation_key, active, created_by)
SELECT UUID(), seed.gift_key, seed.name, seed.category, seed.emoji, seed.price,
       NULL, CONCAT('gift.', seed.gift_key), TRUE, @nazraa_master_id
FROM (
  SELECT 'rose' gift_key, 'Rose' name, 'Popular' category, '🌹' emoji, 10 price UNION ALL
  SELECT 'heart', 'Heart', 'Popular', '💖', 50 UNION ALL
  SELECT 'bouquet', 'Bouquet', 'Popular', '💐', 100 UNION ALL
  SELECT 'microphone', 'Microphone', 'Music', '🎤', 200 UNION ALL
  SELECT 'crystal_heart', 'Crystal Heart', 'Romance', '💝', 300 UNION ALL
  SELECT 'teddy_bear', 'Teddy Bear', 'Romance', '🧸', 500 UNION ALL
  SELECT 'love_potion', 'Love Potion', 'Romance', '🧪', 800 UNION ALL
  SELECT 'wedding_ring', 'Wedding Ring', 'Premium', '💍', 1200 UNION ALL
  SELECT 'diamond_ring', 'Diamond Ring', 'Premium', '💎', 2500 UNION ALL
  SELECT 'luxury_car', 'Luxury Car', 'Premium', '🏎️', 5000 UNION ALL
  SELECT 'fireworks', 'Fireworks', 'Celebration', '🎆', 7500 UNION ALL
  SELECT 'yacht', 'Yacht', 'Premium', '🛥️', 10000 UNION ALL
  SELECT 'castle', 'Castle', 'Royal', '🏰', 15000 UNION ALL
  SELECT 'rocket', 'Rocket', 'Rocket', '🚀', 20000
) seed
WHERE @nazraa_master_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  name = VALUES(name), category = VALUES(category), emoji = VALUES(emoji),
  coin_price = VALUES(coin_price), visual_url = NULL,
  animation_key = VALUES(animation_key), active = TRUE;

UPDATE system_settings
SET setting_value = JSON_SET(
  COALESCE(setting_value, JSON_OBJECT()),
  '$.latestVersion', '2.4.5',
  '$.latestBuild', 5315
)
WHERE setting_key = 'mobile.app_config';
