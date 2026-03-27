import {randomBytes} from 'node:crypto';
import {Pool} from 'pg';
import {config} from '../config.js';

const parseCount = (args: string[]) => {
  const direct = args.find((arg) => arg.startsWith('--count='));
  if (direct) {
    const value = Number.parseInt(direct.split('=')[1], 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  const index = args.indexOf('--count');
  if (index >= 0 && args[index + 1]) {
    const value = Number.parseInt(args[index + 1], 10);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  return 1;
};

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

const createInvite = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(8).toString('hex');
    try {
      await pool.query('insert into invites (code) values ($1)', [code]);
      return code;
    } catch (err: any) {
      if (err && err.code === '23505') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('failed_to_generate_invite');
};

const run = async () => {
  const count = parseCount(process.argv.slice(2));
  const codes: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const code = await createInvite();
    codes.push(code);
  }

  for (const code of codes) {
    process.stdout.write(`${code}\n`);
  }

  await pool.end();
};

run().catch((err) => {
  console.error(err);
  pool.end().finally(() => process.exit(1));
});
