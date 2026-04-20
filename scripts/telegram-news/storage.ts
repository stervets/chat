import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {getProjectRoot} from './config.js';
import type {TelegramNewsItem, TelegramNewsPipelineConfig} from './types.js';

function resolveFetchedNewsPath(config: TelegramNewsPipelineConfig) {
  const target = String(config.output.fetchedNewsFile || '').trim();
  if (!target) {
    throw new Error('output.fetchedNewsFile is empty in telegram-news config');
  }

  return resolve(getProjectRoot(), target);
}

export function readFetchedNews(config: TelegramNewsPipelineConfig) {
  const filePath = resolveFetchedNewsPath(config);
  const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Fetched news file is not an array: ${filePath}`);
  }
  return parsed as TelegramNewsItem[];
}

export function writeFetchedNews(config: TelegramNewsPipelineConfig, items: TelegramNewsItem[]) {
  const filePath = resolveFetchedNewsPath(config);
  mkdirSync(dirname(filePath), {recursive: true});
  writeFileSync(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf-8');
  return filePath;
}

export function writeTextOutputFile(relativePath: string, text: string) {
  const normalizedRelativePath = String(relativePath || '').trim();
  if (!normalizedRelativePath) {
    throw new Error('Output file path is empty');
  }

  const filePath = resolve(getProjectRoot(), normalizedRelativePath);
  mkdirSync(dirname(filePath), {recursive: true});
  writeFileSync(filePath, `${String(text || '').trim()}\n`, 'utf-8');
  return filePath;
}
