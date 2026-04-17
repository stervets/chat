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
     where nickname !~ '^[a-z0-9_-]{3,32}$'`
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
     check (nickname ~ '^[a-z0-9_-]{3,32}$')`
  );

  await db.$executeRawUnsafe(
    `alter table users
     drop column if exists nickname_normalized`
  );

  nicknameModelReady = true;
}

async function ensureRuntimeIndexes() {
  if (runtimeIndexesReady) return;

  await db.$executeRawUnsafe(
    `create unique index if not exists dialogs_general_unique
     on dialogs(kind)
     where kind = 'general'`
  );

  await db.$executeRawUnsafe(
    `create unique index if not exists dialogs_private_unique
     on dialogs(kind, member_a, member_b)
     where kind = 'private' and member_a is not null and member_b is not null`
  );

  runtimeIndexesReady = true;
}

export async function checkDb() {
  await db.$queryRawUnsafe('select 1 as ok');
  await ensureNicknameModel();
  await ensureRuntimeIndexes();
}

export async function closeDb() {
  await db.$disconnect();
}
