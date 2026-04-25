import {db} from '../../db.js';
import {ensureUserInMarxNewsRoom, getOrCreateDirectRoom} from '../../common/rooms.js';
import {SYSTEM_NICKNAME} from './chat-context.types.js';

export class ChatContextSystem {
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
    await ensureUserInMarxNewsRoom(userId);

    const systemUserId = await this.findSystemUserId();
    if (!systemUserId || systemUserId === userId) return;

    await getOrCreateDirectRoom(systemUserId, userId);
  }
}
