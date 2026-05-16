import {registerPlugin, type PluginListenerHandle} from '@capacitor/core';

type MarxPacket = [string, Record<string, any> | any[], string, string, string?];

type MaxReserveUserAgentConfig = {
  deviceType: string;
  locale: string;
  deviceLocale: string;
  osVersion: string;
  deviceName: string;
  headerUserAgent: string;
  appVersion: string;
  screen: string;
  timezone: string;
};

type MaxReserveConfig = {
  wsUrl: string;
  token: string;
  deviceId: string;
  chatId: number;
  backendPublicKeyPem: string;
  userAgent: MaxReserveUserAgentConfig;
};

type MaxNativeTransportPlugin = {
  init(options: {
    wsUrl: string;
    origin: string;
    userAgent: string;
    token: string;
    deviceId: string;
    chatId: number;
    userAgentPayload: MaxReserveUserAgentConfig;
  }): Promise<{ok: true}>;
  connect(): Promise<{ok: true}>;
  disconnect(): Promise<{ok: true}>;
  sendText(options: {text: string}): Promise<{ok: true}>;
  addListener(eventName: 'state', listener: (event: {state?: string}) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'message', listener: (event: {text?: string}) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'error', listener: (event: {message?: string}) => void): Promise<PluginListenerHandle>;
};

type ResolveStateWaiter = {
  state: string;
  resolve: () => void;
  reject: (reason?: any) => void;
  timerId: number;
};

const MaxNativeTransport = registerPlugin<MaxNativeTransportPlugin>('MaxNativeTransport');

const DEFAULT_CHAT_ID = 0;
const RESERVED_BACKEND_RECIPIENT = '0';
const MAX_SESSION_STORAGE_KEY = 'marx_max_reserve_session_v1';

function toBase64(bytes: Uint8Array) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i]);
  }
  return btoa(raw);
}

function fromBase64(value: string) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array) {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(valueRaw: string) {
  const normalized = String(valueRaw || '').trim();
  if (!normalized) return new Uint8Array(0);

  const padded = normalized
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  return fromBase64(padded);
}

function utf8Encode(text: string) {
  return new TextEncoder().encode(text);
}

function utf8Decode(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function randomHex(bytesLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parsePacket(raw: string): MarxPacket | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 4) return null;

    const com = typeof parsed[0] === 'string' ? parsed[0] : '';
    if (!com) return null;

    const args = Array.isArray(parsed[1])
      ? parsed[1]
      : parsed[1] && typeof parsed[1] === 'object'
        ? parsed[1]
        : {};

    const senderId = typeof parsed[2] === 'string' ? parsed[2] : '';
    const recipientId = typeof parsed[3] === 'string' ? parsed[3] : '';
    const requestId = typeof parsed[4] === 'string' ? parsed[4] : undefined;

    if (!senderId || !recipientId) return null;
    return [com, args, senderId, recipientId, requestId];
  } catch {
    return null;
  }
}

function parsePemBody(pemRaw: string) {
  return String(pemRaw || '')
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
    .trim();
}

async function importBackendPublicKey(pem: string) {
  const body = parsePemBody(pem);
  if (!body) {
    throw new Error('reserve_public_key_missing');
  }
  const keyBytes = fromBase64(body);
  return crypto.subtle.importKey(
    'spki',
    keyBytes,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false,
    ['encrypt'],
  );
}

async function rsaEncryptToBase64Url(key: CryptoKey, text: string) {
  const encrypted = await crypto.subtle.encrypt(
    {name: 'RSA-OAEP'},
    key,
    utf8Encode(text),
  );
  return toBase64Url(new Uint8Array(encrypted));
}

async function importAesKey(rawKey: Uint8Array) {
  return crypto.subtle.importKey('raw', rawKey, {name: 'AES-GCM'}, false, ['encrypt', 'decrypt']);
}

async function aesEncryptToCompact(rawKey: Uint8Array, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(rawKey);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    utf8Encode(text),
  );

  const encryptedBytes = new Uint8Array(encrypted);
  return `${toBase64Url(iv)}.${toBase64Url(encryptedBytes)}`;
}

async function aesDecryptFromCompact(rawKey: Uint8Array, compactRaw: string) {
  const compact = String(compactRaw || '').trim();
  const [ivPart, dataPart] = compact.split('.', 2);
  if (!ivPart || !dataPart) {
    throw new Error('reserve_invalid_aes_payload');
  }

  const iv = fromBase64Url(ivPart);
  const encrypted = fromBase64Url(dataPart);
  if (iv.length !== 12 || encrypted.length < 17) {
    throw new Error('reserve_invalid_aes_payload');
  }

  const key = await importAesKey(rawKey);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encrypted,
  );

  return utf8Decode(new Uint8Array(decrypted));
}

function hasWindow() {
  return typeof window !== 'undefined';
}

export class MaxReserveTransport {
  private config: MaxReserveConfig | null = null;
  private connected = false;
  private connectingPromise: Promise<void> | null = null;

  private readonly onPacket: (packet: MarxPacket) => void;
  private readonly onDisconnect: () => void;

