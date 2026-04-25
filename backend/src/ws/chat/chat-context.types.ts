import type {MessageLinkPreview} from '../../common/message-format.js';

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_USER_NAME_LENGTH = 80;
export const MAX_USER_INFO_LENGTH = 2000;
export const MAX_PASSWORD_LENGTH = 256;
export const MIN_PASSWORD_LENGTH = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DONATION_BADGE_TTL_DAYS = 30;
export const MAX_MESSAGES_PAGE_LIMIT = 100;
export const MAX_MESSAGES_PER_ROOM = 5000;
export const SYSTEM_NICKNAME = 'marx';
export const ANONYMOUS_AUTHOR_ID = 0;
export const ANONYMOUS_AUTHOR_NICKNAME = 'anonymous';
export const ANONYMOUS_AUTHOR_NAME = 'Аноним';

export const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const UPLOAD_LINK_RE = /\/uploads\/([a-zA-Z0-9._-]+)/gi;
export const AVATAR_PATH_RE = /^\/uploads\/[a-zA-Z0-9._-]+$/;
export const ROOM_AVATAR_PATH_RE = /^\/(?:uploads\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+\.(?:png|jpe?g|webp|gif|svg))$/i;
export const ALLOWED_REACTIONS = new Set([
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
export const TAIL_TIME_SCAN_BATCH = 200;

export type ApiError = {ok: false; error: string};
export type ApiOk<T> = {ok: true} & T;

export type PublicUser = {
  id: number;
  nickname: string;
  name: string;
  info: string | null;
  avatarUrl: string | null;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
  pushDisableAllMentions: boolean;
};

export type UserRow = {
  id: number;
  nickname: string;
  name: string | null;
  info?: string | null;
  avatarPath?: string | null;
  nicknameColor: string | null;
  donationBadgeUntil?: Date | null;
  pushDisableAllMentions?: boolean;
};

export type MessageReactionUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
};

export type MessageReaction = {
  emoji: string;
  users: MessageReactionUser[];
};

export type TimeRefCandidate = {
  id: number;
  index: number;
  tooltip: string;
};

export type RoomMessageRenderContext = {
  mentionsByToken: Map<string, {
    nickname: string;
    name: string;
    nicknameColor: string | null;
  }>;
  timeCandidatesByLabel: Map<string, TimeRefCandidate[]>;
  messageIndexById: Map<number, number>;
  timelineSize: number;
};

export type MessageAuthorSource = {
  senderId?: number | null;
  sender?: {
    id?: number;
    nickname?: string | null;
    name?: string | null;
    avatarPath?: string | null;
    nicknameColor?: string | null;
    donationBadgeUntil?: Date | string | null;
  } | null;
};

export type ChatContextMessagePayload = {
  id: number;
  roomId: number;
  dialogId?: number;
  kind: 'text' | 'system' | 'scriptable';
  authorId: number;
  authorNickname: string;
  authorName: string;
  authorAvatarUrl?: string | null;
  authorNicknameColor: string | null;
  authorDonationBadgeUntil: string | null;
  rawText: string;
  renderedHtml: string;
  renderedPreviews: MessageLinkPreview[];
  runtime: {
    clientScript: string | null;
    serverScript: string | null;
    data: Record<string, any>;
  };
  commentRoomId?: number | null;
  commentCount?: number;
  createdAt: string;
  reactions: MessageReaction[];
};
