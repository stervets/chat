import {Injectable} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import {db} from '../db.js';
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
import type {SocketState} from './protocol.js';

const MAX_MESSAGE_LENGTH = 4000;

type ApiError = {ok: false; error: string};
type ApiOk<T> = {ok: true} & T;

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

  async authLogin(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: {id: number; nickname: string};
  }>> {
    const nickname = (payload?.nickname || '').toString().trim();
    const password = (payload?.password || '').toString();
    if (!nickname || !password) {
      return {ok: false, error: 'invalid_input'};
    }

    const user = db.prepare(
      'select id, nickname, password_hash from users where nickname = ?'
    ).get(nickname) as {id: number; nickname: string; password_hash: string} | undefined;

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

    state.user = {id: user.id, nickname: user.nickname};
    state.token = session.token;

    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {id: user.id, nickname: user.nickname},
    };
  }

  async authSession(state: SocketState, tokenRaw: unknown): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: {id: number; nickname: string};
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

  async authMe(state: SocketState): Promise<ApiError | {id: number; nickname: string}> {
    if (!state.user) return this.unauthorized();
    return {
      id: state.user.id,
      nickname: state.user.nickname,
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

  async authChangePassword(state: SocketState, payload: any): Promise<ApiError | ApiOk<{}>> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const oldPassword = (payload?.oldPassword || '').toString();
    const newPassword = (payload?.newPassword || '').toString();
    if (!oldPassword || !newPassword) {
      return {ok: false, error: 'invalid_input'};
    }

    const current = db.prepare(
      'select password_hash from users where id = ?'
    ).get(state.user!.id) as {password_hash: string} | undefined;

    if (!current) {
      return {ok: false, error: 'not_found'};
    }

    const valid = await verifyPassword(current.password_hash, oldPassword);
    if (!valid) {
      return {ok: false, error: 'invalid_credentials'};
    }

    const hash = await hashPassword(newPassword);
    const updatedAt = new Date().toISOString();
    db.prepare(
      'update users set password_hash = ?, updated_at = ? where id = ?'
    ).run(hash, updatedAt, state.user!.id);

    return {ok: true};
  }

  async usersList(state: SocketState): Promise<ApiError | {id: number; nickname: string}[]> {
    const authError = this.requireAuth(state);
    if (authError) return authError;

    const rows = db.prepare(
      'select id, nickname from users where id <> ? order by nickname asc'
    ).all(state.user!.id) as {id: number; nickname: string}[];

    return rows;
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
      usedBy: row.usedById ? {id: row.usedById, nickname: row.usedByNickname} : null,
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
    user: {id: number; nickname: string};
  }>> {
    const code = (payload?.code || '').toString().trim();
    const nickname = (payload?.nickname || '').toString().trim();
    const password = (payload?.password || '').toString();

    if (!code || !nickname || !password) {
      return {ok: false, error: 'invalid_input'};
    }

    const usersCountRow = db.prepare('select count(*) as c from users').get() as {c: number};
    const usersCount = usersCountRow?.c || 0;

    if (usersCount === 0) {
      const passwordHash = await hashPassword(password);
      const userInsert = db.prepare(
        'insert into users (nickname, password_hash) values (?, ?)'
      ).run(nickname, passwordHash);
      const userId = Number(userInsert.lastInsertRowid);
      const session = createSession(userId, {
        ip: state.ip,
        userAgent: state.userAgent,
      });

      state.user = {id: userId, nickname};
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: {id: userId, nickname},
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
        'select id from users where nickname = ?'
      ).get(nickname);
      if (existingUser) {
        db.exec('rollback');
        return {ok: false, error: 'nickname_taken'};
      }

      const userInsert = db.prepare(
        'insert into users (nickname, password_hash) values (?, ?)'
      ).run(nickname, passwordHash);
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

      state.user = {id: userId, nickname};
      state.token = session.token;

      return {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: {id: userId, nickname},
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
    targetUser: {id: number; nickname: string};
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
      'select id, nickname from users where id = ?'
    ).get(userId) as {id: number; nickname: string} | undefined;

    if (!targetUser) {
      return {ok: false, error: 'user_not_found'};
    }

    const dialog = await getOrCreatePrivateDialog(state.user!.id, userId);
    return {
      dialogId: dialog.id,
      type: 'private',
      targetUser,
    };
  }

  async dialogsMessages(state: SocketState, dialogIdRaw: unknown, limitRaw?: unknown): Promise<ApiError | any[]> {
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

    const limit = this.parseLimit(limitRaw);

    const result = db.prepare(
      `select * from (
         select
           m.id,
           m.dialog_id as "dialogId",
           m.sender_id as "authorId",
           u.nickname as "authorNickname",
           m.body,
           m.created_at as "createdAt"
         from messages m
         left join users u on u.id = m.sender_id
         where m.dialog_id = ?
         order by m.created_at desc
         limit ?
       ) t
       order by t."createdAt" asc`
    ).all(dialogId, limit);

    return result as any[];
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
      body: string;
      createdAt: string;
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
        body,
        createdAt,
      },
    };
  }
}
