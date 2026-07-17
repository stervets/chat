export type Id = number;

export type User = {
  id: Id;
  nickname: string;
  name: string;
  info?: string | null;
  avatarUrl?: string | null;
  nicknameColor: string | null;
  donationBadgeUntil?: string | null;
  isOnline?: boolean;
  pushDisableAllMentions?: boolean;
};


export type DialogKind = 'group' | 'direct' | 'game' | 'comment';

export type DiscussionMeta = {
  sourceMessageId: Id | null;
  sourceRoomId: Id | null;
  sourceRoomKind: DialogKind | null;
  sourceRoomTitle: string | null;
  sourceRoomAvatarUrl?: string | null;
  sourceMessagePreview: string;
  sourceMessageDeleted: boolean;
};

export type Dialog = {
  id: Id;
  kind: DialogKind;
  joined?: boolean;
  title?: string;
  visibility?: 'public' | 'private';
  commentsEnabled?: boolean;
  avatarUrl?: string | null;
  postOnlyByAdmin?: boolean;
  targetUser?: User;
  createdById?: Id | null;
  pinnedNodeId?: Id | null;
  discussion?: DiscussionMeta | null;
};

export type Message = {
  id: Id;
  roomId: Id;
  kind: 'text' | 'system' | 'scriptable';
  authorId: Id;
  authorNickname: string;
  authorName: string;
  authorAvatarUrl?: string | null;
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
  commentCount?: number;
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

