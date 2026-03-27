export type Id = number;

export type User = {
  id: Id;
  nickname: string;
};

export type Invite = {
  id: Id;
  code: string;
  createdAt: string;
  usedAt?: string | null;
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
  body: string;
  createdAt: string;
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
