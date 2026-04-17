import {Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {randomBytes} from 'node:crypto';
import {db} from '../db.js';
import {config} from '../config.js';
import {
  getDialogById,
  getOrCreateGeneralDialog,
  getOrCreatePrivateDialog,
  userCanAccessDialog,
} from '../common/dialogs.js';
import {
  createSession,
  hashPassword,
  resolveSession,
  revokeSession,
  verifyPassword,
} from '../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../common/const.js';
import {compileMessageFormat} from '../common/message-format.js';
import {deleteUploadFile, sanitizeUploadName} from '../common/uploads.js';
import type {SocketState} from './protocol.js';

const MAX_MESSAGE_LENGTH = 5000;
const MAX_USER_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 256;
const MIN_PASSWORD_LENGTH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PAGE_LIMIT = 100;
const MAX_MESSAGES_PER_DIALOG = 5000;

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

type ApiError = {ok: false; error: string};
type ApiOk<T> = {ok: true} & T;

type PublicUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
};

type UserRow = {
  id: number;
  nickname: string;
  name: string | null;
  nicknameColor: string | null;
};

type MessageReactionUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
};

type MessageReaction = {
  emoji: string;
  users: MessageReactionUser[];
};

function isUniqueError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

@Injectable()
export class ChatService {
  private unauthorized(): ApiError {
    return {ok: false, error: 'unauthorized'};
  }

  private requireAuth(state: SocketState): ApiError | null {
    if (!state.user) return this.unauthorized();
    return null;
  }

  private parseDialogId(value: unknown) {
    const dialogId = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(dialogId) ? dialogId : null;
  }

