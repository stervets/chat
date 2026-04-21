import {createSession, hashPassword, resolveSession, revokeSession, verifyPassword} from '../../common/auth.js';
import {db} from '../../db.js';
import {
  ChatContext,
  MAX_USER_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  type ApiError,
  type ApiOk,
  type PublicUser,
} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatAuthService {
  constructor(private readonly ctx: ChatContext) {}

  async authLogin(state: SocketState, payload: any): Promise<ApiError | ApiOk<{
    token: string;
    expiresAt: string;
    user: PublicUser;
  }>> {
    const nicknameParsed = this.ctx.parseNickname(payload?.nickname);
    if (!nicknameParsed.ok) {
      return {ok: false, error: nicknameParsed.error};
    }
    const nickname = nicknameParsed.nickname;
    const password = (payload?.password || '').toString();
    if (!password) {
      return {ok: false, error: 'invalid_input'};
    }

    const user = await db.user.findUnique({
      where: {nickname},
      select: {
        id: true,
        nickname: true,
        name: true,
        nicknameColor: true,
        donationBadgeUntil: true,
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

    const publicUser = this.ctx.toPublicUser(user);
    state.user = publicUser;
    state.token = session.token;
    await this.ctx.ensureSystemDirectForUser(publicUser.id);

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
    if (!token) return this.ctx.unauthorized();

    const session = await resolveSession(token);
    if (!session) return this.ctx.unauthorized();

    state.user = session.user;
    state.token = session.token;
    await this.ctx.ensureSystemDirectForUser(session.user.id);
    return {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: session.user,
    };
  }

  async authMe(state: SocketState): Promise<ApiError | PublicUser> {
    if (!state.user) return this.ctx.unauthorized();
    return {
      id: state.user.id,
      nickname: state.user.nickname,
      name: state.user.name,
      nicknameColor: state.user.nicknameColor,
      donationBadgeUntil: state.user.donationBadgeUntil,
    };
  }

  async authLogout(state: SocketState): Promise<ApiError | ApiOk<{}>> {
    const authError = this.ctx.requireAuth(state);
    if (authError) return authError;

    if (state.token) {
      await revokeSession(state.token);
    }
    state.token = null;
    state.user = null;
    state.roomId = null;
    return {ok: true};
  }

  async authUpdateProfile(state: SocketState, payload: any): Promise<ApiError | ApiOk<{user: PublicUser}>> {
    const authError = this.ctx.requireAuth(state);
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
      const color = this.ctx.parseNicknameColor(payload?.nicknameColor);
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
        donationBadgeUntil: true,
      },
    });

    state.user = this.ctx.toPublicUser(updated);
    return {ok: true, user: state.user};
  }

  async authChangePassword(state: SocketState, payload: any): Promise<ApiError | ApiOk<{}>> {
    const authError = this.ctx.requireAuth(state);
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
}
