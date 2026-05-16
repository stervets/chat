import {Logger} from '@nestjs/common';
import {constants, createCipheriv, createDecipheriv, privateDecrypt, randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {db} from '../db.js';
import {RESULT_COMMAND, type Packet} from './protocol.js';

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

type MaxReserveBridgeConfig = {
  enabled: boolean;
  wsUrl: string;
  token: string;
  chatId: number;
  deviceId: string;
  privateKeyPem: string;
  userAgent: MaxReserveUserAgentConfig;
};

type PendingOpcodeRequest = {
  opcode: number;
  seq: number;
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

type LoginSession = {
  clientId: string;
  tmpSessionKey: Buffer;
};

type UserSessionKey = {
  userId: number;
  maxSessionKey: Buffer;
  rotatedAtMs: number;
};

type InboundEnvelope = {
  clientId: string;
  packet: Packet;
};

type HandshakeKeyData = {
  clientId: string;
  tmpSessionKey: Buffer;
  packet?: Packet;
};

type MaxReserveBridgeHandlers = {
  onPacket: (envelope: InboundEnvelope) => Promise<void> | void;
};

type MaxReserveBridgeStatus = {
  enabled: boolean;
  connected: boolean;
  reconnectAttempt: number;
  hasReconnectTimer: boolean;
  lastConnectedAtMs: number;
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
  lastError: string;
};

const BACKEND_RECIPIENT_ID = '0';
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toBase64Url(value: Buffer) {
  return value.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(valueRaw: string) {
  const normalized = String(valueRaw || '').trim();
  if (!normalized) return Buffer.alloc(0);
  const padded = normalized
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function parsePacket(raw: string): Packet | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 4) return null;

    const com = typeof parsed[0] === 'string' ? parsed[0] : '';
    const args = Array.isArray(parsed[1])
      ? parsed[1]
      : parsed[1] && typeof parsed[1] === 'object'
        ? parsed[1]
        : {};
    const senderId = typeof parsed[2] === 'string' ? parsed[2] : '';
    const recipientId = typeof parsed[3] === 'string' ? parsed[3] : '';
    const requestId = typeof parsed[4] === 'string' ? parsed[4] : undefined;

    if (!com || !senderId || !recipientId) return null;
    return [com, args, senderId, recipientId, requestId];
  } catch {
    return null;
  }
}

function parseMaxText(rawText: string) {
  const text = String(rawText || '');
  const splitAt = text.indexOf(' ');
  if (splitAt <= 0) return null;

  const recipientId = text.slice(0, splitAt).trim();
  const data = text.slice(splitAt + 1).trim();
  if (!recipientId || !data) return null;

  return {recipientId, data};
}

function decryptAesCompact(key: Buffer, compactRaw: string) {
  const compact = String(compactRaw || '').trim();
  const [ivPart, payloadPart] = compact.split('.', 2);
  if (!ivPart || !payloadPart) {
    throw new Error('reserve_invalid_aes_payload');
  }

  const iv = fromBase64Url(ivPart);
  const payload = fromBase64Url(payloadPart);

  if (iv.length !== 12 || payload.length < 17) {
    throw new Error('reserve_invalid_aes_payload');
  }

  const body = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(body),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

function encryptAesCompact(key: Buffer, text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(text, 'utf-8')),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, authTag]);

  return `${toBase64Url(iv)}.${toBase64Url(payload)}`;
}

function parseUserIdFromResultPacket(packet: Packet) {
  const [com, args] = packet;
  if (com !== RESULT_COMMAND) return 0;
  if (!Array.isArray(args)) return 0;

  const first = args[0] as any;
  if (!first || typeof first !== 'object') return 0;

  const userId = Number(first?.data?.user?.id || first?.user?.id || 0);
  if (!Number.isFinite(userId) || userId <= 0) return 0;
  return userId;
}

