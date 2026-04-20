import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {TelegramNewsPipelineConfig} from './types.js';

const DEFAULT_CHANNELS = ['topor', 'ru2ch', 'dvachannel'];
const DEFAULT_FETCHED_NEWS_FILE = 'tmp/telegram-news.json';

function toInt(raw: unknown, fallback: number) {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(raw: unknown, fallback: boolean) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function toString(raw: unknown, fallback = '') {
  const value = String(raw ?? '').trim();
  return value || fallback;
}

function toChannels(raw: unknown) {
  const source = Array.isArray(raw) ? raw : DEFAULT_CHANNELS;
  return source
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

export function getTelegramNewsDir() {
  return resolve(fileURLToPath(new URL('.', import.meta.url)));
}

export function getProjectRoot() {
  return resolve(fileURLToPath(new URL('../../', import.meta.url)));
}

export function getConfigPaths() {
  const baseDir = getTelegramNewsDir();
  return {
    configPath: resolve(baseDir, 'config.json'),
    examplePath: resolve(baseDir, 'config.example.json'),
  };
}

function normalizeRawConfig(raw: any): TelegramNewsPipelineConfig {
  const telegramRaw = raw?.telegram || raw || {};
  const ollamaRaw = raw?.ollama || {};
  const outputRaw = raw?.output || {};
  const promptsRaw = raw?.prompts || {};

  return {
    telegram: {
      apiId: toInt(telegramRaw.apiId, 0),
      apiHash: toString(telegramRaw.apiHash),
      stringSession: toString(telegramRaw.stringSession),
      channels: toChannels(telegramRaw.channels),
      useWSS: toBool(telegramRaw.useWSS, true),
      connectionRetries: Math.max(0, toInt(telegramRaw.connectionRetries, 5)),
    },
    ollama: {
      baseUrl: toString(ollamaRaw.baseUrl, 'http://127.0.0.1:11434'),
      model: toString(ollamaRaw.model, 'qwen3:8b'),
    },
    output: {
      fetchedNewsFile: toString(outputRaw.fetchedNewsFile, DEFAULT_FETCHED_NEWS_FILE),
    },
    prompts: {
      pickHotNewsPrompt: toString(promptsRaw.pickHotNewsPrompt),
      rewriteAsMarxPrompt: toString(promptsRaw.rewriteAsMarxPrompt),
      digestAsMarxPrompt: toString(promptsRaw.digestAsMarxPrompt),
    },
  };
}

export function ensureConfigFile() {
  const {configPath, examplePath} = getConfigPaths();

  if (existsSync(configPath)) {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    return normalizeRawConfig(parsed);
  }

  const templateRaw = existsSync(examplePath)
    ? JSON.parse(readFileSync(examplePath, 'utf-8'))
    : {};

  const template = normalizeRawConfig(templateRaw);
  saveConfig(template);
  return template;
}

export function loadConfig() {
  const {configPath} = getConfigPaths();
  if (!existsSync(configPath)) {
    return ensureConfigFile();
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
  return normalizeRawConfig(parsed);
}

export function saveConfig(config: TelegramNewsPipelineConfig) {
  const {configPath} = getConfigPaths();
  mkdirSync(dirname(configPath), {recursive: true});
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function requirePrompts(config: TelegramNewsPipelineConfig, names: Array<keyof TelegramNewsPipelineConfig['prompts']>) {
  const missing = names.filter((name) => !String(config.prompts[name] || '').trim());
  if (!missing.length) return;

  const {configPath} = getConfigPaths();
  throw new Error(`Missing prompts in ${configPath}: ${missing.join(', ')}`);
}
