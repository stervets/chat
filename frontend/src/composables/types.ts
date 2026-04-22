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

export type DialogKind = 'group' | 'direct' | 'game';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';
export type RoomAppType = 'llm' | 'poll' | 'dashboard' | 'bot_control' | 'custom';
export type GraphNodeKind = 'space' | 'folder' | 'room_ref';
export type GraphTargetType = 'none' | 'room';

export type RoomApp = {
  enabled: boolean;
  appType: RoomAppType | null;
  config: Record<string, any>;
  surfaceMessageId: Id | null;
  surfaceKind: 'text' | 'system' | 'scriptable' | null;
  hasRoomRuntime: boolean;
  requiresRoomRuntime: boolean;
  canCollapseSurface: boolean;
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
  pinnedMessageId?: Id | null;
  roomApp?: RoomApp | null;
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
  scriptId: string | null;
  scriptRevision: number;
  scriptMode: ScriptExecutionMode | null;
  scriptConfigJson: Record<string, any>;
  scriptStateJson: Record<string, any>;
  discussionRoomId: Id | null;
  body?: string;
  createdAt: string;
  reactions: MessageReaction[];
};

export type ScriptEntitySnapshot = {
  entityType: 'message' | 'room';
  entityId: number;
  roomId: number;
  scriptId: string;
  scriptRevision: number;
  scriptMode: ScriptExecutionMode;
  scriptConfigJson: Record<string, any>;
  scriptStateJson: Record<string, any>;
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

export type GraphRoomTarget = {
  id: Id;
  kind: DialogKind;
  title: string | null;
  createdById: Id | null;
  appEnabled: boolean;
  appType: RoomAppType | null;
  pinnedMessageId: Id | null;
};

export type GraphNode = {
  id: Id;
  kind: GraphNodeKind;
  title: string;
  pathSegment: string | null;
  targetType: GraphTargetType;
  targetId: Id | null;
  config: Record<string, any>;
  parentNodeId: Id | null;
  sortOrder: number;
  room: GraphRoomTarget | null;
};
