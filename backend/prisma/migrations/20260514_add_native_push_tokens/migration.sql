create table "native_push_tokens" (
  "id" serial primary key,
  "user_id" integer not null,
  "provider" varchar(24) not null,
  "platform" varchar(24) not null,
  "token" text not null,
  "created_at" timestamptz(3) not null default now(),
  "updated_at" timestamptz(3) not null default now(),
  "last_seen_at" timestamptz(3) not null default now()
);

create unique index "native_push_tokens_provider_token_key" on "native_push_tokens"("provider", "token");
create index "native_push_tokens_user_idx" on "native_push_tokens"("user_id");
create index "native_push_tokens_platform_idx" on "native_push_tokens"("platform");

alter table "native_push_tokens"
  add constraint "native_push_tokens_user_id_fkey"
  foreign key ("user_id") references "users"("id")
  on delete cascade on update cascade;
