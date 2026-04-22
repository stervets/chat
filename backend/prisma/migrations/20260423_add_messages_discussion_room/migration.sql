ALTER TABLE messages
  ADD COLUMN discussion_room_id integer;

ALTER TABLE messages
  ADD CONSTRAINT messages_discussion_room_id_fkey
  FOREIGN KEY (discussion_room_id) REFERENCES rooms(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX messages_discussion_room_id_key
  ON messages(discussion_room_id);
