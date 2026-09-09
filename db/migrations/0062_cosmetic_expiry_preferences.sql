-- Durable VIP cosmetic opt-out and fast request-time expiry enforcement.

ALTER TABLE user_cosmetic_entitlements
  ADD COLUMN manually_unequipped_at DATETIME(3) NULL AFTER equipped_at;

ALTER TABLE application_users
  ADD INDEX idx_application_users_vip_expiry (vip_expires_at, vip_tier);
