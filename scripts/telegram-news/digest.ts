import {ensureConfigFile, requirePrompts} from './config.js';
import {ollamaChat} from './ollama.js';
import {readFetchedNews, writeTextOutputFile} from './storage.js';
import type {TelegramNewsItem} from './types.js';

function getArg(name: string) {
  const direct = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) return direct.split('=').slice(1).join('=').trim();

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return String(process.argv[index + 1]).trim();

  return '';
}

function getLimit() {
  const raw = getArg('limit');
  if (!raw) return 12;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 12;
  return Math.min(parsed, 40);
}

function buildDigestPrompt(basePrompt: string, news: TelegramNewsItem[]) {
  const packed = news.map((item) => ({
    messageId: item.messageId,
    channel: item.channel,
    publishedAt: item.publishedAt,
    text: item.text,
    url: item.url,
    imageUrl: item.imageUrl,
    hasMedia: item.hasMedia,
  }));

  return `${basePrompt}\n\nНовости для дайджеста(JSON):\n${JSON.stringify(packed, null, 2)}`;
}

function ensureLinksInDigest(outputRaw: string, news: TelegramNewsItem[]) {
  let output = String(outputRaw || '').trim();
  if (!output) return output;

  const blocks = output
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const sourceMatch = block.match(/Источник:\s*(https?:\/\/\S+)/i);
      if (!sourceMatch) return block;

      const sourceUrl = String(sourceMatch[1] || '').trim();
      const found = news.find((item) => item.url === sourceUrl);
      if (!found) return block;

      let updated = block.replace(/<url>/g, found.url);
      if (found.imageUrl) {
        updated = updated.replace(/<imageUrl>/g, found.imageUrl);
      } else {
        updated = updated.replace(/^\s*<imageUrl>\s*$/gim, '').trim();
      }

      return updated;
    });

  output = blocks.join('\n\n').trim();
  if (/https?:\/\//i.test(output)) return output;

  const links = news
    .slice(0, 5)
    .map((item) => `- ${item.channel}/${item.messageId}: ${item.url}${item.imageUrl ? ` | ${item.imageUrl}` : ''}`)
    .join('\n');

  return `${output}\n\nИсточники:\n${links}`;
}

async function run() {
  const config = ensureConfigFile();
  requirePrompts(config, ['digestAsMarxPrompt']);

  const allNews = readFetchedNews(config);
  if (!allNews.length) {
    throw new Error('Fetched news file is empty. Run: yarn telegram:fetch');
  }

  const limit = getLimit();
  const sorted = [...allNews].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const selected = sorted.slice(0, limit);

  process.stderr.write(`Digest from ${selected.length} news items\n`);

  const prompt = buildDigestPrompt(config.prompts.digestAsMarxPrompt, selected);
  const modelText = await ollamaChat({
    config,
    prompt,
    responseFormat: 'text',
  });

  const finalText = ensureLinksInDigest(modelText, selected);
  process.stdout.write(`${finalText}\n`);

  const outputFile = 'tmp/telegram-digest.txt';
  writeTextOutputFile(outputFile, finalText);
  process.stderr.write(`Digest saved to ${outputFile}\n`);
}

run().catch((error) => {
  process.stderr.write(`${String((error as any)?.message || error)}\n`);
  process.exit(1);
});
