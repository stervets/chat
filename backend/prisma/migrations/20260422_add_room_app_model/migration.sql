CREATE TYPE "RoomAppType" AS ENUM ('llm', 'poll', 'dashboard', 'bot_control', 'custom');

ALTER TABLE rooms
  ADD COLUMN app_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN app_type "RoomAppType",
  ADD COLUMN app_config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX rooms_app_enabled_idx
  ON rooms(app_enabled);

CREATE INDEX rooms_app_type_idx
  ON rooms(app_type);
