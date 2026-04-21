import {randomBytes} from 'node:crypto';
import {hashPassword} from '../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {checkDb, closeDb, db} from '../db.js';
import {KING_BOT_CAST} from '../modules/king/bot-cast.js';

async function run() {
  await checkDb();

  let created = 0;
  let updated = 0;

  for (const bot of KING_BOT_CAST) {
    const existing = await db.user.findUnique({
      where: {
        nickname: bot.nickname,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      const generatedPassword = randomBytes(24).toString('hex');
      const passwordHash = await hashPassword(generatedPassword);

      await db.user.create({
        data: {
          nickname: bot.nickname,
          name: bot.name,
          passwordHash,
          nicknameColor: DEFAULT_NICKNAME_COLOR,
          isBot: true,
          info: bot.info,
        },
      });

      created += 1;
      process.stdout.write(`created ${bot.nickname}\n`);
      continue;
    }

    await db.user.update({
      where: {
        id: existing.id,
      },
      data: {
        name: bot.name,
        isBot: true,
        info: bot.info,
      },
    });

    updated += 1;
    process.stdout.write(`updated ${bot.nickname}\n`);
  }

  process.stdout.write(`bots seed done: created=${created}, updated=${updated}, total=${KING_BOT_CAST.length}\n`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDb();
  });
