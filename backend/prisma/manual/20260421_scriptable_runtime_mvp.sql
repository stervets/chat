BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageKind') THEN
    CREATE TYPE "MessageKind" AS ENUM ('text', 'system', 'scriptable');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScriptExecutionMode') THEN
    CREATE TYPE "ScriptExecutionMode" AS ENUM ('client', 'client_server', 'client_runner');
  END IF;
END
$$;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS kind "MessageKind" NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS script_id varchar(128),
  ADD COLUMN IF NOT EXISTS script_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS script_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS script_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS script_mode "ScriptExecutionMode";

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS script_id varchar(128),
  ADD COLUMN IF NOT EXISTS script_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS script_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS script_state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS script_mode "ScriptExecutionMode";

CREATE INDEX IF NOT EXISTS messages_script_id_idx
  ON messages(script_id);

CREATE INDEX IF NOT EXISTS rooms_script_id_idx
  ON rooms(script_id);

UPDATE messages
SET kind = 'text'
WHERE kind IS NULL;

COMMIT;