  private clientId = '';
  private userId = '';
  private tmpSessionKey = new Uint8Array(0);
  private maxSessionKey = new Uint8Array(0);
  private backendPublicKey: CryptoKey | null = null;

  private pluginState = 'idle';
  private listenerHandles: PluginListenerHandle[] = [];
  private listenersReadyPromise: Promise<void> | null = null;
  private stateWaiters: ResolveStateWaiter[] = [];

  constructor(onPacket: (packet: MarxPacket) => void, onDisconnect: () => void) {
    this.onPacket = onPacket;
    this.onDisconnect = onDisconnect;
    this.restoreStoredSession();
  }

  setConfig(config: MaxReserveConfig | null) {
    this.config = config;
  }

  isConfigured() {
    if (!this.config) return false;
    return !!String(this.config.wsUrl || '').trim()
      && !!String(this.config.token || '').trim()
      && !!String(this.config.deviceId || '').trim()
      && !!String(this.config.backendPublicKeyPem || '').trim();
  }

  isConnected() {
    return this.connected;
  }

  getClientId() {
    return this.clientId;
  }

  getUserId() {
    return this.userId;
  }

  getSenderId() {
    return this.userId || this.clientId;
  }

  private restoreStoredSession() {
    if (!hasWindow()) return;
    try {
      const raw = localStorage.getItem(MAX_SESSION_STORAGE_KEY) || '';
      if (!raw) return;
      const parsed = JSON.parse(raw) as {userId?: string; maxSessionKey?: string};
      const userId = String(parsed?.userId || '').trim();
      const maxSessionKeyRaw = String(parsed?.maxSessionKey || '').trim();
      if (!userId || !maxSessionKeyRaw) {
        localStorage.removeItem(MAX_SESSION_STORAGE_KEY);
        return;
      }
      const decoded = fromBase64(maxSessionKeyRaw);
      if (decoded.length !== 32) {
        localStorage.removeItem(MAX_SESSION_STORAGE_KEY);
        return;
      }
      this.userId = userId;
      this.maxSessionKey = decoded;
    } catch {
      localStorage.removeItem(MAX_SESSION_STORAGE_KEY);
    }
  }

  private persistStoredSession() {
    if (!hasWindow()) return;
    if (!this.userId || this.maxSessionKey.length !== 32) {
      localStorage.removeItem(MAX_SESSION_STORAGE_KEY);
      return;
    }
    const payload = JSON.stringify({
      userId: this.userId,
      maxSessionKey: toBase64(this.maxSessionKey),
    });
    localStorage.setItem(MAX_SESSION_STORAGE_KEY, payload);
  }

  private clearStoredSession() {
    this.userId = '';
    this.maxSessionKey = new Uint8Array(0);
    this.persistStoredSession();
  }

  private resetEphemeralState() {
    this.clientId = `_${randomHex(32)}`;
    this.tmpSessionKey = crypto.getRandomValues(new Uint8Array(32));
    this.backendPublicKey = null;
  }

  private async ensureListeners() {
    if (this.listenersReadyPromise) return this.listenersReadyPromise;

    this.listenersReadyPromise = (async () => {
      const stateHandle = await MaxNativeTransport.addListener('state', (event) => {
        const nextState = String(event?.state || '').trim().toLowerCase() || 'disconnected';
        this.pluginState = nextState;

        if (nextState === 'online') {
          this.connected = true;
          this.resolveStateWaiters('online');
          return;
        }

        if (nextState === 'connecting') {
          return;
        }

        const wasConnected = this.connected;
        this.connected = false;
        this.rejectStateWaiters('reserve_disconnected');
        if (wasConnected) {
          this.onDisconnect();
        }
      });

      const messageHandle = await MaxNativeTransport.addListener('message', (event) => {
        const text = String(event?.text || '').trim();
        if (!text) return;
        void this.onNativeText(text);
      });

      const errorHandle = await MaxNativeTransport.addListener('error', (event) => {
        const message = String(event?.message || '').trim() || 'reserve_native_error';
        this.rejectStateWaiters(message);
      });

      this.listenerHandles.push(stateHandle, messageHandle, errorHandle);
    })();

    return this.listenersReadyPromise;
  }

  private resolveStateWaiters(state: string) {
    const pending = this.stateWaiters;
    this.stateWaiters = [];
    for (const waiter of pending) {
      window.clearTimeout(waiter.timerId);
      if (waiter.state === state) {
        waiter.resolve();
      } else {
        waiter.reject(new Error(`reserve_state_mismatch:${state}`));
      }
    }
  }

  private rejectStateWaiters(reason: string) {
    const pending = this.stateWaiters;
    this.stateWaiters = [];
    for (const waiter of pending) {
      window.clearTimeout(waiter.timerId);
      waiter.reject(new Error(reason));
    }
  }

