ALTER TABLE "invites"
  DROP CONSTRAINT IF EXISTS "invites_used_by_fkey";

ALTER TABLE "invites"
  DROP COLUMN IF EXISTS "used_by",
  DROP COLUMN IF EXISTS "used_at";
