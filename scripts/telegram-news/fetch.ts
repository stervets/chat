import {TelegramClient} from 'telegram';
import {StringSession} from 'telegram/sessions/index.js';
import {Logger, LogLevel} from 'telegram/extensions/Logger.js';
import {fetchTelegramPostImageUrl} from './image-url.js';
import {ensureConfigFile, getConfigPaths} from './config.js';
import {writeFetchedNews} from './storage.js';
import {type TelegramChannel, type TelegramNewsItem} from './types.js';

function getArg(name: string) {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split('=').slice(1).join('=').trim();

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]).trim();

  return '';
}

function getLimit() {
  const raw = getArg('limit');
  if (!raw) return 15;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 15;
  return Math.min(parsed, 50);
}

function normalizeText(raw: unknown) {
  return String(raw || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTelegramPublishedAt(raw: unknown) {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const timestampMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNewsItem(channel: TelegramChannel, message: any): TelegramNewsItem | null {
  const messageId = Number(message?.id || 0);
  if (!Number.isFinite(messageId) || messageId <= 0) return null;

  const text = normalizeText(message?.message || message?.text || '');
  if (!text) return null;

  const publishedAt = parseTelegramPublishedAt(message?.date);
  if (!publishedAt) return null;

  return {
    source: 'telegram',
    channel,
    messageId,
    publishedAt,
    url: `https://t.me/${channel}/${messageId}`,
    text,
    imageUrl: null,
    hasMedia: Boolean(message?.media),
  };
}

async function enrichImageUrls(items: TelegramNewsItem[]) {
  for (const item of items) {
    if (!item.hasMedia) continue;
    item.imageUrl = await fetchTelegramPostImageUrl(item.url);
  }
}

async function run() {
  const config = ensureConfigFile();
  const {configPath} = getConfigPaths();

  const missing: string[] = [];
  if (!Number.isFinite(config.telegram.apiId) || config.telegram.apiId <= 0) missing.push('telegram.apiId');
  if (!config.telegram.apiHash) missing.push('telegram.apiHash');
  if (!config.telegram.stringSession) missing.push('telegram.stringSession');
  if (!config.telegram.channels.length) missing.push('telegram.channels');
  if (!config.output.fetchedNewsFile) missing.push('output.fetchedNewsFile');

  if (missing.length > 0) {
    process.stderr.write(`Missing ${missing.join(', ')} in ${configPath}.\n`);
    process.stderr.write('Run: yarn telegram:login\n');
    process.exit(1);
  }

  const limit = getLimit();
  const client = new TelegramClient(
    new StringSession(config.telegram.stringSession),
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      useWSS: config.telegram.useWSS,
      connectionRetries: config.telegram.connectionRetries,
      baseLogger: new Logger(LogLevel.NONE),
    },
  );

  await client.connect();

  try {
    const authorized = await client.checkAuthorization();
    if (!authorized) {
      process.stderr.write('Telegram session is not authorized. Run: yarn telegram:login\n');
      process.exit(1);
    }

    const items: TelegramNewsItem[] = [];
    const seen = new Set<string>();

    for (const channel of config.telegram.channels) {
      const entity = await client.getEntity(channel);
      const messages = await client.getMessages(entity, {limit});

      for (const message of messages) {
        const item = toNewsItem(channel, message);
        if (!item) continue;

        const key = `${item.channel}:${item.messageId}`;
        if (seen.has(key)) continue;

        seen.add(key);
        items.push(item);
      }
    }

    await enrichImageUrls(items);
    items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    const filePath = writeFetchedNews(config, items);
    process.stderr.write(`Saved ${items.length} items to ${filePath}\n`);
    process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
  } finally {
    await client.disconnect();
  }
}

run().catch((error) => {
  process.stderr.write(`${String((error as any)?.message || error)}\n`);
  process.exit(1);
});
