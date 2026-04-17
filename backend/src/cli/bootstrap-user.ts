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

  const usersCount = await db.user.count();
  if (usersCount > 0) {
    process.stderr.write('Users already exist. Bootstrap is only for the first user.\n');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const created = await db.user.create({
    data: {
      nickname,
      nicknameNormalized: nickname,
      name: nickname,
      nicknameColor: DEFAULT_NICKNAME_COLOR,
      passwordHash,
    },
    select: {id: true},
  });

  process.stdout.write(`Created user id ${created.id}\n`);
  await closeDb();
};

run().catch((err) => {
  console.error(err);
  void closeDb().finally(() => process.exit(1));
});
