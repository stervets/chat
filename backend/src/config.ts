import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WS_PATH} from './common/const.js';

type ConfigFile = {
  host?: string;
  port?: number;
  wsPath?: string;
  wgAdminSocketPath?: string;
  inviteBaseUrl?: string;
  corsOrigins?: string[];
  uploads?: {
    path?: string;
    maxBytes?: number;
    videoMaxBytes?: number;
  };
  vpn?: {
    donationPhone?: string;
    donationBank?: string;
  };
  push?: {
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    vapidSubject?: string;
  };
  db?: {
    url?: string;
  };
  scriptRunner?: {
    enabled?: boolean;
    url?: string;
    host?: string;
    port?: number;
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
  wgAdminSocketPath: String(fileConfig.wgAdminSocketPath || '/run/wg-admin.sock').trim() || '/run/wg-admin.sock',
  inviteBaseUrl,
  corsOrigins: resolvedCorsOrigins,
  db: {
    url: String(fileConfig.db?.url || 'postgresql://postgres:postgres@127.0.0.1:5432/marx?schema=public').trim(),
  },
  scriptRunner: {
    enabled: fileConfig.scriptRunner?.enabled !== false,
    url: String(fileConfig.scriptRunner?.url || 'ws://127.0.0.1:8921/script-runner').trim(),
    host: String(fileConfig.scriptRunner?.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.max(1, Number(fileConfig.scriptRunner?.port || 8921)),
    path: String(fileConfig.scriptRunner?.path || '/script-runner').trim() || '/script-runner',
  },
  uploads: {
    path: fileConfig.uploads?.path || './data/uploads',
    maxBytes: Math.max(64 * 1024, Number(fileConfig.uploads?.maxBytes || 20 * 1024 * 1024)),
    videoMaxBytes: Math.max(1024 * 1024, Number(fileConfig.uploads?.videoMaxBytes || 50 * 1024 * 1024)),
  },
  vpn: {
    donationPhone: String(fileConfig.vpn?.donationPhone || '').trim(),
    donationBank: String(fileConfig.vpn?.donationBank || '').trim(),
  },
  push: {
    vapidPublicKey: String(fileConfig.push?.vapidPublicKey || '').trim(),
    vapidPrivateKey: String(fileConfig.push?.vapidPrivateKey || '').trim(),
    vapidSubject: String(fileConfig.push?.vapidSubject || '').trim(),
  },
};
