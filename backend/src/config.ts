import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MESSAGES_TTL_DAYS, WS_PATH} from './common/const.js';

type ConfigFile = {
  host?: string;
  port?: number;
  wsPath?: string;
  messagesTtlDays?: number;
  corsOrigins?: string[];
  db?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
};

const loadConfig = (): ConfigFile => {
  const raw = readFileSync(resolve(process.cwd(), 'config.json'), 'utf-8');
  return JSON.parse(raw);
};

const fileConfig = loadConfig();
const dbConfig = fileConfig.db || (fileConfig as any).database || {};

export const config = {
  env: 'development',
  host: fileConfig.host || '0.0.0.0',
  port: fileConfig.port || 8816,
  wsPath: fileConfig.wsPath || WS_PATH,
  messagesTtlDays: fileConfig.messagesTtlDays || MESSAGES_TTL_DAYS,
  corsOrigins: fileConfig.corsOrigins || ['http://localhost:8815', 'http://127.0.0.1:8815'],
  db: {
    host: dbConfig.host || '127.0.0.1',
    port: dbConfig.port || 5432,
    user: dbConfig.user || 'marx',
    password: dbConfig.password || 'marx',
    database: dbConfig.database || 'marx_chat',
  }
};
