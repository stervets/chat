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

export type DialogKind = 'group' | 'direct';
export type ScriptExecutionMode = 'client' | 'client_server' | 'client_runner';

export type Dialog = {
  id: Id;
  kind: DialogKind;
  title?: string;
  targetUser?: User;
  createdById?: Id | null;
  pinnedMessageId?: Id | null;
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
