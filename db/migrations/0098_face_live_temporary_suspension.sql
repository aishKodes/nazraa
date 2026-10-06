-- A scoped Face/Video Live restriction remains separate from account bans,
-- general hosting suspension, and Party Audio access.
ALTER TABLE moderation_restrictions
  MODIFY COLUMN restriction_type ENUM('TEMP_LIVE_BAN','WARNING','SUSPENSION','ACCOUNT_BAN','FACE_LIVE') NOT NULL;

ALTER TABLE mobile_push_campaigns
  MODIFY COLUMN campaign_type ENUM('LIVE_FOLLOWER','MASTER_DIRECT','MASTER_BROADCAST','MODERATION') NOT NULL;
