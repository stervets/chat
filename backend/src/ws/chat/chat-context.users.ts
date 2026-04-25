import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {
  ANONYMOUS_AUTHOR_ID,
  ANONYMOUS_AUTHOR_NAME,
  ANONYMOUS_AUTHOR_NICKNAME,
  AVATAR_PATH_RE,
  ROOM_AVATAR_PATH_RE,
  type MessageAuthorSource,
  type PublicUser,
  type UserRow,
} from './chat-context.types.js';

export class ChatContextUsers {
  toAvatarUrl(raw: unknown) {
    const path = String(raw || '').trim();
    if (!path) return null;
    return AVATAR_PATH_RE.test(path) ? path : null;
  }

  toRoomAvatarUrl(raw: unknown) {
    const path = String(raw || '').trim();
    if (!path) return null;
    return ROOM_AVATAR_PATH_RE.test(path) ? path : null;
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
      info: user.info?.trim() ? user.info.trim() : null,
      avatarUrl: this.toAvatarUrl(user.avatarPath),
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
        authorAvatarUrl: this.toAvatarUrl(sender.avatarPath),
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
        authorAvatarUrl: null,
        authorNicknameColor: null,
        authorDonationBadgeUntil: null,
      };
    }

    return {
      authorId: senderId,
      authorNickname: 'deleted',
      authorName: 'deleted',
      authorAvatarUrl: null,
      authorNicknameColor: DEFAULT_NICKNAME_COLOR,
      authorDonationBadgeUntil: null,
    };
  }
}
