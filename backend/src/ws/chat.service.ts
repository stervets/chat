import {Injectable} from '@nestjs/common';
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
import {deleteUploadFile, sanitizeUploadName} from '../common/uploads.js';
import type {SocketState} from './protocol.js';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_USER_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 256;
const MIN_PASSWORD_LENGTH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
const UPLOAD_LINK_RE = /\/uploads\/([a-zA-Z0-9._-]+)/gi;
const ALLOWED_REACTIONS = new Set([
  '🙂',
  '👍',
  '😂',
  '🔥',
  '❤️',
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
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
  }

  private messagesCutoffIso() {
    const ttlDays = Math.max(1, Math.floor(config.messagesTtlDays || 7));
    return new Date(Date.now() - ttlDays * DAY_MS).toISOString();
  }

  private pruneExpiredMessages() {
    db.prepare('delete from messages where created_at < ?').run(this.messagesCutoffIso());
  }

  private extractUploadNamesFromBody(bodyRaw: unknown) {
    const body = String(bodyRaw || '');
    const names = new Set<string>();

    UPLOAD_LINK_RE.lastIndex = 0;
    for (const match of body.matchAll(UPLOAD_LINK_RE)) {
      const safeName = sanitizeUploadName(match[1]);
      if (!safeName) continue;
      names.add(safeName);
    }

    return Array.from(names);
  }

  private isUploadUsed(fileName: string) {
    const row = db.prepare(
      `select id
       from messages
       where body like ?
       limit 1`
    ).get(`%/uploads/${fileName}%`) as {id: number} | undefined;

    return !!row?.id;
  }

  private cleanupUnusedUploads(uploadNamesRaw: string[]) {
    const uploadNames = Array.from(new Set(uploadNamesRaw.filter(Boolean)));
    if (!uploadNames.length) return;

    for (const fileName of uploadNames) {
      if (this.isUploadUsed(fileName)) continue;
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
      nicknameColor: user.nicknameColor || null,
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

  private loadMessageReactions(messageId: number): MessageReaction[] {
    const rows = db.prepare(
      `select
         mr.reaction as emoji,
         u.id as "userId",
         u.nickname as "userNickname",
         coalesce(u.name, u.nickname) as "userName",
         u.nickname_color as "userNicknameColor"
       from message_reactions mr
       join users u on u.id = mr.user_id
       where mr.message_id = ?
       order by mr.created_at asc`
    ).all(messageId) as Array<{
      emoji: string;
      userId: number;
      userNickname: string;
      userName: string | null;
      userNicknameColor: string | null;
    }>;

    const grouped = new Map<string, MessageReactionUser[]>();
    for (const row of rows) {
      const users = grouped.get(row.emoji) || [];
      users.push({
        id: row.userId,
        nickname: row.userNickname,
        name: row.userName?.trim() ? row.userName.trim() : row.userNickname,
        nicknameColor: row.userNicknameColor || null,
      });
      grouped.set(row.emoji, users);
    }

    return Array.from(grouped.entries()).map(([emoji, users]) => ({emoji, users}));
  }

  private attachMessageReactions(messages: any[]) {
    if (!messages.length) return messages;

    const messageIds = messages.map((message) => Number(message.id)).filter((id) => Number.isFinite(id));
    if (!messageIds.length) {
      return messages.map((message) => ({...message, reactions: []}));
    }

    const placeholders = messageIds.map(() => '?').join(', ');
    const rows = db.prepare(
      `select
         mr.message_id as "messageId",
         mr.reaction as emoji,
         u.id as "userId",
         u.nickname as "userNickname",
         coalesce(u.name, u.nickname) as "userName",
         u.nickname_color as "userNicknameColor"
       from message_reactions mr
       join users u on u.id = mr.user_id
       where mr.message_id in (${placeholders})
       order by mr.created_at asc`
    ).all(...messageIds) as Array<{
      messageId: number;
      emoji: string;
      userId: number;
      userNickname: string;
      userName: string | null;
      userNicknameColor: string | null;
    }>;

    const byMessage = new Map<number, Map<string, MessageReactionUser[]>>();
    for (const row of rows) {
      let byEmoji = byMessage.get(row.messageId);
      if (!byEmoji) {
        byEmoji = new Map();
        byMessage.set(row.messageId, byEmoji);
      }

      const users = byEmoji.get(row.emoji) || [];
      users.push({
        id: row.userId,
        nickname: row.userNickname,
        name: row.userName?.trim() ? row.userName.trim() : row.userNickname,
        nicknameColor: row.userNicknameColor || null,
      });
      byEmoji.set(row.emoji, users);
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

    const user = db.prepare(
      `select
         id,
         nickname,
         coalesce(name, nickname) as name,
         nickname_color as "nicknameColor",
         password_hash
       from users
       where lower(nickname) = ?`
    ).get(nickname) as (UserRow & {password_hash: string}) | undefined;

    if (!user) {
      return {ok: false, error: 'invalid_credentials'};
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) {
      return {ok: false, error: 'invalid_credentials'};
    }

    const session = createSession(user.id, {
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

    const session = resolveSession(token);
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
      revokeSession(state.token);
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

    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (hasName) {
      const nextName = String(payload?.name ?? '').trim();
      if (!nextName) {
        return {ok: false, error: 'invalid_name'};
      }

      fields.push('name = ?');
      values.push(nextName.slice(0, MAX_USER_NAME_LENGTH));
    }

    if (hasNicknameColor) {
      const color = this.parseNicknameColor(payload?.nicknameColor);
      if (!color.ok) {
        return {ok: false, error: color.error};
      }
      fields.push('nickname_color = ?');
      values.push(color.value);
    }

    if (!fields.length) {
      return {ok: false, error: 'invalid_input'};
    }

    const updatedAt = new Date().toISOString();
    fields.push('updated_at = ?');
    values.push(updatedAt);
    values.push(state.user!.id);

    db.prepare(
      `update users
       set ${fields.join(', ')}
       where id = ?`
    ).run(...values);

    const updated = db.prepare(
      `select
         id,
         nickname,
         coalesce(name, nickname) as name,
         nickname_color as "nicknameColor"
       from users
       where id = ?`
    ).get(state.user!.id) as UserRow | undefined;

    if (!updated) {
      return {ok: false, error: 'not_found'};
    }

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
    const updatedAt = new Date().toISOString();
    db.prepare(
      'update users set password_hash = ?, updated_at = ? where id = ?'
    ).run(hash, updatedAt, state.user!.id);

    return {ok: true};
  }

  async usersList(state: SocketState): Promise<ApiError | PublicUser[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const rows = db.prepare(
      `select
         id,
         nickname,
         coalesce(name, nickname) as name,
         nickname_color as "nicknameColor"
       from users
       where id <> ?
       order by name asc, nickname asc`
    ).all(state.user!.id) as UserRow[];

    return rows.map((row) => this.toPublicUser(row));
  }

  async invitesList(state: SocketState): Promise<ApiError | any[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const result = db.prepare(
      `select
         i.id,
         i.code,
         i.created_at as "createdAt",
         i.used_at as "usedAt",
         i.used_by as "usedById",
         u.nickname as "usedByNickname",
         coalesce(u.name, u.nickname) as "usedByName",
         u.nickname_color as "usedByNicknameColor",
         (i.used_at is not null) as "isUsed"
       from invites i
       left join users u on u.id = i.used_by
       where i.created_by = ?
       order by i.created_at desc`
    ).all(state.user!.id) as any[];

    return result.map((row: any) => ({
      id: row.id,
      code: row.code,
      createdAt: row.createdAt,
      usedAt: row.usedAt,
      usedBy: row.usedById
        ? {
          id: row.usedById,
          nickname: row.usedByNickname,
          name: row.usedByName || row.usedByNickname,
          nicknameColor: row.usedByNicknameColor || null,
        }
        : null,
      isUsed: Boolean(row.isUsed),
    }));
  }

  async invitesCreate(state: SocketState): Promise<ApiError | {
    id: number;
    code: string;
    createdAt: string;
  }> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const code = randomBytes(8).toString('hex');
    const insert = db.prepare(
      'insert into invites (code, created_by) values (?, ?)'
    ).run(code, state.user!.id);
    const created = db.prepare(
      'select id, code, created_at as "createdAt" from invites where id = ?'
    ).get(Number(insert.lastInsertRowid)) as {
      id: number;
      code: string;
      createdAt: string;
    };

    return created;
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

    const usersCountRow = db.prepare('select count(*) as c from users').get() as {c: number};
    const usersCount = usersCountRow?.c || 0;

    if (usersCount === 0) {
      const passwordHash = await hashPassword(password);
      const name = this.normalizeName(payload?.name, nickname);
      const userInsert = db.prepare(
        'insert into users (nickname, name, password_hash) values (?, ?, ?)'
      ).run(nickname, name, passwordHash);
      const userId = Number(userInsert.lastInsertRowid);
      const session = createSession(userId, {
        ip: state.ip,
        userAgent: state.userAgent,
      });

      state.user = {id: userId, nickname, name, nicknameColor: null};
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: state.user,
      };
    }

    const passwordHash = await hashPassword(password);

    try {
      db.exec('begin immediate');
      const invite = db.prepare(
        'select * from invites where code = ?'
      ).get(code) as any;

      if (!invite) {
        db.exec('rollback');
        return {ok: false, error: 'invite_not_found'};
      }

      const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
      const isUsedUp = invite.used_at;
      if (isExpired || isUsedUp) {
        db.exec('rollback');
        return {ok: false, error: 'invite_invalid'};
      }

      const existingUser = db.prepare(
        'select id from users where lower(nickname) = ?'
      ).get(nickname);
      if (existingUser) {
        db.exec('rollback');
        return {ok: false, error: 'nickname_taken'};
      }

      const name = this.normalizeName(payload?.name, nickname);
      const userInsert = db.prepare(
        'insert into users (nickname, name, password_hash) values (?, ?, ?)'
      ).run(nickname, name, passwordHash);
      const userId = Number(userInsert.lastInsertRowid);
      const usedAt = new Date().toISOString();

      db.prepare(
        'update invites set used_by = ?, used_at = ? where id = ?'
      ).run(userId, usedAt, invite.id);

      db.exec('commit');

      const session = createSession(userId, {
        ip: state.ip,
        userAgent: state.userAgent,
      });

      state.user = {id: userId, nickname, name, nicknameColor: null};
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: state.user,
      };
    } catch (err) {
      try {
        db.exec('rollback');
      } catch {
        // ignore rollback errors
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

    const targetUser = db.prepare(
      `select
         id,
         nickname,
         coalesce(name, nickname) as name,
         nickname_color as "nicknameColor"
       from users
       where id = ?`
    ).get(userId) as UserRow | undefined;

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

    this.pruneExpiredMessages();
    const cutoff = this.messagesCutoffIso();
    const rows = db.prepare(
      `select
         d.id as "dialogId",
         max(m.created_at) as "lastMessageAt",
         u.id as "targetUserId",
         u.nickname as "targetUserNickname",
         coalesce(u.name, u.nickname) as "targetUserName",
         u.nickname_color as "targetUserNicknameColor"
       from dialogs d
       join messages m on m.dialog_id = d.id
       join users u on u.id = (case when d.member_a = ? then d.member_b else d.member_a end)
       where d.kind = 'private'
         and (d.member_a = ? or d.member_b = ?)
         and m.created_at >= ?
       group by d.id, u.id, u.nickname, u.name, u.nickname_color
       having count(m.id) > 0
       order by "lastMessageAt" desc`
    ).all(state.user!.id, state.user!.id, state.user!.id, cutoff) as Array<{
      dialogId: number;
      lastMessageAt: string;
      targetUserId: number;
      targetUserNickname: string;
      targetUserName: string | null;
      targetUserNicknameColor: string | null;
    }>;

    return rows.map((row) => ({
      dialogId: row.dialogId,
      lastMessageAt: row.lastMessageAt,
      targetUser: {
        id: row.targetUserId,
        nickname: row.targetUserNickname,
        name: row.targetUserName?.trim() ? row.targetUserName.trim() : row.targetUserNickname,
        nicknameColor: row.targetUserNicknameColor || null,
      },
    }));
  }

  async dialogsMessages(state: SocketState, dialogIdRaw: unknown, limitRaw?: unknown): Promise<ApiError | any[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    this.pruneExpiredMessages();

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

    const limit = this.parseLimit(limitRaw);
    const cutoff = this.messagesCutoffIso();

    const result = db.prepare(
      `select * from (
         select
           m.id,
           m.dialog_id as "dialogId",
           m.sender_id as "authorId",
           u.nickname as "authorNickname",
           coalesce(u.name, u.nickname) as "authorName",
           u.nickname_color as "authorNicknameColor",
           m.body,
           m.created_at as "createdAt"
         from messages m
         left join users u on u.id = m.sender_id
         where m.dialog_id = ?
           and m.created_at >= ?
         order by m.created_at desc
         limit ?
       ) t
       order by t."createdAt" asc`
    ).all(dialogId, cutoff, limit);

    return this.attachMessageReactions(result as any[]);
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
      body: string;
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

    const body = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;

    this.pruneExpiredMessages();
    const createdAt = new Date().toISOString();
    const insert = db.prepare(
      'insert into messages (dialog_id, sender_id, body, created_at) values (?, ?, ?, ?)'
    ).run(dialogId, state.user!.id, body, createdAt);

    return {
      ok: true,
      message: {
        id: Number(insert.lastInsertRowid),
        dialogId,
        authorId: state.user!.id,
        authorNickname: state.user!.nickname,
        authorName: state.user!.name,
        authorNicknameColor: state.user!.nicknameColor,
        body,
        createdAt,
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
      body: string;
      createdAt: string;
      reactions: MessageReaction[];
    };
  }>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;
    this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = db.prepare(
      `select
         m.id as id,
         m.dialog_id as "dialogId",
         m.sender_id as "authorId",
         m.body as body,
         m.created_at as "createdAt"
       from messages m
       where m.id = ?`
    ).get(messageId) as {
      id: number;
      dialogId: number;
      authorId: number | null;
      body: string;
      createdAt: string;
    } | undefined;

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.authorId !== state.user!.id) {
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

    const body = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;

    const changed = body !== existing.body;
    if (changed) {
      const oldUploadNames = this.extractUploadNamesFromBody(existing.body);
      const newUploadNames = this.extractUploadNamesFromBody(body);
      const removedUploadNames = oldUploadNames.filter((name) => !newUploadNames.includes(name));
      db.prepare('update messages set body = ? where id = ?').run(body, messageId);
      this.cleanupUnusedUploads(removedUploadNames);
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
        body,
        createdAt: existing.createdAt,
        reactions: this.loadMessageReactions(messageId),
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
    this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const existing = db.prepare(
      `select
         m.id as id,
         m.dialog_id as "dialogId",
         m.sender_id as "authorId",
         m.body as body
       from messages m
       where m.id = ?`
    ).get(messageId) as {
      id: number;
      dialogId: number;
      authorId: number | null;
      body: string;
    } | undefined;

    if (!existing) {
      return {ok: false, error: 'message_not_found'};
    }

    if (existing.authorId !== state.user!.id) {
      return {ok: false, error: 'forbidden'};
    }

    const dialog = await getDialogById(existing.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const uploadNames = this.extractUploadNamesFromBody(existing.body);
    const result = db.prepare('delete from messages where id = ?').run(messageId);
    if (result.changes > 0) {
      this.cleanupUnusedUploads(uploadNames);
    }
    return {
      ok: true,
      changed: result.changes > 0,
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

    const uploadRows = db.prepare(
      `select m.body as body
       from messages m
       where m.dialog_id = ?`
    ).all(dialogId) as Array<{body: string}>;
    const uploadNames = uploadRows.flatMap((row) => this.extractUploadNamesFromBody(row.body));

    const result = db.prepare('delete from dialogs where id = ?').run(dialogId);
    if (result.changes > 0) {
      this.cleanupUnusedUploads(uploadNames);
    }
    if (state.dialogId === dialogId) {
      state.dialogId = null;
    }

    return {
      ok: true,
      changed: result.changes > 0,
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
    this.pruneExpiredMessages();

    const messageId = Number.parseInt(String(messageIdRaw ?? ''), 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      return {ok: false, error: 'invalid_message'};
    }

    const parsedEmoji = this.parseReactionEmoji(reactionRaw);
    if (!parsedEmoji.ok) {
      return {ok: false, error: parsedEmoji.error};
    }

    const message = db.prepare(
      `select
         m.id as id,
         m.dialog_id as "dialogId",
         m.sender_id as "authorId",
         m.body as body
       from messages m
       where m.id = ?`
    ).get(messageId) as {
      id: number;
      dialogId: number;
      authorId: number | null;
      body: string;
    } | undefined;

    if (!message) {
      return {ok: false, error: 'message_not_found'};
    }

    const dialog = await getDialogById(message.dialogId);
    if (!dialog || !userCanAccessDialog(state.user!.id, dialog)) {
      return {ok: false, error: 'forbidden'};
    }

    const existing = db.prepare(
      `select id, reaction
       from message_reactions
       where message_id = ? and user_id = ?`
    ).get(messageId, state.user!.id) as {id: number; reaction: string} | undefined;

    const now = new Date().toISOString();
    let finalEmoji: string | null = parsedEmoji.value;
    let reactionSetForNotify = false;
    let changed = false;

    if (!parsedEmoji.value) {
      if (existing) {
        db.prepare('delete from message_reactions where id = ?').run(existing.id);
        changed = true;
      }
      finalEmoji = null;
    } else if (existing) {
      if (existing.reaction === parsedEmoji.value) {
        db.prepare('delete from message_reactions where id = ?').run(existing.id);
        finalEmoji = null;
        changed = true;
      } else {
        db.prepare(
          'update message_reactions set reaction = ?, created_at = ? where id = ?'
        ).run(parsedEmoji.value, now, existing.id);
        finalEmoji = parsedEmoji.value;
        reactionSetForNotify = true;
        changed = true;
      }
    } else {
      db.prepare(
        'insert into message_reactions (message_id, user_id, reaction, created_at) values (?, ?, ?, ?)'
      ).run(messageId, state.user!.id, parsedEmoji.value, now);
      finalEmoji = parsedEmoji.value;
      reactionSetForNotify = true;
      changed = true;
    }

    const reactions = this.loadMessageReactions(messageId);
    const shouldNotify = reactionSetForNotify
      && !!finalEmoji
      && typeof message.authorId === 'number'
      && message.authorId > 0
      && message.authorId !== state.user!.id;

    return {
      ok: true,
      dialogId: message.dialogId,
      messageId,
      reactions,
      changed,
      notify: shouldNotify
        ? {
          userId: Number(message.authorId),
          dialogId: message.dialogId,
          messageId,
          emoji: finalEmoji!,
          actor: {
            id: state.user!.id,
            nickname: state.user!.nickname,
            name: state.user!.name,
            nicknameColor: state.user!.nicknameColor,
          },
          messageBody: message.body,
          createdAt: now,
        }
        : null,
    };
  }
}
