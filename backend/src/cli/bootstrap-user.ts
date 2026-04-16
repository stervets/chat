import {hashPassword} from '../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {db, closeDb} from '../db.js';

const getArg = (name: string) => {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split('=').slice(1).join('=');
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return '';
};

const run = async () => {
  const nickname = getArg('nickname').trim().toLowerCase();
  const password = getArg('password');

  if (!nickname || !password) {
    process.stderr.write('Usage: yarn run user:bootstrap -- --nickname <name> --password <pass>\n');
    process.exit(1);
  }

  const row = db.prepare('select count(*) as c from users').get() as {c?: number} | undefined;
  const usersCount = row?.c || 0;
  if (usersCount > 0) {
    process.stderr.write('Users already exist. Bootstrap is only for the first user.\n');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const insert = db.prepare(
    'insert into users (nickname, name, nickname_color, password_hash) values (?, ?, ?, ?)'
  ).run(nickname, nickname, DEFAULT_NICKNAME_COLOR, passwordHash);

  process.stdout.write(`Created user id ${Number(insert.lastInsertRowid)}\n`);
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
