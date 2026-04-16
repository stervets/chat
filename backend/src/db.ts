import {readFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {config} from './config.js';
import {DEFAULT_NICKNAME_COLOR} from './common/const.js';

const baseDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const schemaPath = resolve(baseDir, 'sql/001_init.sql');
const dbPath = resolve(baseDir, config.db.path);

let db: DatabaseSync;
try {
  mkdirSync(dirname(dbPath), {recursive: true});
  db = new DatabaseSync(dbPath);
  db.exec('pragma foreign_keys = on');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  ensureMigrations(db);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`SQLite init failed: ${message}`);
}

function ensureMigrations(database: DatabaseSync) {
  const columns = database.prepare(`pragma table_info('users')`).all() as {name: string}[];
  const hasName = columns.some((column) => column.name === 'name');
  const hasNicknameColor = columns.some((column) => column.name === 'nickname_color');

  if (!hasName) {
    database.exec(`alter table users add column name text`);
    database.exec(`update users set name = nickname where name is null or trim(name) = ''`);
  }

  if (!hasNicknameColor) {
    database.exec(`alter table users add column nickname_color text`);
  }

  database.exec(`update users set nickname_color = lower(nickname_color) where nickname_color is not null`);
  database.prepare(
    `update users
     set nickname_color = ?
     where nickname_color is null or trim(nickname_color) = ''`
  ).run(DEFAULT_NICKNAME_COLOR);

  const duplicatedNicknames = database.prepare(
    `select lower(nickname) as nickname_ci, count(*) as c
     from users
     group by lower(nickname)
     having count(*) > 1
     limit 1`
  ).get() as {nickname_ci: string; c: number} | undefined;

  if (duplicatedNicknames) {
    throw new Error(`duplicate nicknames by case-insensitive key: ${duplicatedNicknames.nickname_ci}`);
  }

  database.exec(`create unique index if not exists users_nickname_ci_unique on users(lower(nickname))`);
}

export {db};

export function checkDb() {
  db.prepare('select 1 as ok').get();
}

export function closeDb() {
  db.close();
}
