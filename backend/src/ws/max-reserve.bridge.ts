import {Logger} from '@nestjs/common';
import {constants, createCipheriv, createDecipheriv, privateDecrypt, randomBytes} from 'node:crypto';
import {WebSocket} from 'ws';
import {db} from '../db.js';
import {RESULT_COMMAND, type Packet} from './protocol.js';
import {
  buildMaxReserveTextFrames,
  MaxChunkAssembler,
  parseMaxReserveData,
} from './max-reserve-chunk-codec.js';

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
  chunkTextLimit: number;
  channelRotationEnabled: boolean;
  channelRotationMinutes: number;
  channelSwitchOverlapMs: number;
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
  currentTransportChatId: number;
  previousTransportChatIds: number[];
  lastConnectedAtMs: number;
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
  lastError: string;
};

const BACKEND_RECIPIENT_ID = '0';
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHUNK_SEND_DELAY_MS = 120;
const MAX_PREVIOUS_CHAT_IDS_LIMIT = 8;

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

function waitMs(msRaw: number) {
  const ms = Number(msRaw || 0);
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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

function extractMaxMessageText(parsed: any) {
  const payload = parsed?.payload;
  if (!payload || typeof payload !== 'object') return '';
  const variants = [
    payload?.message?.text,
    payload?.messages?.[0]?.text,
    payload?.chat?.message?.text,
    payload?.event?.message?.text,
    payload?.events?.[0]?.message?.text,
  ];
  for (const variant of variants) {
    const text = String(variant || '').trim();
    if (text) return text;
  }
  return '';
}

function extractMaxChatId(parsed: any) {
  const payload = parsed?.payload;
  if (!payload || typeof payload !== 'object') return 0;
  const candidates = [
    payload?.chatId,
    payload?.chat?.id,
    payload?.message?.chatId,
    payload?.messages?.[0]?.chatId,
    payload?.messages?.[0]?.chat?.id,
    payload?.event?.chat?.id,
    payload?.events?.[0]?.chat?.id,
  ];
  for (const candidate of candidates) {
    const chatId = Number(candidate || 0);
    if (Number.isFinite(chatId) && chatId !== 0) return chatId;
  }
  return 0;
}

function isSyncChannelTitle(titleRaw: unknown) {
  const title = String(titleRaw || '').trim().toLowerCase();
  return title.startsWith('sync-');
}

function extractSyncChatIdFromNode(node: any, depth = 0): number {
  if (!node || depth > 8) return 0;

  if (Array.isArray(node)) {
    for (const item of node) {
      const chatId = extractSyncChatIdFromNode(item, depth + 1);
      if (chatId) return chatId;
    }
    return 0;
  }

  if (typeof node !== 'object') return 0;

  const title = String((node as any)?.title || '').trim();
  if (title && isSyncChannelTitle(title)) {
    const idCandidates = [
      (node as any)?.id,
      (node as any)?.chatId,
      (node as any)?.chat_id,
    ];
    for (const candidate of idCandidates) {
      const chatId = Number(candidate || 0);
      if (Number.isFinite(chatId) && chatId !== 0) return chatId;
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    const chatId = extractSyncChatIdFromNode(value, depth + 1);
    if (chatId) return chatId;
  }

  return 0;
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
  private lastNegativeCid = 0;
  private currentTransportChatId = 0;
  private hasResolvedTransportChat = false;
  private previousTransportChatIds: number[] = [];
  private readonly previousTransportChatIdUntilMs = new Map<number, number>();
  private channelRotationTimer: NodeJS.Timeout | null = null;
  private channelRotationInFlight = false;
  private lastForcedRotationAtMs = 0;
  private connected = false;
  private lastConnectedAtMs = 0;
  private lastInboundAtMs = 0;
  private lastOutboundAtMs = 0;
  private lastError = '';

  private readonly loginSessionsByClientId = new Map<string, LoginSession>();
  private readonly clientIdByUserId = new Map<number, string>();
  private readonly maxSessionCacheByUserId = new Map<number, UserSessionKey>();
  private readonly seenUnhandledOpcodeKeys = new Set<string>();
  private readonly chunkAssembler = new MaxChunkAssembler();

  constructor(config: MaxReserveBridgeConfig, handlers: MaxReserveBridgeHandlers) {
    this.config = config;
    this.handlers = handlers;
    this.currentTransportChatId = Number(config.chatId || 0);
    this.hasResolvedTransportChat = this.currentTransportChatId !== 0;

    if (this.config.enabled) {
      this.scheduleChannelRotation();
      void this.connect();
    }
  }

  dispose() {
    if (this.channelRotationTimer) {
      clearInterval(this.channelRotationTimer);
      this.channelRotationTimer = null;
    }

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

  private scheduleChannelRotation() {
    if (!this.config.channelRotationEnabled) return;
    if (this.channelRotationTimer) return;
    const minutes = Math.max(1, Number(this.config.channelRotationMinutes || 60));
    const intervalMs = minutes * 60 * 1000;
    this.logger.log(`MAX channel rotation scheduled interval=${minutes}m`);
    this.channelRotationTimer = setInterval(() => {
      void this.rotateTransportChannel('scheduled');
    }, intervalMs);
    this.channelRotationTimer.unref?.();
  }

  getStatus(): MaxReserveBridgeStatus {
    this.cleanupExpiredPreviousTransportChatIds();
    return {
      enabled: this.config.enabled,
      connected: this.connected && this.socket?.readyState === WebSocket.OPEN,
      reconnectAttempt: this.reconnectAttempt,
      hasReconnectTimer: !!this.reconnectTimer,
      currentTransportChatId: this.currentTransportChatId,
      previousTransportChatIds: [...this.previousTransportChatIds],
      lastConnectedAtMs: this.lastConnectedAtMs,
      lastInboundAtMs: this.lastInboundAtMs,
      lastOutboundAtMs: this.lastOutboundAtMs,
      lastError: this.lastError,
    };
  }

  private nextCid() {
    const nowNegative = -Date.now();
    if (nowNegative < this.lastNegativeCid) {
      this.lastNegativeCid = nowNegative;
      return this.lastNegativeCid;
    }
    this.lastNegativeCid -= 1;
    return this.lastNegativeCid;
  }

  private nextSeq() {
    const seq = this.seq;
    this.seq += 1;
    return seq;
  }

  private cleanupExpiredPreviousTransportChatIds() {
    if (!this.previousTransportChatIds.length) return;
    const now = Date.now();
    const next: number[] = [];
    for (const chatId of this.previousTransportChatIds) {
      const untilMs = Number(this.previousTransportChatIdUntilMs.get(chatId) || 0);
      if (untilMs > now) {
        next.push(chatId);
        continue;
      }
      this.previousTransportChatIdUntilMs.delete(chatId);
    }
    this.previousTransportChatIds = next.slice(-MAX_PREVIOUS_CHAT_IDS_LIMIT);
  }

  private rememberPreviousTransportChatId(chatIdRaw: number) {
    const chatId = Number(chatIdRaw || 0);
    if (!Number.isFinite(chatId) || chatId === 0) return;
    const untilMs = Date.now() + Math.max(30_000, Number(this.config.channelSwitchOverlapMs || 120_000));
    this.previousTransportChatIdUntilMs.set(chatId, untilMs);
    this.previousTransportChatIds = [
      ...this.previousTransportChatIds.filter((item) => item !== chatId),
      chatId,
    ].slice(-MAX_PREVIOUS_CHAT_IDS_LIMIT);
    this.cleanupExpiredPreviousTransportChatIds();
  }

  private isAcceptedInboundChatId(chatIdRaw: number) {
    const chatId = Number(chatIdRaw || 0);
    if (!Number.isFinite(chatId) || chatId === 0) return false;
    if (chatId === this.currentTransportChatId) return true;
    this.cleanupExpiredPreviousTransportChatIds();
    return this.previousTransportChatIds.includes(chatId);
  }

  private getOutboundChatId() {
    const currentChatId = Number(this.currentTransportChatId || 0);
    if (Number.isFinite(currentChatId) && currentChatId !== 0) return currentChatId;
    return 0;
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

    const response: any = await wait;
    const syncChatId = extractSyncChatIdFromNode(response?.payload || null);
    if (syncChatId) {
      this.currentTransportChatId = syncChatId;
      this.hasResolvedTransportChat = true;
      this.logger.log(`MAX sync chat selected chatId=${syncChatId}`);
    }
    this.logger.log('MAX opcode 19 ok');
  }

  private async ensureTransportChatReady() {
    const current = Number(this.currentTransportChatId || 0);
    if (this.hasResolvedTransportChat && Number.isFinite(current) && current !== 0) return true;
    try {
      const chatId = await this.createTransportChannel();
      this.currentTransportChatId = chatId;
      this.hasResolvedTransportChat = true;
      this.logger.log(`MAX sync chat bootstrap created chatId=${chatId}`);
      return true;
    } catch (error: any) {
      this.logger.warn(`MAX sync chat bootstrap failed ${String(error?.message || error || 'unknown')}`);
      return false;
    }
  }

  private async createTransportChannel() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('reserve_not_connected');
    }

    this.logger.log('MAX channel create start');
    const seq = this.nextSeq();
    const wait = this.expectOpcode(64, seq, 10000);
    const title = `sync-${Date.now()}`;

    this.socket.send(JSON.stringify({
      ver: 11,
      cmd: 0,
      seq,
      opcode: 64,
      payload: {
        message: {
          text: '',
          cid: this.nextCid(),
          elements: [],
          attaches: [
            {
              _type: 'CONTROL',
              event: 'new',
              chatType: 'CHANNEL',
              access: 'PRIVATE',
              title,
              userIds: [],
            },
          ],
        },
        notify: false,
      },
    }));

    const response: any = await wait;
    const chatId = Number(response?.payload?.chat?.id || 0);
    if (!Number.isFinite(chatId) || chatId === 0) {
      throw new Error('reserve_channel_create_invalid_chat_id');
    }
    this.logger.log(`MAX channel create ok chatId=${chatId}`);
    return chatId;
  }

  private async cleanupTransportChannel(chatIdRaw: number) {
    const chatId = Number(chatIdRaw || 0);
    if (!Number.isFinite(chatId) || chatId === 0) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;

    this.logger.log(`MAX channel cleanup old=${chatId}`);
    try {
      this.socket.send(JSON.stringify({
        ver: 11,
        cmd: 0,
        seq: this.nextSeq(),
        opcode: 54,
        payload: {
          chatId,
          forAll: false,
          lastEventTime: Date.now(),
        },
      }));

      this.socket.send(JSON.stringify({
        ver: 11,
        cmd: 0,
        seq: this.nextSeq(),
        opcode: 48,
        payload: {
          chatIds: [chatId],
        },
      }));
    } catch (error: any) {
      this.logger.warn(`MAX channel cleanup error old=${chatId} ${String(error?.message || error || 'unknown')}`);
    }
  }

  private triggerRotationOnSendLimit() {
    const now = Date.now();
    const minGapMs = 30_000;
    if (this.channelRotationInFlight) return;
    if (now - this.lastForcedRotationAtMs < minGapMs) return;
    this.lastForcedRotationAtMs = now;
    void this.rotateTransportChannel('send-limit');
  }

  private async sendChannelSwitchEventViaOldChat(oldChatId: number, newChatId: number) {
    const userIds = Array.from(this.clientIdByUserId.keys())
      .map((value) => Number(value || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!userIds.length) return;

    const packets = userIds.map((userId) => this.sendPacket(
      ['max:channel-switch', {chatId: newChatId}, 'backend', String(userId), undefined],
      oldChatId,
    ));

    await Promise.allSettled(packets);
    this.logger.log(`MAX channel switch event sent to users count=${userIds.length}`);
  }

  async rotateTransportChannel(reason = 'manual') {
    if (!this.config.enabled) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.channelRotationInFlight) return;
    this.channelRotationInFlight = true;

    const oldChatId = this.getOutboundChatId();
    try {
      const newChatId = await this.createTransportChannel();
      if (newChatId === oldChatId) return;

      this.currentTransportChatId = newChatId;
      this.hasResolvedTransportChat = true;
      this.rememberPreviousTransportChatId(oldChatId);
      this.logger.log(`MAX channel switch old=${oldChatId} new=${newChatId} reason=${reason}`);
      await this.sendChannelSwitchEventViaOldChat(oldChatId, newChatId);

      const cleanupDelayMs = Math.max(30_000, Number(this.config.channelSwitchOverlapMs || 120_000));
      setTimeout(() => {
        void this.cleanupTransportChannel(oldChatId);
      }, cleanupDelayMs).unref?.();
    } catch (error: any) {
      this.logger.warn(`MAX channel rotation error reason=${reason} ${String(error?.message || error || 'unknown')}`);
    } finally {
      this.channelRotationInFlight = false;
    }
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
          this.lastNegativeCid = 0;
          await this.sendOpcode6();
          await this.sendOpcode19();
          const chatReady = await this.ensureTransportChatReady();
          if (!chatReady) {
            throw new Error('reserve_sync_chat_not_ready');
          }
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
        if (cmd === 3 && opcode === 64) {
          const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
          const message = String(payload?.message || payload?.error || 'reserve_opcode64_error').trim() || 'reserve_opcode64_error';
          this.logger.warn(`MAX opcode 64 error: ${message}`);
          if (message.includes('errors.send-message.too-many-total-messages-to-user')) {
            this.triggerRotationOnSendLimit();
          }
          return;
        }
        if (opcode !== 64 && opcode !== 128) {
          const key = `${cmd}:${opcode}`;
          if (!this.seenUnhandledOpcodeKeys.has(key)) {
            this.seenUnhandledOpcodeKeys.add(key);
            this.logger.log(`MAX unhandled opcode cmd=${cmd} opcode=${opcode}`);
          }
          return;
        }

        const messageText = extractMaxMessageText(parsed);
        if (!messageText) return;
        const inboundChatId = extractMaxChatId(parsed);
        void this.onMaxText(messageText, inboundChatId);
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

  private async onMaxText(text: string, chatIdRaw = 0) {
    const parsed = parseMaxText(text);
    if (!parsed) return;

    const chatId = Number(chatIdRaw || 0);
    if (!this.isAcceptedInboundChatId(chatId)) {
      return;
    }

    this.logger.log('MAX received text');

    const recipientId = parsed.recipientId;
    if (recipientId !== BACKEND_RECIPIENT_ID) {
      return;
    }

    const parsedData = parseMaxReserveData(parsed.data);
    if (!parsedData) return;

    let payload = '';
    if (parsedData.kind === 'chunk') {
      this.logger.log(`MAX chunk received chunkId=${parsedData.chunkId} index=${parsedData.index} total=${parsedData.total} recipient=${recipientId}`);
      const assembled = this.chunkAssembler.push(recipientId, parsedData);
      if (!assembled) return;
      payload = assembled;
      this.logger.log(`MAX chunk assembled chunkId=${parsedData.chunkId} total=${parsedData.total} recipient=${recipientId}`);
    } else {
      payload = parsedData.payload;
    }

    try {
      if (payload.includes(':') || !payload.includes('.')) {
        const handshake = this.decryptHandshake(payload);
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

      const decoded = await this.decodeInboundAes(payload);
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

  async sendPacket(packetRaw: Packet, forceChatIdRaw?: number) {
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

      const transportChatId = (() => {
        const forced = Number(forceChatIdRaw || 0);
        if (Number.isFinite(forced) && forced !== 0) return forced;
        return this.getOutboundChatId();
      })();
      if (!Number.isFinite(transportChatId) || transportChatId === 0) {
        this.logger.warn('MAX send skipped: invalid transport chatId');
        return;
      }

      const encryptedPacket = encryptAesCompact(encryptKey, JSON.stringify(packet));
      const frames = buildMaxReserveTextFrames(recipientId, encryptedPacket, this.config.chunkTextLimit);
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        const seq = this.nextSeq();
        this.socket.send(JSON.stringify({
          ver: 11,
          cmd: 0,
          seq,
          opcode: 64,
          payload: {
            chatId: transportChatId,
            message: {
              text: frame.text,
              cid: this.nextCid(),
              elements: [],
              attaches: [],
            },
            notify: true,
          },
        }));
        this.lastOutboundAtMs = Date.now();

        if (frame.kind === 'chunk') {
          this.logger.log(`MAX chunk send chunkId=${frame.chunkId} index=${frame.index} total=${frame.total} recipient=${recipientId}`);
        }

        const hasMoreFrames = index < frames.length - 1;
        if (hasMoreFrames && frames.length > 1) {
          await waitMs(MAX_CHUNK_SEND_DELAY_MS);
        }
      }

      this.logger.log(`MAX send text recipient=${recipientId}`);
      this.logger.log('MAX response sent');
    } catch (error: any) {
      this.logger.warn(`MAX send error: ${String(error?.message || error || 'unknown')}`);
    }
  }
}

export type {MaxReserveBridgeConfig, MaxReserveBridgeStatus};
