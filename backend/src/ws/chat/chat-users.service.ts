import {db} from '../../db.js';
import {ChatContext, type ApiError, type PublicUser} from './chat-context.js';
import type {SocketState} from '../protocol.js';

export class ChatUsersService {
  constructor(private readonly ctx: ChatContext) {}

  async usersList(state: SocketState): Promise<ApiError | PublicUser[]> {
    const authError = this.ctx.requireAuth(state);
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
        donationBadgeUntil: true,
      },
    });

    return rows.map((row) => this.ctx.toPublicUser(row));
  }
}
