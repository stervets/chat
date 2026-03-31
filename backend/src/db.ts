import {readFileSync, mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {config} from './config.js';

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
