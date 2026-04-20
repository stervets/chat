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

function parseMessageId() {
  const raw = getArg('messageId');
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildRewritePrompt(basePrompt: string, news: TelegramNewsItem) {
  return `${basePrompt}\n\nИсходная новость(JSON):\n${JSON.stringify(news, null, 2)}`;
}

function ensureReferences(outputRaw: string, news: TelegramNewsItem) {
  let output = String(outputRaw || '').trim();
  if (!output) return output;

  if (news.imageUrl) {
    output = output.replace(/<imageUrl>/g, news.imageUrl);
  } else {
    output = output.replace(/^\s*<imageUrl>\s*$/gim, '').trim();
  }

  output = output.replace(/<url>/g, news.url);

  if (news.imageUrl && !output.includes(news.imageUrl)) {
    output = `${news.imageUrl}\n${output}`;
  }

  if (!output.includes(news.url)) {
    output = `${output}\n\nИсточник: ${news.url}`;
  }

  return output;
}

async function run() {
  const messageId = parseMessageId();
  if (!messageId) {
    process.stderr.write('Usage: yarn telegram:rewrite --messageId <id>\n');
    process.exit(1);
  }

  const config = ensureConfigFile();
  requirePrompts(config, ['rewriteAsMarxPrompt']);

  const news = readFetchedNews(config);
  const selected = news.find((item) => item.messageId === messageId);
  if (!selected) {
    throw new Error(`Message not found by id=${messageId}. Run: yarn telegram:fetch`);
  }

  process.stderr.write(`Selected: ${selected.channel}/${selected.messageId}\n`);
  process.stderr.write(`URL: ${selected.url}\n`);

  const prompt = buildRewritePrompt(config.prompts.rewriteAsMarxPrompt, selected);
  const modelText = await ollamaChat({
    config,
    prompt,
    responseFormat: 'text',
  });

  const finalText = ensureReferences(modelText, selected);
  process.stdout.write(`${finalText}\n`);

  const outputFile = `tmp/telegram-rewrite-${selected.messageId}.txt`;
  writeTextOutputFile(outputFile, finalText);
  process.stderr.write(`Rewrite saved to ${outputFile}\n`);
}

run().catch((error) => {
  process.stderr.write(`${String((error as any)?.message || error)}\n`);
  process.exit(1);
});
