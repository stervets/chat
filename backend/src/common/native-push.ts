import {Injectable, Logger} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {db} from '../db.js';
import {config} from '../config.js';
import type {RoomRow} from './rooms.js';
import type {ChatContextMessagePayload} from '../ws/chat/chat-context.js';

type NativePushRegisterResult =
  | {ok: true}
  | {ok: false; error: 'push_disabled' | 'invalid_token' | 'invalid_platform' | 'invalid_provider'};

type NativePushTokenRow = {
  id: number;
  userId: number;
  provider: string;
  platform: string;
  token: string;
};

type SendNativeChatPushParams = {
  room: RoomRow;
  message: ChatContextMessagePayload;
  senderId: number;
  excludeUserIds?: number[];
};

type SendNativeCallPushParams = {
  room: RoomRow;
  call: {
    callId: string;
    roomId: number;
    callerUserId: number;
    calleeUserId: number;
  };
  caller: {
    id: number;
    nickname: string;
    name: string;
  };
  excludeUserIds?: number[];
};

type RuStoreSendMessage = {
  title: string;
  body: string;
  type: 'message' | 'call';
  roomId: string;
  messageId?: string;
  callId?: string;
};

type RuStoreSendResponse = {
  status?: string;
  errors?: string[];
};

const RUSTORE_PROVIDER = 'rustore';
const ANDROID_PLATFORM = 'android';
const RUSTORE_PUSH_API_URL = 'https://vkpns-universal.rustore.ru/v1/send';
const MESSAGE_CHANNEL_ID = 'marx-messages';
const CALL_CHANNEL_ID = 'marx-calls';
const MAX_TOKENS_PER_USER = 3;

