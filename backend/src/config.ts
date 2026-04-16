import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MESSAGES_TTL_DAYS, WS_PATH} from './common/const.js';

type ConfigFile = {
  host?: string;
  port?: number;
  wsPath?: string;
  messagesTtlDays?: number;
  inviteBaseUrl?: string;
  corsOrigins?: string[];
  db?: {
    path?: string;
  };
};

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const loadConfig = (): ConfigFile => {
  try {
    const baseDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
    const raw = readFileSync(resolve(baseDir, 'config.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      throw new Error('config.json not found. Create backend/config.json from backend/config.example.json.');
    }
    if (err instanceof SyntaxError) {
      throw new Error('config.json is invalid JSON. Fix formatting.');
    }
    throw err;
  }
};

const fileConfig = loadConfig();
const defaultCorsOrigins = [
  'http://localhost:8815',
  'http://127.0.0.1:8815'
];

const resolvedCorsOrigins = fileConfig.corsOrigins || defaultCorsOrigins;
const fallbackInviteBaseUrl = resolvedCorsOrigins.find((origin) => origin && origin !== '*')
  || 'http://localhost:8815';
const inviteBaseUrl = trimTrailingSlashes(fileConfig.inviteBaseUrl || fallbackInviteBaseUrl);

export const config = {
  env: 'development',
  host: fileConfig.host || '0.0.0.0',
  port: fileConfig.port || 8816,
  wsPath: fileConfig.wsPath || WS_PATH,
  messagesTtlDays: fileConfig.messagesTtlDays || MESSAGES_TTL_DAYS,
  inviteBaseUrl,
  corsOrigins: resolvedCorsOrigins,
  db: {
    path: fileConfig.db?.path || './data/marx.sqlite',
  }
};
