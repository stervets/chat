BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS push_disable_all_mentions boolean NOT NULL DEFAULT false;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS pinned_message_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rooms_pinned_message_id_fkey'
  ) THEN
    ALTER TABLE rooms
      ADD CONSTRAINT rooms_pinned_message_id_fkey
      FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS rooms_pinned_message_idx
  ON rooms(pinned_message_id);

COMMIT;
