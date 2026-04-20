import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {ensureConfigFile, getProjectRoot, requirePrompts} from './config.js';
import {ollamaGenerate, parseJsonFromModelText} from './ollama.js';
import {readFetchedNews} from './storage.js';

type PickHotResult = {
  messageId: number;
  channel?: string;
  reason?: string;
};

const PICK_HOT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    messageId: {type: 'integer'},
    channel: {type: 'string'},
    reason: {type: 'string'},
  },
  required: ['messageId', 'channel', 'reason'],
  additionalProperties: false,
};

function preview(text: string, max = 180) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function validatePickHotResult(raw: any): PickHotResult {
  const messageId = Number(raw?.messageId || 0);
  if (!Number.isFinite(messageId) || messageId <= 0) {
    throw new Error(`Model JSON has no valid messageId: ${JSON.stringify(raw)}`);
  }

  return {
    messageId,
    channel: String(raw?.channel || '').trim() || undefined,
    reason: String(raw?.reason || '').trim() || undefined,
  };
}

function getPickHotRawResponsePath() {
  return resolve(getProjectRoot(), 'tmp/telegram-pick-hot-last-response.txt');
}

function saveRawModelResponse(raw: string) {
  const path = getPickHotRawResponsePath();
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, `${String(raw || '').trim()}\n`, 'utf-8');
  return path;
}

async function run() {
  const config = ensureConfigFile();
  requirePrompts(config, ['pickHotNewsPrompt']);

  const news = readFetchedNews(config);
  if (!news.length) {
    throw new Error('Fetched news file is empty. Run: yarn telegram:fetch');
  }

  const packed = news.map((item) => ({
    messageId: item.messageId,
    channel: item.channel,
    publishedAt: item.publishedAt,
    text: item.text,
    url: item.url,
    imageUrl: item.imageUrl,
  }));

  const prompt = `${config.prompts.pickHotNewsPrompt}\n\nВот JSON-массив новостей:\n${JSON.stringify(packed, null, 2)}\n\nВерни только JSON-объект с полями messageId, channel, reason.`;
  const modelText = await ollamaGenerate({
    config,
    prompt,
    responseFormat: PICK_HOT_RESPONSE_SCHEMA,
  });
  const rawResponsePath = saveRawModelResponse(modelText);

  let parsed: any;
  try {
    parsed = parseJsonFromModelText(modelText);
  } catch (error: any) {
    throw new Error(
      `Model returned invalid JSON. Raw response saved to ${rawResponsePath}. Details: ${String(error?.message || error)}`,
    );
  }

  let pick: PickHotResult;
  try {
    pick = validatePickHotResult(parsed);
  } catch (error: any) {
    throw new Error(
      `Model returned JSON without valid messageId. Raw response saved to ${rawResponsePath}. Details: ${String(error?.message || error)}`,
    );
  }

  const pickedNews = news.find((item) => item.messageId === pick.messageId);

  if (!pickedNews) {
    throw new Error(
      `Model selected messageId=${pick.messageId}, but this message is absent in fetched file. Raw response: ${rawResponsePath}`,
    );
  }

  process.stdout.write(`messageId: ${pickedNews.messageId}\n`);
  process.stdout.write(`channel: ${pickedNews.channel}\n`);
  process.stdout.write(`reason: ${pick.reason || '-'}\n`);
  process.stdout.write(`preview: ${preview(pickedNews.text)}\n`);
  process.stdout.write(`url: ${pickedNews.url}\n`);
  if (pickedNews.imageUrl) {
    process.stdout.write(`imageUrl: ${pickedNews.imageUrl}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`${String((error as any)?.message || error)}\n`);
  process.exit(1);
});
