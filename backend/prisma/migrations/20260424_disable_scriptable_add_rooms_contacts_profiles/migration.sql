ALTER TABLE "users"
  ADD COLUMN "avatar_path" TEXT;

ALTER TABLE "rooms"
  ADD COLUMN "visibility" VARCHAR(16) NOT NULL DEFAULT 'public',
  ADD COLUMN "comments_enabled" BOOLEAN NOT NULL DEFAULT true;

UPDATE "rooms"
SET "visibility" = 'public'
WHERE "visibility" IS NULL OR "visibility" <> 'private';

UPDATE "rooms"
SET "comments_enabled" = true
WHERE "comments_enabled" IS DISTINCT FROM true;

CREATE TABLE "invites_rooms" (
  "invite_id" INTEGER NOT NULL,
  "room_id" INTEGER NOT NULL,

  CONSTRAINT "invites_rooms_pkey" PRIMARY KEY ("invite_id", "room_id")
);

CREATE INDEX "invites_rooms_room_id_idx" ON "invites_rooms"("room_id");

ALTER TABLE "invites_rooms"
  ADD CONSTRAINT "invites_rooms_invite_id_fkey"
  FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invites_rooms"
  ADD CONSTRAINT "invites_rooms_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "users_contacts" (
  "owner_id" INTEGER NOT NULL,
  "contact_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "users_contacts_pkey" PRIMARY KEY ("owner_id", "contact_id")
);

CREATE INDEX "users_contacts_contact_id_idx" ON "users_contacts"("contact_id");

ALTER TABLE "users_contacts"
  ADD CONSTRAINT "users_contacts_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users_contacts"
  ADD CONSTRAINT "users_contacts_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
