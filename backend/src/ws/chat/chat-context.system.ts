import {hashPassword} from '../../common/auth.js';
import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {db} from '../../db.js';
import {ensureUserInMarxNewsRoom, getOrCreateDirectRoom} from '../../common/rooms.js';
import {
  ANONYMOUS_AUTHOR_NAME,
  ANONYMOUS_AUTHOR_NICKNAME,
  ANONYMOUS_SYSTEM_PASSWORD,
  SYSTEM_NICKNAME,
} from './chat-context.types.js';

export class ChatContextSystem {
  private systemUserId: number | null = null;
  private anonymousSystemUserId: number | null = null;
  private anonymousSystemPasswordReady = false;

  async findSystemUserId() {
    if (Number.isFinite(this.systemUserId) && Number(this.systemUserId) > 0) {
      return Number(this.systemUserId);
    }

    const systemUser = await db.user.findUnique({
      where: {
        nickname: SYSTEM_NICKNAME,
      },
      select: {id: true},
    });

    const id = Number(systemUser?.id || 0);
    this.systemUserId = Number.isFinite(id) && id > 0 ? id : null;
    return this.systemUserId;
  }

  async ensureAnonymousSystemUserId() {
    if (
      Number.isFinite(this.anonymousSystemUserId)
      && Number(this.anonymousSystemUserId) > 0
      && this.anonymousSystemPasswordReady
    ) {
      return Number(this.anonymousSystemUserId);
    }

    const passwordHash = await hashPassword(ANONYMOUS_SYSTEM_PASSWORD);
    const syncAnonymousUser = async (userIdRaw: unknown) => {
      const userId = Number(userIdRaw || 0);
      if (!Number.isFinite(userId) || userId <= 0) return null;

      await db.user.update({
        where: {id: userId},
        data: {
          name: ANONYMOUS_AUTHOR_NAME,
          isBot: true,
          nicknameColor: DEFAULT_NICKNAME_COLOR,
          passwordHash,
        },
        select: {id: true},
      });

      this.anonymousSystemUserId = userId;
      this.anonymousSystemPasswordReady = true;
      return userId;
    };

    const existing = await db.user.findUnique({
      where: {
        nickname: ANONYMOUS_AUTHOR_NICKNAME,
      },
      select: {id: true},
    });
    const existingId = Number(existing?.id || 0);
    if (Number.isFinite(existingId) && existingId > 0) {
      return syncAnonymousUser(existingId);
    }

    try {
      const created = await db.user.create({
        data: {
          nickname: ANONYMOUS_AUTHOR_NICKNAME,
          name: ANONYMOUS_AUTHOR_NAME,
          isBot: true,
          nicknameColor: DEFAULT_NICKNAME_COLOR,
          passwordHash,
        },
        select: {id: true},
      });
      return syncAnonymousUser(created?.id);
    } catch {
      const raceResolved = await db.user.findUnique({
        where: {
          nickname: ANONYMOUS_AUTHOR_NICKNAME,
        },
        select: {id: true},
      });
      return syncAnonymousUser(raceResolved?.id);
    }
  }

  async ensureSystemDirectForUser(userId: number) {
    await ensureUserInMarxNewsRoom(userId);

    const systemUserId = await this.findSystemUserId();
    if (!systemUserId || systemUserId === userId) return;

    await getOrCreateDirectRoom(systemUserId, userId);
  }
}
