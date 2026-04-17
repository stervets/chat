import {spawnSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import argon2 from 'argon2';
import {config} from '../config.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';

const SYSTEM_NICKNAME = 'marx';
const SYSTEM_NAME = 'MARX';
const SYSTEM_PASSWORD = '123';

const OWNER_NICKNAME = 'lisov';
const OWNER_NAME = 'Mike';
const OWNER_PASSWORD = '123';

function quoteIdentifier(name: string) {
  return `"${String(name || '').replace(/"/g, '""')}"`;
}

function parseDbUrl(connectionString: string) {
  const parsed = new URL(connectionString);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '').trim());
  if (!dbName) {
    throw new Error(`Invalid db.url, database name is missing: ${connectionString}`);
  }
  return {parsed, dbName};
}

async function recreateDatabase(connectionString: string) {
  const {parsed, dbName} = parseDbUrl(connectionString);
  parsed.pathname = '/postgres';
  const adminConnectionString = parsed.toString();

  const client = new Client({connectionString: adminConnectionString});
  await client.connect();
  try {
    await client.query(
      `select pg_terminate_backend(pid)
       from pg_stat_activity
       where datname = $1
         and pid <> pg_backend_pid()`,
      [dbName],
    );
    await client.query(`drop database if exists ${quoteIdentifier(dbName)}`);
    await client.query(`create database ${quoteIdentifier(dbName)}`);
  } finally {
    await client.end();
  }
}

function runPrismaPush() {
  const result = spawnSync(
    process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    ['prisma:push'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: config.db.url,
      },
    },
  );

  if (result.status !== 0) {
    throw new Error('prisma db push failed');
  }
}

function normalizePair(a: number, b: number) {
  return a < b ? {memberAId: a, memberBId: b} : {memberAId: b, memberBId: a};
}

async function ensurePrivateDialog(prisma: PrismaClient, firstUserId: number, secondUserId: number) {
  const pair = normalizePair(firstUserId, secondUserId);
  const existing = await prisma.dialog.findFirst({
    where: {
      kind: 'private',
      memberAId: pair.memberAId,
      memberBId: pair.memberBId,
    },
    select: {id: true},
  });

  if (existing) return existing.id;

  const created = await prisma.dialog.create({
    data: {
      kind: 'private',
      memberAId: pair.memberAId,
      memberBId: pair.memberBId,
    },
    select: {id: true},
  });

  return created.id;
}

async function seedInitialData(connectionString: string) {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: connectionString,
      },
    },
  });

  try {
    await prisma.dialog.create({
      data: {kind: 'general'},
    });

    const [systemHash, ownerHash] = await Promise.all([
      argon2.hash(SYSTEM_PASSWORD),
      argon2.hash(OWNER_PASSWORD),
    ]);

    const systemUser = await prisma.user.create({
      data: {
        nickname: SYSTEM_NICKNAME,
        name: SYSTEM_NAME,
        nicknameColor: DEFAULT_NICKNAME_COLOR,
        passwordHash: systemHash,
      },
      select: {id: true},
    });

    const ownerUser = await prisma.user.create({
      data: {
        nickname: OWNER_NICKNAME,
        name: OWNER_NAME,
        nicknameColor: DEFAULT_NICKNAME_COLOR,
        passwordHash: ownerHash,
      },
      select: {id: true},
    });

    await ensurePrivateDialog(prisma, systemUser.id, ownerUser.id);
  } finally {
    await prisma.$disconnect();
  }
}

async function run() {
  const {parsed, dbName} = parseDbUrl(config.db.url);
  const targetHost = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  process.stdout.write(`Recreating database "${dbName}" on ${targetHost}\n`);
  await recreateDatabase(config.db.url);

  process.stdout.write('Applying Prisma schema...\n');
  runPrismaPush();

  process.stdout.write('Seeding system users and default dialogs...\n');
  await seedInitialData(config.db.url);

  process.stdout.write('DB initialization completed.\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
