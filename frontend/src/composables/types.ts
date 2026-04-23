export type Id = number;

export type User = {
  id: Id;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil?: string | null;
  pushDisableAllMentions?: boolean;
};

export type Invite = {
  id: Id;
  code: string;
  createdAt: string;
  usedAt?: string | null;
  usedBy?: User | null;
  isUsed: boolean;
};

export type DialogKind = 'group' | 'direct' | 'game' | 'comment';
export type RoomSurfaceType = 'llm' | 'poll' | 'dashboard' | 'bot_control' | 'custom';

export type RoomSurface = {
  enabled: boolean;
  type: RoomSurfaceType | null;
  config: Record<string, any>;
  pinnedNodeId: Id | null;
  pinnedKind: 'text' | 'system' | 'scriptable' | null;
  hasRoomRuntime: boolean;
  requiresRoomRuntime: boolean;
};

export type DiscussionMeta = {
  sourceMessageId: Id | null;
  sourceRoomId: Id | null;
  sourceRoomKind: DialogKind | null;
  sourceRoomTitle: string | null;
  sourceMessagePreview: string;
  sourceMessageDeleted: boolean;
};

export type Dialog = {
  id: Id;
  kind: DialogKind;
  title?: string;
  targetUser?: User;
  createdById?: Id | null;
  pinnedNodeId?: Id | null;
  roomSurface?: RoomSurface | null;
  discussion?: DiscussionMeta | null;
};

export type Message = {
  id: Id;
  roomId: Id;
  kind: 'text' | 'system' | 'scriptable';
  authorId: Id;
  authorNickname: string;
  authorName: string;
  authorNicknameColor: string | null;
  authorDonationBadgeUntil?: string | null;
  rawText: string;
  renderedHtml: string;
  renderedPreviews?: Array<{
    key: string;
    type: 'image' | 'video' | 'embed' | 'youtube';
    src: string;
    href?: string;
  }>;
  runtime: {
    clientScript: string | null;
    serverScript: string | null;
    data: Record<string, any>;
  };
  commentRoomId: Id | null;
  body?: string;
  createdAt: string;
  reactions: MessageReaction[];
};

export type ScriptEntitySnapshot = {
  nodeType: 'message' | 'room';
  nodeId: number;
  roomId: number;
  clientScript: string | null;
  serverScript: string | null;
  data: Record<string, any>;
};

export type MessageReactionUser = {
  id: Id;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil?: string | null;
};

export type MessageReaction = {
  emoji: string;
  users: MessageReactionUser[];
};

export type Session = {
  id: string;
  userId: Id;
  expiresAt: string;
};

export type WsEnvelope<T = unknown> = {
  type: string;
  payload?: T;
  requestId?: string;
};
