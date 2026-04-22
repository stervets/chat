import {PrismaClient} from '@prisma/client';
import {config} from './config.js';

export const db = new PrismaClient({
  datasources: {
    db: {
      url: config.db.url,
    },
  },
});

let runtimeIndexesReady = false;
let nicknameModelReady = false;
let displayNameModelReady = false;
let donationBadgeModelReady = false;
let scriptableModelReady = false;
let roomPinAndPushPrefsModelReady = false;

async function ensureNicknameModel() {
  if (nicknameModelReady) return;

  await db.$executeRawUnsafe(
    `update users
     set nickname = left(lower(trim(nickname)), 32)
     where nickname is not null
       and nickname <> left(lower(trim(nickname)), 32)`
  );

  await db.$executeRawUnsafe(
    `update users
     set nickname = 'user_' || id::text
     where nickname !~ '^!?[a-z0-9_-]{3,32}$'`
  );

  await db.$executeRawUnsafe(
    `with ranked as (
       select
         id,
         nickname,
         row_number() over (partition by nickname order by id asc) as rn
       from users
     )
     update users as u
     set nickname = left(r.nickname || '_' || u.id::text, 32)
     from ranked r
     where u.id = r.id
       and r.rn > 1`
  );

  await db.$executeRawUnsafe(
    `drop index if exists users_nickname_idx`
  );

  await db.$executeRawUnsafe(
    `alter table users
     drop constraint if exists users_nickname_normalized_key`
  );

  await db.$executeRawUnsafe(
    `drop index if exists users_nickname_normalized_key`
  );

  await db.$executeRawUnsafe(
    `create unique index if not exists users_nickname_key
     on users(nickname)`
  );

  await db.$executeRawUnsafe(
    `alter table users
     alter column nickname type varchar(32)`
  );

  await db.$executeRawUnsafe(
    `alter table users
     drop constraint if exists users_nickname_format_check`
  );

  await db.$executeRawUnsafe(
    `alter table users
     add constraint users_nickname_format_check
     check (nickname ~ '^!?[a-z0-9_-]{3,32}$')`
  );

  await db.$executeRawUnsafe(
    `alter table users
     drop column if exists nickname_normalized`
  );

  nicknameModelReady = true;
}

async function ensureDisplayNameModel() {
  if (displayNameModelReady) return;

  await db.$executeRawUnsafe(
    `do $$
     declare
       con_name text;
       users_rel oid;
       name_attnum int2;
     begin
       select c.oid
       into users_rel
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'users'
       limit 1;

       if users_rel is null then
         return;
       end if;

       select attnum
       into name_attnum
       from pg_attribute
       where attrelid = users_rel
         and attname = 'name'
         and not attisdropped
       limit 1;

       if name_attnum is null then
         return;
       end if;

       for con_name in
         select conname
         from pg_constraint
         where conrelid = users_rel
           and contype = 'u'
           and coalesce(array_length(conkey, 1), 0) = 1
           and conkey[1] = name_attnum
       loop
         execute format('alter table users drop constraint %I', con_name);
       end loop;
     end
     $$`
  );

  await db.$executeRawUnsafe(
    `drop index if exists users_name_key`
  );

  await db.$executeRawUnsafe(
    `create index if not exists users_name_idx
     on users(name)`
  );

  displayNameModelReady = true;
}

async function ensureRuntimeIndexes() {
  if (runtimeIndexesReady) return;

  await db.$executeRawUnsafe(
    `drop index if exists dialogs_general_unique`
  );

  await db.$executeRawUnsafe(
    `drop index if exists dialogs_private_unique`
  );

  await db.$executeRawUnsafe(
    `create index if not exists rooms_kind_idx
     on rooms(kind)`
  );

  await db.$executeRawUnsafe(
    `create index if not exists rooms_users_user_idx
     on rooms_users(user_id)`
  );

  runtimeIndexesReady = true;
}

