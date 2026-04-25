import {db} from '../../db.js';
import {normalizeNickname} from '../../common/nickname.js';
import {ANONYMOUS_AUTHOR_NICKNAME} from './chat-context.types.js';
import {ChatContext, type ApiError, type ApiOk, type PublicUser} from './chat-context.js';
import type {SocketState} from '../protocol.js';

const SYSTEM_NICKNAME = 'marx';

function publicUserSelect() {
  return {
    id: true,
    nickname: true,
    name: true,
    info: true,
    avatarPath: true,
    nicknameColor: true,
    donationBadgeUntil: true,
    pushDisableAllMentions: true,
  } as const;
}

export class ChatUsersService {
  constructor(private readonly ctx: ChatContext) {}

  async usersList(state: SocketState): Promise<ApiError | PublicUser[]> {
    const authError = this.ctx.result.requireAuth(state);
    if (authError) return authError;

    const rows = await db.user.findMany({
      where: {
        id: {
          not: state.user!.id,
        },
        nickname: {
          not: ANONYMOUS_AUTHOR_NICKNAME,
        },
      },
      orderBy: [
        {name: 'asc'},
        {nickname: 'asc'},
      ],
      select: publicUserSelect(),
    });

    return rows.map((row) => this.ctx.users.toPublicUser(row));
  }

  async userGet(
    state: SocketState,
    payload: {userId?: unknown; nickname?: unknown},
  ): Promise<ApiError | ApiOk<{user: PublicUser}>> {
    const authError = this.ctx.result.requireAuth(state);
    if (authError) return authError;

    const userId = Number.parseInt(String(payload?.userId ?? ''), 10);
    const nickname = normalizeNickname(payload?.nickname);

    const user = Number.isFinite(userId) && userId > 0
      ? await db.user.findUnique({
        where: {
          id: userId,
        },
        select: publicUserSelect(),
      })
      : nickname
        ? await db.user.findUnique({
          where: {
            nickname,
          },
          select: publicUserSelect(),
        })
        : null;

    if (!user) {
      return {ok: false, error: 'user_not_found'};
    }

    return {
      ok: true,
      user: this.ctx.users.toPublicUser(user),
    };
  }

  async contactsList(state: SocketState): Promise<ApiError | PublicUser[]> {
    const authError = this.ctx.result.requireAuth(state);
    if (authError) return authError;

    const [rows, systemUser] = await Promise.all([
      db.userContact.findMany({
        where: {
          ownerId: state.user!.id,
          contact: {
            nickname: {
              not: ANONYMOUS_AUTHOR_NICKNAME,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          contact: {
            select: publicUserSelect(),
          },
        },
      }),
      db.user.findUnique({
        where: {
          nickname: SYSTEM_NICKNAME,
        },
        select: publicUserSelect(),
      }),
    ]);

    const contacts = rows.map((row) => this.ctx.users.toPublicUser(row.contact));
    if (systemUser && Number(systemUser.id || 0) !== Number(state.user!.id || 0)) {
      const hasSystemUser = contacts.some((user) => Number(user.id || 0) === Number(systemUser.id || 0));
      if (!hasSystemUser) {
        contacts.unshift(this.ctx.users.toPublicUser(systemUser));
      }
    }

    return contacts;
  }

  async contactsAdd(state: SocketState, payload: {userId?: unknown}): Promise<ApiError | ApiOk<{user: PublicUser}>> {
    const authError = this.ctx.result.requireAuth(state);
    if (authError) return authError;

    const userId = Number.parseInt(String(payload?.userId ?? ''), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return {ok: false, error: 'invalid_user'};
    }
    if (userId === state.user!.id) {
      return {ok: false, error: 'cannot_add_self'};
    }

    const user = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: publicUserSelect(),
    });
    if (!user) {
      return {ok: false, error: 'user_not_found'};
    }
    if (String(user.nickname || '').trim().toLowerCase() === ANONYMOUS_AUTHOR_NICKNAME) {
      return {ok: false, error: 'forbidden'};
    }

    await db.userContact.upsert({
      where: {
        ownerId_contactId: {
          ownerId: state.user!.id,
          contactId: userId,
        },
      },
      update: {},
      create: {
        ownerId: state.user!.id,
        contactId: userId,
      },
    });

    return {
      ok: true,
      user: this.ctx.users.toPublicUser(user),
    };
  }

  async contactsRemove(state: SocketState, payload: {userId?: unknown}): Promise<ApiError | ApiOk<{removed: boolean}>> {
    const authError = this.ctx.result.requireAuth(state);
    if (authError) return authError;

    const userId = Number.parseInt(String(payload?.userId ?? ''), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return {ok: false, error: 'invalid_user'};
    }

    const systemUser = await db.user.findUnique({
      where: {
        nickname: SYSTEM_NICKNAME,
      },
      select: {
        id: true,
      },
    });
    if (Number(systemUser?.id || 0) === userId) {
      return {ok: false, error: 'forbidden'};
    }

    const result = await db.userContact.deleteMany({
      where: {
        ownerId: state.user!.id,
        contactId: userId,
      },
    });

    return {
      ok: true,
      removed: result.count > 0,
    };
  }
}
