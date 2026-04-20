import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {TelegramClient} from 'telegram';
import {StringSession} from 'telegram/sessions/index.js';
import {Logger, LogLevel} from 'telegram/extensions/Logger.js';
import {ensureConfigFile, getConfigPaths, saveConfig} from './config.js';

async function run() {
  const config = ensureConfigFile();
  const {configPath, examplePath} = getConfigPaths();

  const missing: string[] = [];
  if (!Number.isFinite(config.telegram.apiId) || config.telegram.apiId <= 0) missing.push('telegram.apiId');
  if (!config.telegram.apiHash) missing.push('telegram.apiHash');

  if (missing.length > 0) {
    process.stderr.write(`Missing ${missing.join(', ')} in ${configPath}.\n`);
    process.stderr.write(`Fill them using ${examplePath} template, then run again.\n`);
    process.exit(1);
  }

  const rl = createInterface({input, output});
  const session = new StringSession(config.telegram.stringSession || '');
  process.stdout.write(`Connecting to Telegram (useWSS=${config.telegram.useWSS ? 'true' : 'false'})...\n`);

  const client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
    useWSS: config.telegram.useWSS,
    connectionRetries: config.telegram.connectionRetries,
    baseLogger: new Logger(LogLevel.NONE),
  });

  try {
    await client.start({
      phoneNumber: async () => (await rl.question('Telegram phone (+7999...): ')).trim(),
      password: async () => (await rl.question('Telegram 2FA password (if enabled): ')).trim(),
      phoneCode: async () => (await rl.question('Code from Telegram: ')).trim(),
      onError: (error) => {
        process.stderr.write(`Telegram auth error: ${String((error as any)?.message || error)}\n`);
      },
    });

    const savedSession = client.session.save();
    if (!savedSession) {
      throw new Error('failed_to_save_string_session');
    }

    config.telegram.stringSession = savedSession;
    saveConfig(config);

    process.stdout.write('Telegram login ok.\n');
    process.stdout.write(`Saved session to ${configPath}\n`);
    process.stdout.write('Now run: yarn telegram:fetch\n');
    process.stdout.write('\nSession string:\n');
    process.stdout.write(`${savedSession}\n`);
  } finally {
    rl.close();
    await client.disconnect();
  }
}

run().catch((error) => {
  process.stderr.write(`${String((error as any)?.message || error)}\n`);
  process.exit(1);
});
