import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {Client} from 'pg';
import argon2 from 'argon2';
import {config} from '../config.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {createRoomNode} from '../common/nodes.js';

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

function quotePrismaString(raw: string) {
  return String(raw || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createTempPrismaSchema(connectionString: string) {
  const sourceSchemaPath = resolve(process.cwd(), 'prisma', 'schema.prisma');
  const tempSchemaPath = resolve(tmpdir(), `marx-db-init-${Date.now()}-${randomBytes(6).toString('hex')}.prisma`);
  const source = readFileSync(sourceSchemaPath, 'utf-8');
  const replaced = source.replace(
    /url\s*=\s*env\("DATABASE_URL"\)/,
    `url      = "${quotePrismaString(connectionString)}"`,
  );
  writeFileSync(tempSchemaPath, replaced, 'utf-8');
  return tempSchemaPath;
}

function runPrismaPush(connectionString: string) {
  const tempSchemaPath = createTempPrismaSchema(connectionString);
  const result = spawnSync(
    process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    ['prisma', 'db', 'push', '--schema', tempSchemaPath, '--skip-generate'],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    },
  );
  rmSync(tempSchemaPath, {force: true});

  if (result.status !== 0) {
    throw new Error('prisma db push failed');
  }
}

async function ensureDirectRoom(prisma: PrismaClient, firstUserId: number, secondUserId: number) {
  const existing = await prisma.room.findFirst({
    where: {
      kind: 'direct',
      roomUsers: {
        some: {userId: firstUserId},
      },
      AND: [
        {
          roomUsers: {
            some: {userId: secondUserId},
          },
        },
        {
          roomUsers: {
            every: {
              userId: {
                in: [firstUserId, secondUserId],
              },
            },
          },
        },
      ],
    },
    select: {id: true},
  });

  if (existing) return existing.id;

  const created = await createRoomNode(prisma, {
    kind: 'direct',
    title: null,
    nodeData: {},
  });

  await prisma.roomUser.createMany({
    data: [
      {roomId: created.room.id, userId: firstUserId},
      {roomId: created.room.id, userId: secondUserId},
    ],
    skipDuplicates: true,
  });

  return created.room.id;
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
    const groupRoom = await createRoomNode(prisma, {
      kind: 'group',
      title: 'Общий чат',
      nodeData: {},
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

    await prisma.roomUser.createMany({
      data: [
        {roomId: groupRoom.room.id, userId: systemUser.id},
        {roomId: groupRoom.room.id, userId: ownerUser.id},
      ],
      skipDuplicates: true,
    });

    await ensureDirectRoom(prisma, systemUser.id, ownerUser.id);
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
  runPrismaPush(config.db.url);

  process.stdout.write('Seeding system users and default rooms...\n');
  await seedInitialData(config.db.url);

  process.stdout.write('DB initialization completed.\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
