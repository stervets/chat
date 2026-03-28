import {readFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import Database from 'better-sqlite3';
import {config} from './config.js';

const schemaPath = resolve(process.cwd(), 'sql/001_init.sql');
const dbPath = resolve(process.cwd(), config.db.path);

let db: Database;
try {
  mkdirSync(dirname(dbPath), {recursive: true});
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  throw new Error(`SQLite init failed: ${message}`);
}

export {db};

export function checkDb() {
  db.prepare('select 1 as ok').get();
}

export function closeDb() {
  db.close();
}
