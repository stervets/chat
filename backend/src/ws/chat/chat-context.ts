import {Prisma} from '@prisma/client';
import {db} from '../../db.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {isValidNickname, normalizeNickname} from '../../common/nickname.js';
import {
  compileMessageFormat,
  extractMessageFormatTokens,
  type CompileMessageFormatOptions,
  type MessageLinkPreview,
} from '../../common/message-format.js';
import {ensureUserInGroupRooms, getOrCreateDirectRoom} from '../../common/rooms.js';
import {deleteUploadFile, sanitizeUploadName} from '../../common/uploads.js';
import {
  findCommentRoomNodeIdByMessageId,
  readNodeRuntime,
} from '../../common/nodes.js';
import type {SocketState} from '../protocol.js';

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_USER_NAME_LENGTH = 80;
export const MAX_PASSWORD_LENGTH = 256;
export const MIN_PASSWORD_LENGTH = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DONATION_BADGE_TTL_DAYS = 30;
export const MAX_MESSAGES_PAGE_LIMIT = 100;
export const MAX_MESSAGES_PER_ROOM = 5000;
export const SYSTEM_NICKNAME = 'marx';
export const ANONYMOUS_AUTHOR_ID = 0;
export const ANONYMOUS_AUTHOR_NICKNAME = 'anonymous';
export const ANONYMOUS_AUTHOR_NAME = 'Аноним';

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const UPLOAD_LINK_RE = /\/uploads\/([a-zA-Z0-9._-]+)/gi;
const ALLOWED_REACTIONS = new Set([
  '🙂',
  '👍',
  '😂',
  '🔥',
  '❤️',
  '🤔',
  '☹️',
  '😡',
  '👎',
  '😢',
]);

export type ApiError = {ok: false; error: string};
export type ApiOk<T> = {ok: true} & T;

export type PublicUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
  pushDisableAllMentions: boolean;
};

export type UserRow = {
  id: number;
  nickname: string;
  name: string | null;
  nicknameColor: string | null;
  donationBadgeUntil?: Date | null;
  pushDisableAllMentions?: boolean;
};

export type MessageReactionUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
};

export type MessageReaction = {
  emoji: string;
  users: MessageReactionUser[];
};

type TimeRefCandidate = {
  id: number;
  index: number;
  tooltip: string;
};

type RoomMessageRenderContext = {
  mentionsByToken: Map<string, {
    nickname: string;
    name: string;
    nicknameColor: string | null;
  }>;
  timeCandidatesByLabel: Map<string, TimeRefCandidate[]>;
  messageIndexById: Map<number, number>;
  timelineSize: number;
};

type MessageAuthorSource = {
  senderId?: number | null;
  sender?: {
    id?: number;
    nickname?: string | null;
    name?: string | null;
    nicknameColor?: string | null;
    donationBadgeUntil?: Date | string | null;
  } | null;
};

export class ChatContext {
  isUniqueError(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  unauthorized(): ApiError {
    return {ok: false, error: 'unauthorized'};
  }

  requireAuth(state: SocketState): ApiError | null {
    if (!state.user) return this.unauthorized();
    return null;
  }

  parseRoomId(value: unknown) {
    const roomId = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(roomId) || roomId <= 0) return null;
    return roomId;
  }

