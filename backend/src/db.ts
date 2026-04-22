import {PrismaClient} from '@prisma/client';
import {config} from './config.js';

export const db = new PrismaClient({
  datasources: {
    db: {
      url: config.db.url,
    },
  },
});

export async function checkDb() {
  await db.$queryRawUnsafe('select 1 as ok');
}

export async function closeDb() {
  await db.$disconnect();
}