async function ensureDonationBadgeModel() {
  if (donationBadgeModelReady) return;

  await db.$executeRawUnsafe(
    `alter table users
     add column if not exists donation_badge_until timestamptz(3)`
  );

  donationBadgeModelReady = true;
}

async function ensureScriptableModel() {
  if (scriptableModelReady) return;

  await db.$executeRawUnsafe(
    `do $$
     begin
       if not exists (select 1 from pg_type where typname = 'MessageKind') then
         create type "MessageKind" as enum ('text', 'system', 'scriptable');
       end if;

       if not exists (select 1 from pg_type where typname = 'ScriptExecutionMode') then
         create type "ScriptExecutionMode" as enum ('client', 'client_server', 'client_runner');
       end if;
     end
     $$`
  );

  await db.$executeRawUnsafe(
    `alter table messages
       add column if not exists kind "MessageKind" not null default 'text',
       add column if not exists script_id varchar(128),
       add column if not exists script_revision integer not null default 0,
       add column if not exists script_config_json jsonb not null default '{}'::jsonb,
       add column if not exists script_state_json jsonb not null default '{}'::jsonb,
       add column if not exists script_mode "ScriptExecutionMode"`
  );

  await db.$executeRawUnsafe(
    `alter table rooms
       add column if not exists script_id varchar(128),
       add column if not exists script_revision integer not null default 0,
       add column if not exists script_config_json jsonb not null default '{}'::jsonb,
       add column if not exists script_state_json jsonb not null default '{}'::jsonb,
       add column if not exists script_mode "ScriptExecutionMode"`
  );

  await db.$executeRawUnsafe(
    `create index if not exists messages_script_id_idx
     on messages(script_id)`
  );

  await db.$executeRawUnsafe(
    `create index if not exists rooms_script_id_idx
     on rooms(script_id)`
  );

  // Временно отключено: автопривязка скрипта "Счётчик комнаты" (demo:room_meter) к первой group-комнате.
  // await db.$executeRawUnsafe(
  //   `with target_room as (
  //      select id
  //      from rooms
  //      where kind = 'group'
  //      order by id asc
  //      limit 1
  //    )
  //    update rooms as r
  //    set
  //      script_id = 'demo:room_meter',
  //      script_revision = 1,
  //      script_mode = 'client_runner',
  //      script_config_json = jsonb_build_object('title', 'Счётчик комнаты', 'announceEvery', 5),
  //      script_state_json = jsonb_build_object('totalMessages', 0, 'lastAuthorNickname', '', 'updatedAt', null)
  //    from target_room t
  //    where r.id = t.id
  //      and (r.script_id is null or btrim(r.script_id) = '')`
  // );

  scriptableModelReady = true;
}

async function ensureRoomPinAndPushPrefsModel() {
  if (roomPinAndPushPrefsModelReady) return;

  await db.$executeRawUnsafe(
    `alter table users
     add column if not exists push_disable_all_mentions boolean not null default false`
  );

  await db.$executeRawUnsafe(
    `alter table rooms
     add column if not exists pinned_message_id integer`
  );

  await db.$executeRawUnsafe(
    `do $$
     begin
       if not exists (
         select 1
         from pg_constraint
         where conname = 'rooms_pinned_message_id_fkey'
       ) then
         alter table rooms
           add constraint rooms_pinned_message_id_fkey
           foreign key (pinned_message_id) references messages(id) on delete set null on update cascade;
       end if;
     end
     $$`
  );

  await db.$executeRawUnsafe(
    `create index if not exists rooms_pinned_message_idx
     on rooms(pinned_message_id)`
  );

  roomPinAndPushPrefsModelReady = true;
}

export async function checkDb() {
  await db.$queryRawUnsafe('select 1 as ok');
  await ensureNicknameModel();
  await ensureDisplayNameModel();
  await ensureDonationBadgeModel();
  await ensureScriptableModel();
  await ensureRoomPinAndPushPrefsModel();
  await ensureRuntimeIndexes();
}

export async function closeDb() {
  await db.$disconnect();
}
