import type {User} from '@/composables/types';
import type {RoomSurface} from '@/composables/types';

export type DirectDialog = {
  roomId: number;
  targetUser: User;
  lastMessageAt: string;
  createdById?: number | null;
  pinnedNodeId?: number | null;
  roomSurface?: RoomSurface | null;
};



export type DirectCallPhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'connected' | 'ended';
export type DirectCallDirection = 'incoming' | 'outgoing' | null;
export type DirectCallStatus = 'ringing' | 'accepted' | 'ended';
export type DirectCallEndReason = 'hangup' | 'reject' | 'timeout' | 'busy' | 'failed' | 'disconnect' | null;

export type DirectCallUser = Pick<User, 'id' | 'nickname' | 'name' | 'avatarUrl' | 'nicknameColor' | 'donationBadgeUntil'>;

export type DirectCallPayload = {
  callId: string;
  roomId: number;
  status: DirectCallStatus;
  callerUserId: number;
  calleeUserId: number;
  caller: DirectCallUser;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  endReason: DirectCallEndReason;
};

export type DirectCallSignalPayload = {
  callId: string;
  roomId: number;
  fromUserId: number;
  toUserId: number;
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: unknown;
};

export type LinkPreview = {
  key: string;
  type: 'image' | 'video' | 'embed' | 'youtube';
  src: string;
  href?: string;
};

export type NotificationItem = {
  id: number;
  roomId: number;
  roomKind: 'group' | 'direct' | 'comment' | 'unknown';
  notificationType: 'message' | 'reaction' | 'comment';
  authorId: number;
  authorName: string;
  authorNickname: string;
  authorNicknameColor: string | null;
  authorDonationBadgeUntil: string | null;
  body: string;
  createdAt: string;
  unread: boolean;
  targetUser: User | null;
  targetMessageId?: number;
  reactionEmoji?: string;
};

export type ToastItem = {
  id: number;
  title: string;
  body: string;
  notificationId?: number;
};

export type RouteMode = 'push' | 'replace' | 'none';

export type SoundRuntimeState = {
  overlayHandled: boolean;
  soundReady: boolean;
};

export const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MENTION_TAG_RE = /@([a-zA-Z0-9._-]+)/g;
export const REACTION_EMOJIS = ['🙂', '👍', '😂', '🔥', '❤️', '🤔', '☹️', '😡', '👎', '😢'];
export const MAX_PASTE_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_IMAGE_DIMENSION = 1024;
export const HISTORY_BATCH_SIZE = 100;
export const VIRTUAL_MAX_ITEMS = 300;
export const VIRTUAL_OVERSCAN = 40;
export const VIRTUAL_ESTIMATED_ITEM_HEIGHT = 132;
export const COLOR_HEX_FULL_RE = /^#[0-9a-fA-F]{6}$/;
export const COMPOSER_NAMED_COLORS = [
  {name: 'red', swatch: '#ff5d5d'},
  {name: 'green', swatch: '#79d279'},
  {name: 'blue', swatch: '#6aa8ff'},
  {name: 'yellow', swatch: '#ffd75f'},
  {name: 'orange', swatch: '#ff9f43'},
  {name: 'gray', swatch: '#9ba7b8'},
  {name: 'cyan', swatch: '#56d7ff'},
  {name: 'purple', swatch: '#be8cff'},
];
export const COMPOSER_EMOJIS = ['🙂', '😀', '😉', '😎', '🤔', '😴', '🥳', '🔥', '💬', '✅', '❤️', '👍', '👎', '😢', '😡', '😂'];
export const HANDLED_MESSAGE_IDS_SAVE_DELAY_MS = 180;
export const NOTIFICATION_SOUND_VOLUME = 0.35;
export const MAX_ACTIVE_BROWSER_NOTIFICATIONS = 6;
export const DONATION_BADGE_FADE_MS = 5 * 24 * 60 * 60 * 1000;