  private parseLimit(value: unknown) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_MESSAGES_PAGE_LIMIT) : 100;
  }

  private parseBeforeMessageId(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  private messagesCutoffDate() {
    const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 7));
    return new Date(Date.now() - ttlDays * DAY_MS);
  }

  private async pruneExpiredMessages() {
    await db.message.deleteMany({
      where: {
        createdAt: {
          lt: this.messagesCutoffDate(),
        },
      },
    });
  }

  private async pruneDialogOverflow(dialogId: number) {
    await db.$executeRaw(
      Prisma.sql`
        delete from messages
        where id in (
          select id from (
            select
              id,
              row_number() over (order by created_at desc, id desc) as rn
            from messages
            where dialog_id = ${dialogId}
          ) ranked
          where rn > ${MAX_MESSAGES_PER_DIALOG}
        )
      `,
    );
  }

  private extractUploadNamesFromRawText(rawTextRaw: unknown) {
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

  private async isUploadUsed(fileName: string) {
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

  private async cleanupUnusedUploads(uploadNamesRaw: string[]) {
    const uploadNames = Array.from(new Set(uploadNamesRaw.filter(Boolean)));
    if (!uploadNames.length) return;

    for (const fileName of uploadNames) {
      if (await this.isUploadUsed(fileName)) continue;
      deleteUploadFile(fileName);
    }
  }

  private normalizeNickname(nicknameRaw: unknown) {
    return String(nicknameRaw ?? '').trim().toLowerCase();
  }

  private normalizeName(nameRaw: unknown, fallbackNickname: string) {
    const name = String(nameRaw ?? '').trim();
    if (!name) return fallbackNickname;
    return name.slice(0, MAX_USER_NAME_LENGTH);
  }

  private parseNicknameColor(raw: unknown) {
    if (raw === undefined || raw === null) return {ok: true, value: null};

    const value = String(raw).trim();
    if (!value) return {ok: true, value: null};
    if (!COLOR_HEX_RE.test(value)) {
      return {ok: false, error: 'invalid_color'};
    }

    return {ok: true, value: value.toLowerCase()};
  }

  private toPublicUser(user: UserRow): PublicUser {
    return {
      id: user.id,
      nickname: user.nickname,
      name: user.name?.trim() ? user.name.trim() : user.nickname,
      nicknameColor: user.nicknameColor || DEFAULT_NICKNAME_COLOR,
    };
  }

  private parseReactionEmoji(raw: unknown) {
    if (raw === undefined || raw === null) return {ok: true, value: null as string | null};
    const value = String(raw).trim();
    if (!value) return {ok: true, value: null as string | null};
    if (!ALLOWED_REACTIONS.has(value)) {
      return {ok: false, error: 'invalid_reaction'};
    }
    return {ok: true, value};
  }

  private async loadMessageReactions(messageId: number): Promise<MessageReaction[]> {
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
      });
      grouped.set(row.reaction, users);
    }

    return Array.from(grouped.entries()).map(([emoji, users]) => ({emoji, users}));
  }

  private async attachMessageReactions(messages: any[]) {
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

  async authLogin(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  }>> {
    const nickname = this.normalizeNickname(payload?.nickname);
    const password = (payload?.password || '').toString();
    if (!nickname || !password) {
      return {ok: false, error: 'invalid_input'};
    }

    const user = await db.user.findUnique({
      where: {nicknameNormalized: nickname},
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        passwordHash: true,
      },
    });

    if (!user) {
      return {ok: false, error: 'invalid_credentials'};
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      return {ok: false, error: 'invalid_credentials'};
    }

    const session = await createSession(user.id, {
      ip: state.ip,
      userAgent: state.userAgent,
    });

    const publicUser = this.toPublicUser(user);
    state.user = publicUser;
    state.token = session.token;

    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicUser,
    };
  }

  async authSession(state: SocketState, tokenRaw: unknown): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  }>> {
    const token = (tokenRaw || '').toString().trim();
    if (!token) return this.unauthorized();

    const session = await resolveSession(token);
    if (!session) return this.unauthorized();

    state.user = session.user;
    state.token = session.token;
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: session.user,
    };
  }

  async authMe(state: SocketState): Promise<ApiError | PublicUser> {
    if (!state.user) return this.unauthorized();
    return {
      id: state.user.id,
      nickname: state.user.nickname,
      name: state.user.name,
      nicknameColor: state.user.nicknameColor,
    };
  }

  async authLogout(state: SocketState): Promise<ApiError | ApiOk<{}>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    if (state.token) {
      await revokeSession(state.token);
    }
    state.token = null;
    state.user = null;
    state.dialogId = null;
    return {ok: true};
  }

  async authUpdateProfile(state: SocketState, payload: any): Promise<ApiError | ApiOk<{user: PublicUser}>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const hasName = Object.prototype.hasOwnProperty.call(payload || {}, 'name');
    const hasNicknameColor = Object.prototype.hasOwnProperty.call(payload || {}, 'nicknameColor');

    if (!hasName && !hasNicknameColor) {
      return {ok: false, error: 'invalid_input'};
    }

    const updateData: Record<string, unknown> = {};

    if (hasName) {
      const nextName = String(payload?.name ?? '').trim();
      if (!nextName) {
        return {ok: false, error: 'invalid_name'};
      }

      updateData.name = nextName.slice(0, MAX_USER_NAME_LENGTH);
    }

    if (hasNicknameColor) {
      const color = this.parseNicknameColor(payload?.nicknameColor);
      if (!color.ok) {
        return {ok: false, error: color.error};
      }
      updateData.nicknameColor = color.value;
    }

    if (Object.keys(updateData).length === 0) {
      return {ok: false, error: 'invalid_input'};
    }

    const updated = await db.user.update({
      where: {id: state.user!.id},
      data: updateData,
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
      },
    });

    state.user = this.toPublicUser(updated);
    return {ok: true, user: state.user};
  }

  async authChangePassword(state: SocketState, payload: any): Promise<ApiError | ApiOk<{}>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const newPassword = (payload?.newPassword || '').toString();
    if (!newPassword) {
      return {ok: false, error: 'invalid_input'};
    }

    const trimmedPassword = newPassword.trim();
    if (trimmedPassword.length < MIN_PASSWORD_LENGTH || trimmedPassword.length > MAX_PASSWORD_LENGTH) {
      return {ok: false, error: 'invalid_password'};
    }

    const hash = await hashPassword(trimmedPassword);
    await db.user.update({
      where: {id: state.user!.id},
      data: {passwordHash: hash},
    });

    return {ok: true};
  }

  async usersList(state: SocketState): Promise<ApiError | PublicUser[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const rows = await db.user.findMany({
      where: {
        id: {
          not: state.user!.id,
        },
      },
      orderBy: [
        {name: 'asc'},
        {nickname: 'asc'},
      ],
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
      },
    });

    return rows.map((row) => this.toPublicUser(row));
  }

  async invitesList(state: SocketState): Promise<ApiError | any[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const result = await db.invite.findMany({
      where: {
        createdById: state.user!.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        usedBy: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
          },
        },
      },
    });

    return result.map((row) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt.toISOString(),
      usedAt: row.usedAt ? row.usedAt.toISOString() : null,
      usedBy: row.usedBy
        ? {
          id: row.usedBy.id,
          nickname: row.usedBy.nickname,
          name: row.usedBy.name || row.usedBy.nickname,
          nicknameColor: row.usedBy.nicknameColor || DEFAULT_NICKNAME_COLOR,
        }
        : null,
      isUsed: Boolean(row.usedAt),
    }));
  }

  async invitesCreate(state: SocketState): Promise<ApiError | {
    id: number;
    code: string;
    createdAt: string;
  }> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(8).toString('hex');
      try {
        const created = await db.invite.create({
          data: {
            code,
            createdById: state.user!.id,
          },
          select: {
            id: true,
            code: true,
            createdAt: true,
          },
        });

        return {
          id: created.id,
          code: created.code,
          createdAt: created.createdAt.toISOString(),
        };
      } catch (err) {
        if (isUniqueError(err)) continue;
        throw err;
      }
    }

    return {ok: false, error: 'failed_to_generate_invite'};
  }

  async invitesCheck(_state: SocketState, payload: any): Promise<ApiError | ApiOk<{code: string}>> {
    const code = (payload?.code || '').toString().trim();
    if (!code) {
      return {ok: false, error: 'invalid_input'};
    }

    const invite = await db.invite.findUnique({
      where: {code},
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
      },
    });

    if (!invite) {
      return {ok: false, error: 'invite_not_found'};
    }

    const isExpired = invite.expiresAt && invite.expiresAt < new Date();
    const isUsedUp = !!invite.usedAt;
    if (isExpired || isUsedUp) {
      return {ok: false, error: 'invite_invalid'};
    }

    return {
      ok: true,
      code,
    };
  }

  async invitesRedeem(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  }>> {
    const code = (payload?.code || '').toString().trim();
    const nickname = this.normalizeNickname(payload?.nickname);
    const password = (payload?.password || '').toString();

    if (!code || !nickname || !password) {
      return {ok: false, error: 'invalid_input'};
    }

    const passwordHash = await hashPassword(password);
    const name = this.normalizeName(payload?.name, nickname);

    try {
      const createdUser = await db.$transaction(async (tx) => {
        const invite = await tx.invite.findUnique({
          where: {code},
          select: {
            id: true,
            usedAt: true,
            expiresAt: true,
          },
        });

        if (!invite) {
          throw new Error('invite_not_found');
        }

        const isExpired = invite.expiresAt && invite.expiresAt < new Date();
        const isUsedUp = !!invite.usedAt;
        if (isExpired || isUsedUp) {
          throw new Error('invite_invalid');
        }

        const existingUser = await tx.user.findUnique({
          where: {nicknameNormalized: nickname},
          select: {id: true},
        });
        if (existingUser) {
          throw new Error('nickname_taken');
        }

        const user = await tx.user.create({
          data: {
            nickname,
            nicknameNormalized: nickname,
            name,
            nicknameColor: DEFAULT_NICKNAME_COLOR,
            passwordHash,
          },
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
          },
        });

        const updatedInvite = await tx.invite.updateMany({
          where: {
            id: invite.id,
            usedAt: null,
          },
          data: {
            usedById: user.id,
            usedAt: new Date(),
          },
        });

        if (updatedInvite.count === 0) {
          throw new Error('invite_invalid');
        }

        return user;
      });

      const session = await createSession(createdUser.id, {
        ip: state.ip,
        userAgent: state.userAgent,
      });

      state.user = this.toPublicUser(createdUser);
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: state.user,
      };
    } catch (err: any) {
      const knownError = String(err?.message || '');
      if (knownError === 'invite_not_found' || knownError === 'invite_invalid' || knownError === 'nickname_taken') {
        return {ok: false, error: knownError};
      }
      if (isUniqueError(err)) {
        return {ok: false, error: 'nickname_taken'};
      }
      throw err;
    }
  }

  async dialogsGeneral(state: SocketState): Promise<ApiError | {
    dialogId: number;
    type: 'general';
    title: string;
  }> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const dialog = await getOrCreateGeneralDialog();
    return {
      dialogId: dialog.id,
      type: 'general',
      title: 'Общий чат',
    };
  }

  async dialogsPrivate(state: SocketState, userIdRaw: unknown): Promise<ApiError | {
    dialogId: number;
    type: 'private';
    targetUser: PublicUser;
  }> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const userId = Number.parseInt(String(userIdRaw ?? ''), 10);
    if (!Number.isFinite(userId)) {
      return {ok: false, error: 'invalid_user'};
    }

    if (userId === state.user!.id) {
      return {ok: false, error: 'self_dialog'};
    }

    const targetUser = await db.user.findUnique({
      where: {id: userId},
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
      },
    });

    if (!targetUser) {
      return {ok: false, error: 'user_not_found'};
    }

    const dialog = await getOrCreatePrivateDialog(state.user!.id, userId);
    return {
      dialogId: dialog.id,
      type: 'private',
      targetUser: this.toPublicUser(targetUser),
    };
  }

  async dialogsDirects(state: SocketState): Promise<ApiError | Array<{
    dialogId: number;
    targetUser: PublicUser;
    lastMessageAt: string;
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    await this.pruneExpiredMessages();
    const cutoffDate = this.messagesCutoffDate();
    const userId = state.user!.id;

    const rows = await db.dialog.findMany({
      where: {
        kind: 'private',
        OR: [
          {memberAId: userId},
          {memberBId: userId},
        ],
        messages: {
          some: {
            createdAt: {
              gte: cutoffDate,
            },
          },
        },
      },
      include: {
        memberA: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
          },
        },
        memberB: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
          },
        },
        messages: {
          where: {
            createdAt: {
              gte: cutoffDate,
            },
          },
          orderBy: [
            {createdAt: 'desc'},
            {id: 'desc'},
          ],
          take: 1,
          select: {
            createdAt: true,
          },
        },
      },
    });

    const mapped = rows
      .map((row) => {
        const targetUser = row.memberAId === userId ? row.memberB : row.memberA;
        const lastMessage = row.messages[0];
        if (!targetUser || !lastMessage) return null;

        return {
          dialogId: row.id,
          lastMessageAt: lastMessage.createdAt.toISOString(),
          targetUser: this.toPublicUser(targetUser),
        };
      })
      .filter(Boolean) as Array<{
      dialogId: number;
      targetUser: PublicUser;
      lastMessageAt: string;
    }>;

    mapped.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return mapped;
  }

  async dialogsMessages(
    state: SocketState,
    dialogIdRaw: unknown,
    limitRaw?: unknown,
    beforeMessageIdRaw?: unknown,
  ): Promise<ApiError | any[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    await this.pruneExpiredMessages();

    const dialogId = this.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    await this.pruneDialogOverflow(dialogId);
    const limit = this.parseLimit(limitRaw);
    const cutoffDate = this.messagesCutoffDate();
    const beforeMessageId = this.parseBeforeMessageId(beforeMessageIdRaw);

    const result = await db.message.findMany({
      where: {
        dialogId,
        createdAt: {
          gte: cutoffDate,
        },
        ...(beforeMessageId ? {id: {lt: beforeMessageId}} : {}),
      },
      orderBy: [
        {createdAt: 'desc'},
        {id: 'desc'},
      ],
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            nickname: true,
            name: true,
            nicknameColor: true,
          },
        },
      },
    });

    const ordered = result.reverse().map((row) => ({
      id: row.id,
      dialogId: row.dialogId,
      authorId: row.sender?.id || row.senderId || 0,
      authorNickname: row.sender?.nickname || 'deleted',
      authorName: row.sender?.name || row.sender?.nickname || 'deleted',
      authorNicknameColor: row.sender?.nicknameColor || DEFAULT_NICKNAME_COLOR,
      rawText: row.rawText || '',
      renderedHtml: row.renderedHtml || '',
      createdAt: row.createdAt.toISOString(),
    }));

    return this.attachMessageReactions(ordered);
  }

  async chatJoin(state: SocketState, dialogIdRaw: unknown): Promise<ApiError | ApiOk<{dialogId: number}>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    state.dialogId = dialogId;
    return {ok: true, dialogId};
  }

  async chatSend(state: SocketState, dialogIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    message: {
      id: number;
      dialogId: number;
      authorId: number;
      authorNickname: string;
      authorName: string;
      authorNicknameColor: string | null;
      rawText: string;
      renderedHtml: string;
      createdAt: string;
      reactions: MessageReaction[];
    };
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = compileMessageFormat(rawText);

    await this.pruneExpiredMessages();
    const created = await db.message.create({
      data: {
        dialogId,
        senderId: state.user!.id,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });
    await this.pruneDialogOverflow(dialogId);

    return {
      ok: true,
      message: {
        id: created.id,
        dialogId,
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        createdAt: created.createdAt.toISOString(),
        reactions: [],
      },
    };
  }

  async chatEdit(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    message: {
      id: number;
      dialogId: number;
      authorId: number;
      authorNickname: string;
      authorName: string;
      authorNicknameColor: string | null;
      rawText: string;
      renderedHtml: string;
      createdAt: string;
      reactions: MessageReaction[];
    };
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    await this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
        senderId: true,
        rawText: true,
        renderedHtml: true,
        createdAt: true,
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }

    const dialog = await getDialogById(existing.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const trimmed = String(bodyRaw ?? '').trim();
    if (!trimmed) {
      return {ok: false, error: 'empty_message'};
    }

    const rawText = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;
    const compiled = compileMessageFormat(rawText);

    const changed = compiled.rawText !== (existing.rawText || '') || compiled.renderedHtml !== (existing.renderedHtml || '');
    if (changed) {
      await db.message.update({
        where: {id: messageId},
        data: {
          rawText: compiled.rawText,
          renderedHtml: compiled.renderedHtml,
        },
      });
    }

    return {
      ok: true,
      changed,
      message: {
        id: existing.id,
        dialogId: existing.dialogId,
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        rawText: compiled.rawText,
        renderedHtml: compiled.renderedHtml,
        createdAt: existing.createdAt.toISOString(),
        reactions: await this.loadMessageReactions(messageId),
      },
    };
  }

  async chatDelete(state: SocketState, messageIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    dialogId: number;
    messageId: number;
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    await this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
        senderId: true,
        rawText: true,
      },
    });

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.senderId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }

    const dialog = await getDialogById(existing.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadNames = this.extractUploadNamesFromRawText(existing.rawText || '');
    const result = await db.message.deleteMany({
      where: {id: messageId},
    });
    if (result.count > 0) {
      await this.cleanupUnusedUploads(uploadNames);
    }
    return {
      ok: true,
      changed: result.count > 0,
      dialogId: existing.dialogId,
      messageId,
    };
  }

  async dialogsDelete(state: SocketState, dialogIdRaw: unknown): Promise<ApiError | ApiOk<{
    changed: boolean;
    dialogId: number;
    kind: 'private';
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const dialogId = this.parseDialogId(dialogIdRaw);
    if (!dialogId) {
      return {ok: false, error: 'invalid_dialog'};
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      return {ok: false, error: 'dialog_not_found'};
    }

    if (dialog.kind !== 'private') {
      return {ok: false, error: 'invalid_dialog'};
    }

    if (!userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadRows = await db.message.findMany({
      where: {dialogId},
      select: {
        rawText: true,
      },
    });
    const uploadNames = uploadRows.flatMap((row) => this.extractUploadNamesFromRawText(row.rawText || ''));

    const result = await db.dialog.deleteMany({
      where: {id: dialogId},
    });
    if (result.count > 0) {
      await this.cleanupUnusedUploads(uploadNames);
    }
    if (state.dialogId === dialogId) {
      state.dialogId = null;
    }

    return {
      ok: true,
      changed: result.count > 0,
      dialogId,
      kind: 'private',
    };
  }

  async chatReact(state: SocketState, messageIdRaw: unknown, reactionRaw: unknown): Promise<ApiError | ApiOk<{
    dialogId: number;
    messageId: number;
    reactions: MessageReaction[];
    changed: boolean;
    notify: null | {
      userId: number;
      dialogId: number;
      messageId: number;
      emoji: string;
      actor: PublicUser;
      messageBody: string;
      createdAt: string;
    };
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    await this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const parsedEmoji = this.parseReactionEmoji(reactionRaw);
    if (!parsedEmoji.ok) {
      return {ok: false, error: parsedEmoji.error};
    }

    const message = await db.message.findUnique({
      where: {id: messageId},
      select: {
        id: true,
        dialogId: true,
        senderId: true,
        rawText: true,
      },
    });

    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    const dialog = await getDialogById(message.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const existing = await db.messageReaction.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId: state.user!.id,
        },
      },
      select: {
        id: true,
        reaction: true,
      },
    });

    const now = new Date();
    let finalEmoji: string | null = parsedEmoji.value;
    let reactionSetForNotify = false;
    let changed = false;

    if (!parsedEmoji.value) {
      if (existing) {
        await db.messageReaction.delete({
          where: {id: existing.id},
        });
        changed = true;
      }
      finalEmoji = null;
    } else if (existing) {
      if (existing.reaction === parsedEmoji.value) {
        await db.messageReaction.delete({
          where: {id: existing.id},
        });
        finalEmoji = null;
        changed = true;
      } else {
        await db.messageReaction.update({
          where: {id: existing.id},
          data: {
            reaction: parsedEmoji.value,
            createdAt: now,
          },
        });
        finalEmoji = parsedEmoji.value;
        reactionSetForNotify = true;
        changed = true;
      }
    } else {
      await db.messageReaction.create({
        data: {
          messageId,
          userId: state.user!.id,
          reaction: parsedEmoji.value,
          createdAt: now,
        },
      });
      finalEmoji = parsedEmoji.value;
      reactionSetForNotify = true;
      changed = true;
    }

    const reactions = await this.loadMessageReactions(messageId);
    const shouldNotify = reactionSetForNotify
      && !!finalEmoji
      && typeof message.senderId === 'number'
      && message.senderId > 0
      && message.senderId !== state.user!.id;

    return {
      ok: true,
      dialogId: message.dialogId,
      messageId,
      reactions,
      changed,
      notify: shouldNotify
        ? {
          userId: Number(message.senderId),
          dialogId: message.dialogId,
          messageId,
          emoji: finalEmoji!,
          actor: {
            id: state.user!.id,
            nickname: state.user!.nickname,
            name: state.user!.name,
            nicknameColor: state.user!.nicknameColor,
          },
          messageBody: message.rawText || '',
          createdAt: now.toISOString(),
        }
        : null,
    };
  }
}
