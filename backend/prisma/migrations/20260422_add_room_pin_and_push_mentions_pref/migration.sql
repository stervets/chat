ALTER TABLE users
  ADD COLUMN push_disable_all_mentions boolean NOT NULL DEFAULT false;

ALTER TABLE rooms
  ADD COLUMN pinned_message_id integer;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_pinned_message_id_fkey
  FOREIGN KEY (pinned_message_id) REFERENCES messages(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX rooms_pinned_message_idx
  ON rooms(pinned_message_id);
