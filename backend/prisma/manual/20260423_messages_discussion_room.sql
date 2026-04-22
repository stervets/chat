BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS discussion_room_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'messages_discussion_room_id_fkey'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_discussion_room_id_fkey
      FOREIGN KEY (discussion_room_id) REFERENCES rooms(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS messages_discussion_room_id_key
  ON messages(discussion_room_id);

COMMIT;