function parseLoginResultMeta(packet: Packet) {
  const userId = parseUserIdFromResultPacket(packet);
  if (!userId) return {ok: false as const};

  const [com, args] = packet;
  if (com !== RESULT_COMMAND || !Array.isArray(args)) return {ok: false as const};
  const first = args[0] as any;
  if (!first || typeof first !== 'object' || first.ok !== true) return {ok: false as const};

  return {
    ok: true as const,
    userId,
  };
}

function withMaxLoginData(packet: Packet, userId: number, maxSessionKeyBase64: string): Packet {
  const [com, args, senderId, recipientId, requestId] = packet;
  if (com !== RESULT_COMMAND || !Array.isArray(args) || args.length === 0) return packet;

  const firstRaw = args[0] as any;
  if (!firstRaw || typeof firstRaw !== 'object' || firstRaw.ok !== true) return packet;

  const dataRaw = firstRaw?.data && typeof firstRaw.data === 'object' ? firstRaw.data : {};
  const first = {
    ...firstRaw,
    data: {
      ...dataRaw,
      max: {
        userId: String(userId),
        maxSessionKey: maxSessionKeyBase64,
      },
    },
  };

  const nextArgs = [...args];
  nextArgs[0] = first;
  return [com, nextArgs, senderId, recipientId, requestId];
}

export class MaxReserveBridge {
  private readonly logger = new Logger('MaxReserveBridge');
  private readonly config: MaxReserveBridgeConfig;
  private readonly handlers: MaxReserveBridgeHandlers;

  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private pending = new Map<string, PendingOpcodeRequest>();
  private seq = 2;
  private cidNonce = 0;
  private connected = false;
  private lastConnectedAtMs = 0;
  private lastInboundAtMs = 0;
  private lastOutboundAtMs = 0;
  private lastError = '';

  private readonly loginSessionsByClientId = new Map<string, LoginSession>();
  private readonly clientIdByUserId = new Map<number, string>();
  private readonly maxSessionCacheByUserId = new Map<number, UserSessionKey>();
  private readonly seenUnhandledOpcodeKeys = new Set<string>();

  constructor(config: MaxReserveBridgeConfig, handlers: MaxReserveBridgeHandlers) {
    this.config = config;
    this.handlers = handlers;

    if (this.config.enabled) {
      void this.connect();
    }
  }

