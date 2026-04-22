BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoomAppType') THEN
    CREATE TYPE "RoomAppType" AS ENUM ('llm', 'poll', 'dashboard', 'bot_control', 'custom');
  END IF;
END
$$;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS app_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS app_type "RoomAppType";

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS app_config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS rooms_app_enabled_idx
  ON rooms(app_enabled);

CREATE INDEX IF NOT EXISTS rooms_app_type_idx
  ON rooms(app_type);

COMMIT;
