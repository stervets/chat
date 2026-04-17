export type Id = number;

export type User = {
  id: Id;
  nickname: string;
  name: string;
  nicknameColor: string | null;
};

export type Invite = {
  id: Id;
  code: string;
  createdAt: string;
  usedAt?: string | null;
  usedBy?: User | null;
  isUsed: boolean;
};

export type DialogKind = 'general' | 'private';

export type Dialog = {
  id: Id;
  kind: DialogKind;
  title?: string;
  targetUser?: User;
};

export type Message = {
  id: Id;
  dialogId: Id;
  authorId: Id;
  authorNickname: string;
  authorName: string;
  authorNicknameColor: string | null;
  rawText: string;
  renderedHtml: string;
  body?: string;
  createdAt: string;
  reactions: MessageReaction[];
};

export type MessageReactionUser = {
  id: Id;
  nickname: string;
  name: string;
  nicknameColor: string | null;
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
