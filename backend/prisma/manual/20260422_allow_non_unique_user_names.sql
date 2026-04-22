BEGIN;

DO $$
DECLARE
  con_name text;
  users_rel oid;
  name_attnum int2;
BEGIN
  SELECT c.oid
  INTO users_rel
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'users'
  LIMIT 1;

  IF users_rel IS NULL THEN
    RETURN;
  END IF;

  SELECT attnum
  INTO name_attnum
  FROM pg_attribute
  WHERE attrelid = users_rel
    AND attname = 'name'
    AND NOT attisdropped
  LIMIT 1;

  IF name_attnum IS NULL THEN
    RETURN;
  END IF;

  FOR con_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = users_rel
      AND contype = 'u'
      AND COALESCE(array_length(conkey, 1), 0) = 1
      AND conkey[1] = name_attnum
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con_name);
  END LOOP;
END
$$;

DROP INDEX IF EXISTS users_name_key;

CREATE INDEX IF NOT EXISTS users_name_idx
  ON users(name);

COMMIT;
