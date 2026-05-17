import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WS_PATH} from './common/const.js';

type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

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
  nativePush?: {
    enabled?: boolean;
    provider?: string;
    rustoreProjectId?: string;
    rustoreServiceToken?: string;
    androidPackageName?: string;
  };
  webrtc?: {
    iceServers?: Array<{
      urls?: string | string[];
      username?: string;
      credential?: string;
    }>;
    callRingTimeoutMs?: number;
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
  maxReserve?: {
    enabled?: boolean;
    wsUrl?: string;
    token?: string;
    chatId?: number;
    chunkTextLimit?: number;
    channelRotationEnabled?: boolean;
    channelRotationMinutes?: number;
    channelSwitchOverlapMs?: number;
    deviceId?: string;
    privateKey?: string;
    privateKeyPath?: string;
    publicKeyId?: string;
    userAgent?: {
      deviceType?: string;
      locale?: string;
      deviceLocale?: string;
      osVersion?: string;
      deviceName?: string;
      headerUserAgent?: string;
      appVersion?: string;
      screen?: string;
      timezone?: string;
    };
  };
};

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

function normalizePositiveNumber(valueRaw: unknown, fallback: number, min: number, max: number) {
  const value = Number(valueRaw || 0);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeChunkLimit(valueRaw: unknown, fallback: number) {
  const value = Number(valueRaw || 0);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(512, Math.min(12000, Math.floor(value)));
}

function normalizeIceServers(raw: unknown): IceServerConfig[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const urlsRaw = source.urls;
      const urls = Array.isArray(urlsRaw)
        ? urlsRaw.map((url) => String(url || '').trim()).filter(Boolean)
        : String(urlsRaw || '').trim();
      if (Array.isArray(urls) ? urls.length === 0 : !urls) return null;

      const normalized: IceServerConfig = {urls};
      const username = String(source.username || '').trim();
      const credential = String(source.credential || '').trim();
      if (username) normalized.username = username;
      if (credential) normalized.credential = credential;
      return normalized;
    })
    .filter((item): item is IceServerConfig => !!item);
}

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
const configuredIceServers = normalizeIceServers(fileConfig.webrtc?.iceServers);
const fallbackIceServers: IceServerConfig[] = [
  {urls: 'stun:stun.l.google.com:19302'},
];

const maxReservePrivateKeyFromPath = (() => {
  const path = String(fileConfig.maxReserve?.privateKeyPath || '').trim();
  if (!path) return '';
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
})();

const maxReserveUserAgentSource = fileConfig.maxReserve?.userAgent || {};

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
    maxBytes: Math.max(64 * 1024, Number(fileConfig.uploads?.maxBytes || 50 * 1024 * 1024)),
    videoMaxBytes: Math.max(1024 * 1024, Number(fileConfig.uploads?.videoMaxBytes || 50 * 1024 * 1024)),
  },
  vpn: {
    donationPhone: String(fileConfig.vpn?.donationPhone || '').trim(),
    donationBank: String(fileConfig.vpn?.donationBank || '').trim(),
  },
  nativePush: {
    enabled: fileConfig.nativePush?.enabled === true,
    provider: String(fileConfig.nativePush?.provider || 'rustore').trim().toLowerCase() || 'rustore',
    rustoreProjectId: String(fileConfig.nativePush?.rustoreProjectId || '').trim(),
    rustoreServiceToken: String(fileConfig.nativePush?.rustoreServiceToken || '').trim(),
    androidPackageName: String(fileConfig.nativePush?.androidPackageName || 'ru.core5.marx').trim() || 'ru.core5.marx',
  },
  webrtc: {
    iceServers: configuredIceServers.length > 0 ? configuredIceServers : fallbackIceServers,
    callRingTimeoutMs: normalizePositiveNumber(fileConfig.webrtc?.callRingTimeoutMs, 45_000, 10_000, 5 * 60_000),
  },
  maxReserve: {
    enabled: fileConfig.maxReserve?.enabled === true,
    wsUrl: String(fileConfig.maxReserve?.wsUrl || 'wss://ws-api.oneme.ru/websocket').trim(),
    token: String(fileConfig.maxReserve?.token || '').trim(),
    chatId: Math.max(0, Number(fileConfig.maxReserve?.chatId || 0)),
    chunkTextLimit: normalizeChunkLimit(fileConfig.maxReserve?.chunkTextLimit, 3000),
    channelRotationEnabled: fileConfig.maxReserve?.channelRotationEnabled !== false,
    channelRotationMinutes: normalizePositiveNumber(fileConfig.maxReserve?.channelRotationMinutes, 60, 1, 24 * 60),
    channelSwitchOverlapMs: normalizePositiveNumber(fileConfig.maxReserve?.channelSwitchOverlapMs, 120_000, 30_000, 10 * 60_000),
    deviceId: String(fileConfig.maxReserve?.deviceId || '').trim(),
    privateKey: String(fileConfig.maxReserve?.privateKey || '').trim() || maxReservePrivateKeyFromPath,
    publicKeyId: String(fileConfig.maxReserve?.publicKeyId || '').trim(),
    userAgent: {
      deviceType: String(maxReserveUserAgentSource.deviceType || 'WEB').trim() || 'WEB',
      locale: String(maxReserveUserAgentSource.locale || 'ru').trim() || 'ru',
      deviceLocale: String(maxReserveUserAgentSource.deviceLocale || 'ru').trim() || 'ru',
      osVersion: String(maxReserveUserAgentSource.osVersion || 'Linux').trim() || 'Linux',
      deviceName: String(maxReserveUserAgentSource.deviceName || 'Chrome').trim() || 'Chrome',
      headerUserAgent: String(maxReserveUserAgentSource.headerUserAgent || 'Mozilla/5.0').trim() || 'Mozilla/5.0',
      appVersion: String(maxReserveUserAgentSource.appVersion || '26.5.8').trim() || '26.5.8',
      screen: String(maxReserveUserAgentSource.screen || '1440x2560 1.0x').trim() || '1440x2560 1.0x',
      timezone: String(maxReserveUserAgentSource.timezone || 'Europe/Moscow').trim() || 'Europe/Moscow',
    },
  },
};
