import {DEFAULT_NICKNAME_COLOR} from '../../common/const.js';
import {isValidNickname, normalizeNickname} from '../../common/nickname.js';
import {
  ALLOWED_REACTIONS,
  AVATAR_PATH_RE,
  COLOR_HEX_RE,
  MAX_MESSAGES_PAGE_LIMIT,
  MAX_USER_INFO_LENGTH,
  MAX_USER_NAME_LENGTH,
  ROOM_AVATAR_PATH_RE,
} from './chat-context.types.js';

export class ChatContextInput {
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

  parseAvatarPath(raw: unknown) {
    if (raw === undefined) return {ok: true, value: undefined as string | null | undefined};
    if (raw === null) return {ok: true, value: null};

    const value = String(raw || '').trim();
    if (!value) return {ok: true, value: null};
    if (!AVATAR_PATH_RE.test(value)) {
      return {ok: false, error: 'invalid_avatar_path'};
    }
    return {ok: true, value};
  }

  parseRoomAvatarPath(raw: unknown) {
    if (raw === undefined) return {ok: true, value: undefined as string | null | undefined};
    if (raw === null) return {ok: true, value: null};

    const value = String(raw || '').trim();
    if (!value) return {ok: true, value: null};
    if (!ROOM_AVATAR_PATH_RE.test(value)) {
      return {ok: false, error: 'invalid_avatar_path'};
    }
    return {ok: true, value};
  }

  normalizeUserInfo(raw: unknown) {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    return value.slice(0, MAX_USER_INFO_LENGTH);
  }

  normalizeNicknameColor(raw: unknown) {
    const parsed = this.parseNicknameColor(raw);
    return parsed.ok ? (parsed.value || DEFAULT_NICKNAME_COLOR) : DEFAULT_NICKNAME_COLOR;
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
}
