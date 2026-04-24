alter table "rooms"
  add column "avatar_path" text,
  add column "post_only_by_admin" boolean not null default false;

update "rooms"
set "post_only_by_admin" = false
where "post_only_by_admin" is distinct from false;