  dispose() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('reserve_disposed'));
    }
    this.pending.clear();

    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    this.connected = false;

    if (socket) {
      try {
        socket.removeAllListeners();
        socket.close();
      } catch {
        // ignore
      }
    }
  }

  bindClientToUser(clientIdRaw: string, userIdRaw: number) {
    const clientId = String(clientIdRaw || '').trim();
    const userId = Number(userIdRaw || 0);
    if (!clientId || !clientId.startsWith('_')) return;
    if (!Number.isFinite(userId) || userId <= 0) return;
    this.clientIdByUserId.set(userId, clientId);
  }

  getStatus(): MaxReserveBridgeStatus {
    return {
      enabled: this.config.enabled,
      connected: this.connected && this.socket?.readyState === WebSocket.OPEN,
      reconnectAttempt: this.reconnectAttempt,
      hasReconnectTimer: !!this.reconnectTimer,
      lastConnectedAtMs: this.lastConnectedAtMs,
      lastInboundAtMs: this.lastInboundAtMs,
      lastOutboundAtMs: this.lastOutboundAtMs,
      lastError: this.lastError,
    };
  }

  private nextCid() {
    this.cidNonce += 1;
    return -(Date.now() * 1000 + this.cidNonce);
  }

  private nextSeq() {
    const seq = this.seq;
    this.seq += 1;
    return seq;
  }

  private clearPending(reason: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (!this.config.enabled) return;
    if (this.reconnectTimer) return;

    const delay = Math.min(500 * (2 ** this.reconnectAttempt), 15000);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private expectOpcode(opcode: number, seq: number, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
      const key = `${opcode}:${seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`reserve_opcode_timeout:${opcode}`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(key, {
        opcode,
        seq,
        resolve,
        reject,
        timer,
      });
    });
  }

  private resolvePending(message: any) {
    const opcode = Number(message?.opcode || 0);
    const seq = Number(message?.seq || 0);
    if (!Number.isFinite(opcode) || !Number.isFinite(seq)) return false;

    const key = `${opcode}:${seq}`;
    const pending = this.pending.get(key);
    if (!pending) return false;

    this.pending.delete(key);
    clearTimeout(pending.timer);

    const cmd = Number(message?.cmd || 0);
    if (cmd === 3) {
      const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
      const errText = String(payload?.message || payload?.error || `reserve_opcode_error:${opcode}`).trim() || `reserve_opcode_error:${opcode}`;
      pending.reject(new Error(errText));
      return true;
    }

    pending.resolve(message);
    return true;
  }

  private async sendOpcode6() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('reserve_not_connected');
    }

    const seq = 0;
    const wait = this.expectOpcode(6, seq);

    this.socket.send(JSON.stringify({
      ver: 11,
      cmd: 0,
      seq,
      opcode: 6,
      payload: {
        userAgent: this.config.userAgent,
        deviceId: this.config.deviceId,
      },
    }));

    await wait;
    this.logger.log('MAX opcode 6 ok');
  }

  private async sendOpcode19() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('reserve_not_connected');
    }

    const seq = 1;
    const wait = this.expectOpcode(19, seq);

    this.socket.send(JSON.stringify({
      ver: 11,
      cmd: 0,
      seq,
      opcode: 19,
      payload: {
        token: this.config.token,
        chatsCount: 40,
        interactive: true,
        chatsSync: 0,
        contactsSync: 0,
        presenceSync: -1,
        draftsSync: 0,
      },
    }));

    await wait;
    this.logger.log('MAX opcode 19 ok');
  }

  async connect() {
    if (!this.config.enabled) return;
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(this.config.wsUrl, {
        headers: {
          Origin: 'https://web.max.ru',
          'User-Agent': this.config.userAgent.headerUserAgent,
        },
      });
      this.socket = socket;
      let settled = false;

      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        reject(error);
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        this.connectPromise = null;
        resolve();
      };

      socket.on('open', async () => {
        try {
          this.seq = 2;
          this.cidNonce = 0;
          await this.sendOpcode6();
          await this.sendOpcode19();
          this.reconnectAttempt = 0;
          this.connected = true;
          this.lastConnectedAtMs = Date.now();
          this.lastError = '';
          this.logger.log('MAX connected');
          resolveOnce();
        } catch (error: any) {
          this.connected = false;
          this.lastError = String(error?.message || error || 'unknown');
          this.logger.warn(`MAX handshake failed: ${String(error?.message || error || 'unknown')}`);
          rejectOnce(new Error('reserve_handshake_failed'));
          try {
            socket.close();
          } catch {
            // ignore
          }
        }
      });

      socket.on('message', (raw) => {
        this.lastInboundAtMs = Date.now();
        const text = raw.toString();
        let parsed: any = null;

        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }

        if (this.resolvePending(parsed)) return;

        const opcode = Number(parsed?.opcode || 0);
        const cmd = Number(parsed?.cmd || 0);
        if (opcode !== 64 && opcode !== 128) {
          const key = `${cmd}:${opcode}`;
          if (!this.seenUnhandledOpcodeKeys.has(key)) {
            this.seenUnhandledOpcodeKeys.add(key);
            this.logger.log(`MAX unhandled opcode cmd=${cmd} opcode=${opcode}`);
          }
          return;
        }

        const messageText = String(parsed?.payload?.message?.text || '').trim();
        if (!messageText) return;

        void this.onMaxText(messageText);
      });

      socket.on('error', (error) => {
        const message = String((error as any)?.message || 'socket_error');
        this.lastError = message;
        if (!settled) {
          rejectOnce(new Error(message));
        }
      });

      socket.on('close', () => {
        this.connected = false;
        this.clearPending('reserve_disconnected');
        this.socket = null;
        this.connectPromise = null;
        this.logger.warn('MAX disconnected');
        this.scheduleReconnect();
      });
    });

    try {
      await this.connectPromise;
    } catch {
      this.scheduleReconnect();
      throw new Error('reserve_connect_error');
    }
  }

  private decryptHandshakeKey(encryptedRaw: string): HandshakeKeyData {
    const encrypted = fromBase64Url(encryptedRaw);
    const decrypted = privateDecrypt({
      key: this.config.privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, encrypted);

    const payload = JSON.parse(decrypted.toString('utf-8')) as {
      clientId?: unknown;
      tmpSessionKey?: unknown;
      packet?: unknown;
    };

    const clientId = String(payload.clientId || '').trim();
    if (!clientId.startsWith('_')) {
      throw new Error('reserve_invalid_client_id');
    }

    const tmpSessionKey = Buffer.from(String(payload.tmpSessionKey || '').trim(), 'base64');
    if (tmpSessionKey.length !== 32) {
      throw new Error('reserve_invalid_tmp_session_key');
    }

    const result: HandshakeKeyData = {
      clientId,
      tmpSessionKey,
    };

    const packet = parsePacket(JSON.stringify(payload.packet));
    if (packet) {
      result.packet = packet;
    }

    return result;
  }

  private decryptHandshake(data: string) {
    const separatorIndex = data.indexOf(':');
    if (separatorIndex <= 0) {
      const handshake = this.decryptHandshakeKey(data);
      if (!handshake.packet) {
        throw new Error('reserve_invalid_packet');
      }
      return {
        clientId: handshake.clientId,
        tmpSessionKey: handshake.tmpSessionKey,
        packet: handshake.packet,
      };
    }

    const encryptedKey = data.slice(0, separatorIndex).trim();
    const encryptedPacket = data.slice(separatorIndex + 1).trim();
    if (!encryptedKey || !encryptedPacket) {
      throw new Error('reserve_invalid_handshake_payload');
    }

    const handshake = this.decryptHandshakeKey(encryptedKey);
    const decryptedPacket = decryptAesCompact(handshake.tmpSessionKey, encryptedPacket);
    const packet = parsePacket(decryptedPacket);
    if (!packet) {
      throw new Error('reserve_invalid_packet');
    }

    return {
      clientId: handshake.clientId,
      tmpSessionKey: handshake.tmpSessionKey,
      packet,
    };
  }

  private getCachedUserSessionKeys() {
    return Array.from(this.maxSessionCacheByUserId.values());
  }

  private parseDateMs(valueRaw: unknown) {
    if (valueRaw instanceof Date) return valueRaw.getTime();
    const text = String(valueRaw || '').trim();
    if (!text) return 0;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private hydrateSessionKey(userIdRaw: unknown, keyRaw: unknown, rotatedAtRaw: unknown): UserSessionKey | null {
    const userId = Number(userIdRaw || 0);
    if (!Number.isFinite(userId) || userId <= 0) return null;

    const keyText = String(keyRaw || '').trim();
    if (!keyText) return null;
    const maxSessionKey = Buffer.from(keyText, 'base64');
    if (maxSessionKey.length !== 32) return null;

    const rotatedAtMs = this.parseDateMs(rotatedAtRaw) || Date.now();
    const session = {
      userId,
      maxSessionKey,
      rotatedAtMs,
    };
    this.maxSessionCacheByUserId.set(userId, session);
    return session;
  }

  private async loadAllUserSessionKeysFromDb() {
    const rows = await db.$queryRawUnsafe<Array<{user_id: number; max_session_key: string; rotated_at: Date | string | null}>>(
      'select user_id, max_session_key, rotated_at from max_reserve_user_sessions',
    );

    for (const row of rows || []) {
      this.hydrateSessionKey(row.user_id, row.max_session_key, row.rotated_at);
    }

    return this.getCachedUserSessionKeys();
  }

  private async loadUserSessionKeyFromDb(userId: number) {
    const rows = await db.$queryRawUnsafe<Array<{user_id: number; max_session_key: string; rotated_at: Date | string | null}>>(
      'select user_id, max_session_key, rotated_at from max_reserve_user_sessions where user_id = $1 limit 1',
      userId,
    );

    const row = rows?.[0];
    if (!row) return null;
    return this.hydrateSessionKey(row.user_id, row.max_session_key, row.rotated_at);
  }

  private async upsertUserSessionKey(userId: number, maxSessionKey: Buffer, rotatedAtMs: number) {
    const rotatedAtIso = new Date(rotatedAtMs).toISOString();
    const maxSessionKeyBase64 = maxSessionKey.toString('base64');

    await db.$executeRawUnsafe(
      `insert into max_reserve_user_sessions (user_id, max_session_key, rotated_at, created_at, updated_at)
       values ($1, $2, $3::timestamptz, now(), now())
       on conflict (user_id)
       do update set max_session_key = excluded.max_session_key, rotated_at = excluded.rotated_at, updated_at = now()`,
      userId,
      maxSessionKeyBase64,
      rotatedAtIso,
    );

    const session = {
      userId,
      maxSessionKey,
      rotatedAtMs,
    };
    this.maxSessionCacheByUserId.set(userId, session);
    return session;
  }

  private async getOrRotateUserSessionKey(userIdRaw: number) {
    const userId = Number(userIdRaw || 0);
    if (!Number.isFinite(userId) || userId <= 0) return null;

    const now = Date.now();
    let session = this.maxSessionCacheByUserId.get(userId) || null;
    if (!session) {
      session = await this.loadUserSessionKeyFromDb(userId);
    }

    if (session && now - session.rotatedAtMs < MAX_SESSION_TTL_MS) {
      return session;
    }

    const nextKey = randomBytes(32);
    return this.upsertUserSessionKey(userId, nextKey, now);
  }

  private async getUserSessionKey(userIdRaw: number) {
    const userId = Number(userIdRaw || 0);
    if (!Number.isFinite(userId) || userId <= 0) return null;

    const cached = this.maxSessionCacheByUserId.get(userId);
    if (cached) return cached;
    return this.loadUserSessionKeyFromDb(userId);
  }

  private tryDecodeAesWithSession(data: string, session: UserSessionKey) {
    try {
      const decrypted = decryptAesCompact(session.maxSessionKey, data);
      const packet = parsePacket(decrypted);
      if (!packet) return null;

      const senderId = String(packet[2] || '').trim();
      const recipientId = String(packet[3] || '').trim();
      if (senderId !== String(session.userId) || recipientId !== BACKEND_RECIPIENT_ID) {
        return null;
      }

      return {
        userId: session.userId,
        packet,
      };
    } catch {
      return null;
    }
  }

  private async decodeInboundAes(data: string) {
    const candidates = this.getCachedUserSessionKeys();
    for (const session of candidates) {
      const decoded = this.tryDecodeAesWithSession(data, session);
      if (decoded) return decoded;
    }

    const rows = await this.loadAllUserSessionKeysFromDb();
    for (const session of rows) {
      const decoded = this.tryDecodeAesWithSession(data, session);
      if (decoded) return decoded;
    }

    throw new Error('reserve_unknown_sender_key');
  }

  private async onMaxText(text: string) {
    const parsed = parseMaxText(text);
    if (!parsed) return;

    this.logger.log('MAX received text');

    const recipientId = parsed.recipientId;
    if (recipientId !== BACKEND_RECIPIENT_ID) {
      return;
    }

    try {
      if (parsed.data.includes(':') || !parsed.data.includes('.')) {
        const handshake = this.decryptHandshake(parsed.data);
        this.loginSessionsByClientId.set(handshake.clientId, {
          clientId: handshake.clientId,
          tmpSessionKey: handshake.tmpSessionKey,
        });

        this.logger.log(`MAX decoded recipientId=${recipientId} sender=${handshake.clientId}`);
        this.logger.log('MAX decrypt ok');

        await this.handlers.onPacket({
          clientId: handshake.clientId,
          packet: handshake.packet,
        });
        this.logger.log(`MAX dispatched command=${handshake.packet[0]}`);
        return;
      }

      const decoded = await this.decodeInboundAes(parsed.data);
      const clientId = this.clientIdByUserId.get(decoded.userId) || `_${decoded.userId}`;

      this.logger.log(`MAX decoded recipientId=${recipientId} sender=${decoded.userId}`);
      this.logger.log('MAX decrypt ok');

      await this.handlers.onPacket({
        clientId,
        packet: decoded.packet,
      });
      this.logger.log(`MAX dispatched command=${decoded.packet[0]}`);
    } catch (error: any) {
      this.logger.warn(`MAX decrypt error: ${String(error?.message || error || 'unknown')}`);
    }
  }

  async sendPacket(packetRaw: Packet) {
    try {
      if (!this.config.enabled) return;
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.logger.warn('MAX send skipped: not connected');
        return;
      }

      const recipientId = String(packetRaw[3] || '').trim();
      if (!recipientId) return;

      let packet = packetRaw;
      let encryptKey: Buffer | null = null;

      if (recipientId.startsWith('_')) {
        const loginSession = this.loginSessionsByClientId.get(recipientId);
        if (!loginSession) {
          this.logger.warn(`MAX send skipped: no tmp session for recipient=${recipientId}`);
          return;
        }

        const loginMeta = parseLoginResultMeta(packetRaw);
        if (loginMeta.ok) {
          const userSession = await this.getOrRotateUserSessionKey(loginMeta.userId);
          if (userSession) {
            packet = withMaxLoginData(packetRaw, loginMeta.userId, userSession.maxSessionKey.toString('base64'));
            this.bindClientToUser(recipientId, loginMeta.userId);
          }
        }

        encryptKey = loginSession.tmpSessionKey;
      } else {
        const userId = Number(recipientId || 0);
        if (!Number.isFinite(userId) || userId <= 0) {
          this.logger.warn(`MAX send skipped: invalid recipient=${recipientId}`);
          return;
        }

        const session = await this.getUserSessionKey(userId);
        if (!session) {
          this.logger.warn(`MAX send skipped: no key for recipient=${recipientId}`);
          return;
        }
        encryptKey = session.maxSessionKey;
      }

      if (!encryptKey || encryptKey.length !== 32) {
        this.logger.warn(`MAX send skipped: invalid key for recipient=${recipientId}`);
        return;
      }

      const encryptedPacket = encryptAesCompact(encryptKey, JSON.stringify(packet));
      const textPayload = `${recipientId} ${encryptedPacket}`;

      const seq = this.nextSeq();

      this.socket.send(JSON.stringify({
        ver: 11,
        cmd: 0,
        seq,
        opcode: 64,
        payload: {
          chatId: this.config.chatId,
          message: {
            text: textPayload,
            cid: this.nextCid(),
            elements: [],
            attaches: [],
          },
          notify: true,
        },
      }));
      this.lastOutboundAtMs = Date.now();

      this.logger.log(`MAX send text recipient=${recipientId}`);
      this.logger.log('MAX response sent');
    } catch (error: any) {
      this.logger.warn(`MAX send error: ${String(error?.message || error || 'unknown')}`);
    }
  }
}

export type {MaxReserveBridgeConfig, MaxReserveBridgeStatus};
