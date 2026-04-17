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
  await ensureRuntimeIndexes();
}

export async function closeDb() {
  await db.$disconnect();
}
