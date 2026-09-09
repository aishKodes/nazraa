-- A sender-generated UUID makes room-chat persistence idempotent across
-- retries, reconnects and delayed HTTP acknowledgements.  NULL preserves all
-- historical rows created before mobile clients supplied an idempotency key.
ALTER TABLE live_room_messages
  ADD COLUMN client_message_id CHAR(36) NULL AFTER sender_application_user_id,
  ADD UNIQUE INDEX uq_live_room_message_sender_client
    (room_id, sender_application_user_id, client_message_id);
