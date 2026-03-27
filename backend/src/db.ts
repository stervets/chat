import {Pool} from 'pg';
import {config} from './config.js';

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export async function checkDb() {
  await pool.query('select 1 as ok');
}

export async function closeDb() {
  await pool.end();
}
