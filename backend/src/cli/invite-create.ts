import {randomBytes} from 'node:crypto';
import {db, closeDb} from '../db.js';

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

const createInvite = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(8).toString('hex');
    try {
      db.prepare('insert into invites (code) values (?)').run(code);
      return code;
    } catch (err: any) {
      const code = err?.code;
      if (code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
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

  closeDb();
};

run().catch((err) => {
  console.error(err);
  try {
    closeDb();
  } finally {
    process.exit(1);
  }
});