  private waitForState(targetState: string, timeoutMs = 12000) {
    if (this.pluginState === targetState) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timerId = window.setTimeout(() => {
        this.stateWaiters = this.stateWaiters.filter((item) => item.timerId !== timerId);
        reject(new Error(`reserve_state_timeout:${targetState}`));
      }, timeoutMs);

      this.stateWaiters.push({
        state: targetState,
        resolve,
        reject,
        timerId,
      });
    });
  }

  disconnect() {
    this.connected = false;
    this.connectingPromise = null;
    this.rejectStateWaiters('reserve_disconnected');
    void MaxNativeTransport.disconnect().catch(() => undefined);
  }

  private parseReserveText(textRaw: string) {
    const text = String(textRaw || '');
    const sep = text.indexOf(' ');
    if (sep <= 0) return null;

    const recipientId = text.slice(0, sep).trim();
    const data = text.slice(sep + 1).trim();
    if (!recipientId || !data) return null;

    return {recipientId, data};
  }

  private shouldAcceptRecipient(recipientId: string) {
    if (!recipientId) return false;
    if (this.userId) {
      return recipientId === this.userId;
    }
    return recipientId === this.clientId;
  }

  private parseLoginMaxMeta(packet: MarxPacket) {
    const [com, args] = packet;
    if (com !== '[res]' || !Array.isArray(args)) return null;
    const first = args[0] as any;
    if (!first || typeof first !== 'object' || first.ok !== true) return null;

    const max = first?.data?.max;
    const userId = String(max?.userId || '').trim();
    const maxSessionKeyRaw = String(max?.maxSessionKey || '').trim();
    if (!userId || !maxSessionKeyRaw) return null;

    const decoded = fromBase64(maxSessionKeyRaw);
    if (decoded.length !== 32) return null;

    return {
      userId,
      maxSessionKey: decoded,
    };
  }

  private async onNativeText(textRaw: string) {
    const parsed = this.parseReserveText(textRaw);
    if (!parsed) return;
    if (!this.shouldAcceptRecipient(parsed.recipientId)) return;

    const key = parsed.recipientId === this.clientId
      ? this.tmpSessionKey
      : this.maxSessionKey;

    if (key.length !== 32) return;

    let decrypted = '';
    try {
      decrypted = await aesDecryptFromCompact(key, parsed.data);
    } catch {
      if (parsed.recipientId === this.userId) {
        this.clearStoredSession();
        this.disconnect();
        this.onDisconnect();
      }
      return;
    }

    const packet = parsePacket(decrypted);
    if (!packet) return;

    const loginMeta = this.parseLoginMaxMeta(packet);
    if (loginMeta) {
      this.userId = loginMeta.userId;
      this.maxSessionKey = loginMeta.maxSessionKey;
      this.persistStoredSession();
    }

    this.onPacket(packet);
  }

  private async sendMaxText(text: string) {
    await MaxNativeTransport.sendText({text});
  }

  async connect() {
    if (this.isConnected()) return;
    if (this.connectingPromise) return this.connectingPromise;
    if (!this.isConfigured()) {
      throw new Error('reserve_config_invalid');
    }

    this.resetEphemeralState();

    this.connectingPromise = (async () => {
      await this.ensureListeners();

      const config = this.config!;
      await MaxNativeTransport.init({
        wsUrl: String(config.wsUrl || '').trim(),
        origin: 'https://web.max.ru',
        userAgent: String(config.userAgent?.headerUserAgent || 'Mozilla/5.0').trim(),
        token: String(config.token || '').trim(),
        deviceId: String(config.deviceId || '').trim(),
        chatId: Number(config.chatId || DEFAULT_CHAT_ID),
        userAgentPayload: config.userAgent,
      });

      await MaxNativeTransport.connect();
      await this.waitForState('online', 12000);
      this.connected = true;
    })();

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  private async ensurePublicKeyImported() {
    if (this.backendPublicKey) return this.backendPublicKey;
    this.backendPublicKey = await importBackendPublicKey(String(this.config?.backendPublicKeyPem || '').trim());
    return this.backendPublicKey;
  }

  private async sendLoginHandshake(packet: MarxPacket) {
    const publicKey = await this.ensurePublicKeyImported();

    const envelope = JSON.stringify({
      clientId: this.clientId,
      tmpSessionKey: toBase64(this.tmpSessionKey),
      packet,
    });

    const encrypted = await rsaEncryptToBase64Url(publicKey, envelope);
    await this.sendMaxText(`${RESERVED_BACKEND_RECIPIENT} ${encrypted}`);
  }

  private async sendEncryptedPacket(packet: MarxPacket) {
    if (this.maxSessionKey.length !== 32) {
      throw new Error('reserve_login_required');
    }

    const encrypted = await aesEncryptToCompact(this.maxSessionKey, JSON.stringify(packet));
    await this.sendMaxText(`${RESERVED_BACKEND_RECIPIENT} ${encrypted}`);
  }

  async sendPacket(packet: MarxPacket) {
    if (!this.isConnected()) {
      throw new Error('reserve_not_connected');
    }

    if (this.userId && this.maxSessionKey.length === 32) {
      await this.sendEncryptedPacket(packet);
      return;
    }

    if (packet[0] !== 'auth:login') {
      throw new Error('reserve_login_required');
    }

    await this.sendLoginHandshake(packet);
  }
}