  parseLimit(value: unknown) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_MESSAGES_PAGE_LIMIT) : 100;
  }

  parseBeforeMessageId(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  async pruneRoomOverflow(roomId: number) {
    await db.$executeRaw(
      Prisma.sql`
        delete from nodes
        where id in (
          select id from (
            select
              m.id,
              row_number() over (order by m.created_at desc, m.id desc) as rn
            from messages m
            join nodes n on n.id = m.id
            left join rooms r on r.id = ${roomId}
            where n.parent_id = ${roomId}
              and (r.pinned_node_id is null or r.pinned_node_id <> m.id)
          ) ranked
          where rn > ${MAX_MESSAGES_PER_ROOM}
        )
      `,
    );
  }

  extractUploadNamesFromRawText(rawTextRaw: unknown) {
    const rawText = String(rawTextRaw || '');
    const names = new Set<string>();

    UPLOAD_LINK_RE.lastIndex = 0;
    for (const match of rawText.matchAll(UPLOAD_LINK_RE)) {
      const safeName = sanitizeUploadName(match[1]);
      if (!safeName) continue;
      names.add(safeName);
    }

    return Array.from(names);
  }

  async isUploadUsed(fileName: string) {
    const row = await db.message.findFirst({
      where: {
        rawText: {
          contains: `/uploads/${fileName}`,
        },
      },
      select: {id: true},
    });

    return !!row?.id;
  }

  async cleanupUnusedUploads(uploadNamesRaw: string[]) {
    const uploadNames = Array.from(new Set(uploadNamesRaw.filter(Boolean)));
    if (!uploadNames.length) return;

    for (const fileName of uploadNames) {
      if (await this.isUploadUsed(fileName)) continue;
      deleteUploadFile(fileName);
    }
  }

  normalizeName(nameRaw: unknown, fallbackNickname: string) {
    const name = String(nameRaw ?? '').trim();
    if (!name) return fallbackNickname;
    return name.slice(0, MAX_USER_NAME_LENGTH);
  }

  parseNickname(nicknameRaw: unknown) {
    const nickname = normalizeNickname(nicknameRaw);
    if (!isValidNickname(nickname)) {
      return {ok: false, error: 'invalid_nickname'} as const;
    }
    return {ok: true, nickname} as const;
  }

  parseNicknameColor(raw: unknown) {
    if (raw === undefined || raw === null) return {ok: true, value: null};

    const value = String(raw).trim();
    if (!value) return {ok: true, value: null};
    if (!COLOR_HEX_RE.test(value)) {
      return {ok: false, error: 'invalid_color'};
    }

    return {ok: true, value: value.toLowerCase()};
  }

  normalizeDonationBadgeUntil(raw: Date | string | null | undefined) {
    if (!raw) return null;
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
    }
    const parsed = new Date(String(raw));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }

  toPublicUser(user: UserRow): PublicUser {
    return {
      id: user.id,
      nickname: user.nickname,
      name: user.name?.trim() ? user.name.trim() : user.nickname,
      nicknameColor: user.nicknameColor || DEFAULT_NICKNAME_COLOR,
      donationBadgeUntil: this.normalizeDonationBadgeUntil(user.donationBadgeUntil),
      pushDisableAllMentions: !!user.pushDisableAllMentions,
    };
  }

  toMessageAuthor(source: MessageAuthorSource) {
    const sender = source?.sender;
    if (sender?.id && sender.id > 0) {
      return {
        authorId: sender.id,
        authorNickname: String(sender.nickname || '').trim() || 'deleted',
        authorName: String(sender.name || sender.nickname || '').trim() || 'deleted',
        authorNicknameColor: sender.nicknameColor || DEFAULT_NICKNAME_COLOR,
        authorDonationBadgeUntil: this.normalizeDonationBadgeUntil(sender.donationBadgeUntil || null),
      };
    }

    const senderId = Number(source?.senderId || 0);
    if (!Number.isFinite(senderId) || senderId <= 0) {
      return {
        authorId: ANONYMOUS_AUTHOR_ID,
        authorNickname: ANONYMOUS_AUTHOR_NICKNAME,
        authorName: ANONYMOUS_AUTHOR_NAME,
        authorNicknameColor: null,
        authorDonationBadgeUntil: null,
      };
    }

    return {
      authorId: senderId,
      authorNickname: 'deleted',
      authorName: 'deleted',
      authorNicknameColor: DEFAULT_NICKNAME_COLOR,
      authorDonationBadgeUntil: null,
    };
  }

  formatUsername(nicknameRaw: unknown) {
    const nickname = String(nicknameRaw || '').trim();
    if (!nickname) return '@deleted';
    return `@${nickname}`;
  }

  formatMessageTime(createdAtRaw: Date | string | null | undefined) {
    if (!createdAtRaw) return '00:00:00';
    const date = createdAtRaw instanceof Date
      ? createdAtRaw
      : new Date(String(createdAtRaw));
    if (Number.isNaN(date.getTime())) return '00:00:00';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  buildTimeReferenceTooltip(rawTextRaw: unknown, authorNicknameRaw: unknown) {
    const rawText = String(rawTextRaw || '');
    const normalized = rawText.replace(/\s+/g, ' ').trim();
    const preview = normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
    return `${this.formatUsername(authorNicknameRaw)}: ${preview || '(пусто)'}`;
  }

  async buildRoomMessageRenderContext(roomId: number, rawTexts: string[]) {
    const mentionNicknames = new Set<string>();
    const timeLabels = new Set<string>();

    rawTexts.forEach((rawText) => {
      const tokens = extractMessageFormatTokens(rawText);
      tokens.mentionNicknames.forEach((nickname) => mentionNicknames.add(nickname));
      tokens.timeLabels.forEach((timeLabel) => timeLabels.add(timeLabel));
    });

    const mentionsByToken = new Map<string, {
      nickname: string;
      name: string;
      nicknameColor: string | null;
    }>();

    if (mentionNicknames.size > 0) {
      const mentionTokens = Array.from(mentionNicknames)
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value) => !!value && value !== 'all');
      const uniqueTokens = Array.from(new Set(mentionTokens));

      if (uniqueTokens.length > 0) {
        const roomMembers = await db.roomUser.findMany({
          where: {
            roomId,
          },
          select: {
            user: {
              select: {
                nickname: true,
                name: true,
                nicknameColor: true,
              },
            },
          },
        });

        const members = roomMembers
          .map((row) => row.user)
          .filter(Boolean)
          .map((user) => ({
            nickname: String(user.nickname || '').trim(),
            name: String(user.name || user.nickname || '').trim(),
            nicknameColor: user.nicknameColor || DEFAULT_NICKNAME_COLOR,
          }))
          .filter((user) => !!user.nickname);

        const membersByNickname = new Map<string, typeof members[number]>();
        const membersByName = new Map<string, Array<typeof members[number]>>();

        members.forEach((member) => {
          const nicknameToken = member.nickname.toLowerCase();
          if (nicknameToken) {
            membersByNickname.set(nicknameToken, member);
          }

          const nameToken = member.name.toLowerCase();
          if (!nameToken) return;
          const bucket = membersByName.get(nameToken) || [];
          bucket.push(member);
          membersByName.set(nameToken, bucket);
        });

        uniqueTokens.forEach((token) => {
          const byNickname = membersByNickname.get(token);
          if (byNickname) {
            mentionsByToken.set(token, byNickname);
            return;
          }

          const byName = membersByName.get(token) || [];
          if (byName.length === 1) {
            mentionsByToken.set(token, byName[0]);
          }
        });
      }
    }

    const timeCandidatesByLabel = new Map<string, TimeRefCandidate[]>();
    const messageIndexById = new Map<number, number>();
    let timelineSize = 0;

    if (timeLabels.size > 0) {
      const timelineRows = await db.message.findMany({
        where: {
          node: {
            parentId: roomId,
          },
        },
        orderBy: [
          {createdAt: 'asc'},
          {id: 'asc'},
        ],
        select: {
          id: true,
          rawText: true,
          createdAt: true,
          sender: {
            select: {
              nickname: true,
            },
          },
        },
      });

      timelineSize = timelineRows.length;

      timelineRows.forEach((row, index) => {
        messageIndexById.set(row.id, index);

        const timeLabel = this.formatMessageTime(row.createdAt);
        if (!timeLabels.has(timeLabel)) return;

        const tooltip = this.buildTimeReferenceTooltip(
          row.rawText,
          row.sender?.nickname || ANONYMOUS_AUTHOR_NICKNAME,
        );
        const candidates = timeCandidatesByLabel.get(timeLabel) || [];
        candidates.push({
          id: row.id,
          index,
          tooltip,
        });
        timeCandidatesByLabel.set(timeLabel, candidates);
      });
    }

    const context: RoomMessageRenderContext = {
      mentionsByToken,
      timeCandidatesByLabel,
      messageIndexById,
      timelineSize,
    };

    return context;
  }

  buildCompileMessageOptions(context: RoomMessageRenderContext, sourceMessageId: number | null) {
    const sourceIndex = sourceMessageId && context.messageIndexById.has(sourceMessageId)
      ? Number(context.messageIndexById.get(sourceMessageId))
      : Number(context.timelineSize || 0);

    const options: CompileMessageFormatOptions = {
      resolveMention: (nicknameRaw: string) => {
        const nickname = String(nicknameRaw || '').trim().toLowerCase();
        if (!nickname) return null;
        return context.mentionsByToken.get(nickname) || null;
      },
      resolveTimeReference: (timeLabelRaw: string) => {
        const timeLabel = String(timeLabelRaw || '').trim();
        if (!timeLabel) return null;

        const candidates = context.timeCandidatesByLabel.get(timeLabel) || [];
        if (!candidates.length) return null;

        let bestCandidate = candidates[0];
        let bestDistance = Math.abs(bestCandidate.index - sourceIndex);

        for (const candidate of candidates) {
          const distance = Math.abs(candidate.index - sourceIndex);
          if (distance > bestDistance) continue;
          if (distance === bestDistance && candidate.id < bestCandidate.id) continue;
          bestCandidate = candidate;
          bestDistance = distance;
        }

        return {
          messageId: bestCandidate.id,
          tooltip: bestCandidate.tooltip,
        };
      },
    };

    return options;
  }

  compileMessageWithContext(rawText: string, context: RoomMessageRenderContext, sourceMessageId: number | null) {
    return compileMessageFormat(
      rawText,
      this.buildCompileMessageOptions(context, sourceMessageId),
    );
  }

  async compileMessageForRoom(roomId: number, rawText: string, sourceMessageId: number | null = null) {
    const context = await this.buildRoomMessageRenderContext(roomId, [rawText]);
    return this.compileMessageWithContext(rawText, context, sourceMessageId);
  }

  async loadMessagePayloadById(roomId: number, messageId: number): Promise<ChatContextMessagePayload | null> {
    const messageRow = await db.message.findFirst({
      where: {
        id: messageId,
        node: {
          parentId: roomId,
        },
      },
      select: {
        id: true,
        senderId: true,
        kind: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
        node: {
          select: {
            parentId: true,
            component: true,
            clientScript: true,
            serverScript: true,
            data: true,
          },
        },
        sender: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
      },
    });

    if (!messageRow) return null;

    const commentRoomId = await findCommentRoomNodeIdByMessageId(messageRow.id);
    const runtime = readNodeRuntime(messageRow.node);

    const isScriptable = messageRow.kind === 'scriptable';
    const compiled = isScriptable
      ? {
        rawText: String(messageRow.rawText || ''),
        renderedHtml: String(messageRow.renderedHtml || ''),
        renderedPreviews: [],
      }
      : await this.compileMessageForRoom(roomId, String(messageRow.rawText || ''), messageRow.id);

    const author = this.toMessageAuthor({
      senderId: messageRow.senderId,
      sender: messageRow.sender,
    });

    return {
      id: messageRow.id,
      roomId,
      dialogId: roomId,
      kind: messageRow.kind === 'system' || messageRow.kind === 'scriptable' ? messageRow.kind : 'text',
      authorId: author.authorId,
      authorNickname: author.authorNickname,
      authorName: author.authorName,
      authorNicknameColor: author.authorNicknameColor,
      authorDonationBadgeUntil: author.authorDonationBadgeUntil,
      rawText: compiled.rawText,
      renderedHtml: compiled.renderedHtml,
      renderedPreviews: compiled.renderedPreviews,
      runtime,
      commentRoomId,
      createdAt: messageRow.createdAt.toISOString(),
      reactions: await this.loadMessageReactions(messageRow.id),
    };
  }

  parseReactionEmoji(raw: unknown) {
    if (raw === undefined || raw === null) return {ok: true, value: null as string | null};
    const value = String(raw).trim();
    if (!value) return {ok: true, value: null as string | null};
    if (!ALLOWED_REACTIONS.has(value)) {
      return {ok: false, error: 'invalid_reaction'};
    }
    return {ok: true, value};
  }

  async findSystemUserId() {
    const systemUser = await db.user.findUnique({
      where: {
        nickname: SYSTEM_NICKNAME,
      },
      select: {id: true},
    });
    return systemUser?.id || null;
  }

  async ensureSystemDirectForUser(userId: number) {
    await ensureUserInGroupRooms(userId);

    const systemUserId = await this.findSystemUserId();
    if (!systemUserId || systemUserId === userId) return;

    await getOrCreateDirectRoom(systemUserId, userId);
  }

  async loadMessageReactions(messageId: number): Promise<MessageReaction[]> {
    const rows = await db.messageReaction.findMany({
      where: {messageId},
      orderBy: {createdAt: 'asc'},
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
      },
    });

    const grouped = new Map<string, MessageReactionUser[]>();
    for (const row of rows) {
      const users = grouped.get(row.reaction) || [];
      users.push({
        id: row.user.id,
        nickname: row.user.nickname,
        name: row.user.name?.trim() ? row.user.name.trim() : row.user.nickname,
        nicknameColor: row.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
        donationBadgeUntil: this.normalizeDonationBadgeUntil(row.user.donationBadgeUntil),
      });
      grouped.set(row.reaction, users);
    }

    return Array.from(grouped.entries()).map(([emoji, users]) => ({emoji, users}));
  }

  async attachMessageReactions(messages: any[]) {
    if (!messages.length) return messages;

    const messageIds = messages.map((message) => Number(message.id)).filter((id) => Number.isFinite(id));
    if (!messageIds.length) {
      return messages.map((message) => ({...message, reactions: []}));
    }

    const rows = await db.messageReaction.findMany({
      where: {
        messageId: {
          in: messageIds,
        },
      },
      orderBy: {createdAt: 'asc'},
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
            donationBadgeUntil: true,
          },
        },
      },
    });

    const byMessage = new Map<number, Map<string, MessageReactionUser[]>>();
    for (const row of rows) {
      let byEmoji = byMessage.get(row.messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        byMessage.set(row.messageId, byEmoji);
      }

      const users = byEmoji.get(row.reaction) || [];
      users.push({
        id: row.user.id,
        nickname: row.user.nickname,
        name: row.user.name?.trim() ? row.user.name.trim() : row.user.nickname,
        nicknameColor: row.user.nicknameColor || DEFAULT_NICKNAME_COLOR,
        donationBadgeUntil: this.normalizeDonationBadgeUntil(row.user.donationBadgeUntil),
      });
      byEmoji.set(row.reaction, users);
    }

    return messages.map((message) => {
      const byEmoji = byMessage.get(Number(message.id));
      const reactions = byEmoji
        ? Array.from(byEmoji.entries()).map(([emoji, users]) => ({emoji, users}))
        : [];
      return {
        ...message,
        reactions,
      };
    });
  }
}

export type ChatContextMessagePayload = {
  id: number;
  roomId: number;
  dialogId?: number;
  kind: 'text' | 'system' | 'scriptable';
  authorId: number;
  authorNickname: string;
  authorName: string;
  authorNicknameColor: string | null;
  authorDonationBadgeUntil: string | null;
  rawText: string;
  renderedHtml: string;
  renderedPreviews: MessageLinkPreview[];
  runtime: {
    clientScript: string | null;
    serverScript: string | null;
    data: Record<string, any>;
  };
  commentRoomId?: number | null;
  createdAt: string;
  reactions: MessageReaction[];
};