function stringValue(value: unknown) {
  return String(value || '').trim();
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function shortToken(tokenRaw: unknown) {
  const token = stringValue(tokenRaw);
  if (!token) return 'empty';
  if (token.length <= 14) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function buildMessagePreview(rawTextRaw: unknown) {
  const normalized = String(rawTextRaw || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Новое сообщение';
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

function resolveRoomTitle(room: RoomRow) {
  if (room.kind === 'direct') return 'MARX';
  if (room.kind === 'comment') return 'Комментарии';
  if (room.kind === 'game') return room.title || 'Игра';
  return room.title || 'Комната';
}

function resolveProviderErrorText(response: RuStoreSendResponse | null) {
  const errors = Array.isArray(response?.errors) ? response?.errors : [];
  return errors.map((entry) => stringValue(entry)).filter(Boolean).join(' | ');
}

function isRuStorePushEnabled() {
  return config.nativePush.enabled
    && config.nativePush.provider === RUSTORE_PROVIDER
    && !!config.nativePush.rustoreProjectId
    && !!config.nativePush.rustoreServiceToken;
}

@Injectable()
export class NativePushService {
  private readonly logger = new Logger(NativePushService.name);
  private readonly enabled: boolean;
  private missingTableWarned = false;

  constructor() {
    this.enabled = isRuStorePushEnabled();
    if (config.nativePush.enabled && !this.enabled) {
      this.logger.warn('Native push disabled: rustoreProjectId or rustoreServiceToken is empty');
    }
  }

  async registerToken(userId: number, tokenRaw: unknown, providerRaw: unknown, platformRaw: unknown): Promise<NativePushRegisterResult> {
    if (!this.enabled) return {ok: false, error: 'push_disabled'};

    const token = stringValue(tokenRaw);
    const provider = stringValue(providerRaw).toLowerCase() || RUSTORE_PROVIDER;
    const platform = stringValue(platformRaw).toLowerCase() || ANDROID_PLATFORM;
    if (!token) return {ok: false, error: 'invalid_token'};
    if (provider !== RUSTORE_PROVIDER) return {ok: false, error: 'invalid_provider'};
    if (platform !== ANDROID_PLATFORM) return {ok: false, error: 'invalid_platform'};

    const now = new Date();
    const upserted = await this.withMissingTableGuard(() => db.nativePushToken.upsert({
      where: {
        provider_token: {
          provider,
          token,
        },
      },
      update: {
        userId,
        provider,
        platform,
        lastSeenAt: now,
      },
      create: {
        userId,
        provider,
        platform,
        token,
        lastSeenAt: now,
      },
    }));
    if (!upserted) return {ok: false, error: 'push_disabled'};
    await this.pruneUserTokens(userId, provider, platform);

    this.logger.log(`RuStore token upsert userId=${userId} token=${shortToken(token)}`);
    return {ok: true};
  }

  async unregisterToken(userId: number, tokenRaw: unknown, providerRaw: unknown, platformRaw: unknown) {
    const token = stringValue(tokenRaw);
    const provider = stringValue(providerRaw).toLowerCase() || RUSTORE_PROVIDER;
    const platform = stringValue(platformRaw).toLowerCase() || ANDROID_PLATFORM;
    if (!token) return {ok: false, error: 'invalid_token'} as const;
    if (provider !== RUSTORE_PROVIDER) return {ok: false, error: 'invalid_provider'} as const;
    if (platform !== ANDROID_PLATFORM) return {ok: false, error: 'invalid_platform'} as const;

    const result = await this.withMissingTableGuard(() => db.nativePushToken.deleteMany({
      where: {
        userId,
        provider,
        platform,
        token,
      },
    }));
    if (!result) return {ok: true, removed: 0} as const;

    this.logger.log(`RuStore token remove userId=${userId} token=${shortToken(token)} removed=${result.count}`);
    return {ok: true, removed: result.count} as const;
  }

  async sendChatMessagePush(params: SendNativeChatPushParams) {
    if (!this.enabled) return;

    const senderId = positiveNumber(params.senderId);
    const authorId = positiveNumber(params.message.authorId);
    const excluded = new Set<number>(
      Array.isArray(params.excludeUserIds)
        ? params.excludeUserIds.map((value) => positiveNumber(value)).filter(Boolean)
        : [],
    );
    if (senderId) excluded.add(senderId);
    if (authorId) excluded.add(authorId);

    const recipientUserIds = params.room.member_user_ids.filter((userId) => !excluded.has(userId));
    if (!recipientUserIds.length) return;

    const title = params.room.kind === 'direct'
      ? stringValue(params.message.authorName || params.message.authorNickname || 'MARX') || 'MARX'
      : resolveRoomTitle(params.room);
    const body = params.room.kind === 'direct'
      ? buildMessagePreview(params.message.rawText)
      : `${stringValue(params.message.authorName || params.message.authorNickname || 'Кто-то') || 'Кто-то'}: ${buildMessagePreview(params.message.rawText)}`;

    await this.sendToUsers(recipientUserIds, {
      type: 'message',
      title,
      body,
      roomId: String(params.message.roomId),
      messageId: String(params.message.id),
    });
  }

  async sendIncomingCallPush(params: SendNativeCallPushParams) {
    if (!this.enabled) return;

    const calleeUserId = positiveNumber(params.call.calleeUserId);
    const callerUserId = positiveNumber(params.call.callerUserId);
    if (!calleeUserId || !callerUserId) return;

    const excluded = new Set<number>(
      Array.isArray(params.excludeUserIds)
        ? params.excludeUserIds.map((value) => positiveNumber(value)).filter(Boolean)
        : [],
    );
    excluded.add(callerUserId);
    if (excluded.has(calleeUserId)) return;

    const callerName = stringValue(params.caller.name || params.caller.nickname || resolveRoomTitle(params.room)) || 'MARX';
    await this.sendToUsers([calleeUserId], {
      type: 'call',
      title: 'Входящий звонок',
      body: callerName,
      roomId: String(params.call.roomId),
      callId: String(params.call.callId),
    });
  }

  private async sendToUsers(userIds: number[], message: RuStoreSendMessage) {
    const tokens = await this.findTokensByUserIds(userIds);
    if (!tokens.length) return;

    for (const tokenRow of tokens) {
      await this.sendRuStorePush(tokenRow, message);
    }
  }

  private async sendRuStorePush(tokenRow: NativePushTokenRow, message: RuStoreSendMessage) {
    try {
      const response = await fetch(RUSTORE_PUSH_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          providers: {
            rustore: {
              project_id: config.nativePush.rustoreProjectId,
              auth_token: config.nativePush.rustoreServiceToken,
            },
          },
          tokens: {
            rustore: [tokenRow.token],
          },
          message: {
            data: {
              provider: RUSTORE_PROVIDER,
              platform: ANDROID_PLATFORM,
              type: message.type,
              title: message.title,
              body: message.body,
              roomId: message.roomId,
              messageId: message.messageId || '',
              callId: message.callId || '',
              channelId: message.type === 'call' ? CALL_CHANNEL_ID : MESSAGE_CHANNEL_ID,
            },
          },
        }),
      });

      const payload = await this.readRuStoreResponse(response);
      if (response.ok) {
        await this.withMissingTableGuard(() => db.nativePushToken.update({
          where: {
            id: tokenRow.id,
          },
          data: {
            lastSeenAt: new Date(),
          },
        }));
        return;
      }

      const providerErrorText = resolveProviderErrorText(payload);
      const invalidToken = providerErrorText.toLowerCase().includes('invalid tokens')
        || providerErrorText.toLowerCase().includes('entity was not found');

      this.logger.warn(
        `RuStore push failed userId=${tokenRow.userId} token=${shortToken(tokenRow.token)} status=${response.status} error="${providerErrorText || payload?.status || 'unknown'}" invalid=${invalidToken}`,
      );

      if (invalidToken) {
        await this.withMissingTableGuard(() => db.nativePushToken.deleteMany({
          where: {
            id: tokenRow.id,
          },
        }));
      }
    } catch (error: any) {
      this.logger.warn(
        `RuStore push transport failed userId=${tokenRow.userId} token=${shortToken(tokenRow.token)} error="${String(error?.message || error || 'unknown_error').replace(/\s+/g, ' ').trim()}"`,
      );
    }
  }

  private async readRuStoreResponse(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as RuStoreSendResponse;
    } catch {
      return {
        status: text,
        errors: [],
      } satisfies RuStoreSendResponse;
    }
  }

  private async findTokensByUserIds(userIds: number[]) {
    const rows = await this.withMissingTableGuard(() => db.nativePushToken.findMany({
      where: {
        provider: RUSTORE_PROVIDER,
        platform: ANDROID_PLATFORM,
        userId: {
          in: userIds,
        },
      },
      select: {
        id: true,
        userId: true,
        provider: true,
        platform: true,
        token: true,
        updatedAt: true,
      },
      orderBy: [
        {userId: 'asc'},
        {updatedAt: 'desc'},
      ],
    })) as Array<NativePushTokenRow & {updatedAt: Date}> | null;
    if (!rows?.length) return [];

    const perUserTokenCounter = new Map<number, number>();
    const filtered: NativePushTokenRow[] = [];

    for (const row of rows) {
      const currentCount = perUserTokenCounter.get(row.userId) || 0;
      if (currentCount >= MAX_TOKENS_PER_USER) continue;
      perUserTokenCounter.set(row.userId, currentCount + 1);
      filtered.push({
        id: row.id,
        userId: row.userId,
        provider: row.provider,
        platform: row.platform,
        token: row.token,
      });
    }

    return filtered;
  }

  private async pruneUserTokens(userId: number, provider: string, platform: string) {
    const rows = await this.withMissingTableGuard(() => db.nativePushToken.findMany({
      where: {
        userId,
        provider,
        platform,
      },
      select: {
        id: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }));
    if (!rows?.length) return;

    if (rows.length <= MAX_TOKENS_PER_USER) return;
    const staleRows = rows.slice(MAX_TOKENS_PER_USER);
    await this.withMissingTableGuard(() => db.nativePushToken.deleteMany({
      where: {
        id: {
          in: staleRows.map((row) => row.id),
        },
      },
    }));
    this.logger.log(`RuStore token prune userId=${userId} removed=${staleRows.length}`);
  }

  private async withMissingTableGuard<T>(run: () => Promise<T>) {
    try {
      return await run();
    } catch (error: any) {
      if (this.isMissingNativePushTableError(error)) {
        if (!this.missingTableWarned) {
          this.missingTableWarned = true;
          this.logger.warn('Native push disabled for current DB: table native_push_tokens is missing');
        }
        return null;
      }
      throw error;
    }
  }

  private isMissingNativePushTableError(error: any) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2021') return false;
    const metaTable = String((error.meta as any)?.table || '').toLowerCase();
    return metaTable.includes('native_push_tokens');
  }
}
