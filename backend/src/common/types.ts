export type Id = number;

export type User = {
  id: Id;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
};

export type DialogKind = 'general' | 'private';

export type Dialog = {
  id: Id;
  kind: DialogKind;
  memberA?: Id | null;
  memberB?: Id | null;
};

export type Message = {
  id: Id;
  dialogId: Id;
  senderId: Id;
  rawText: string;
  renderedHtml: string;
  createdAt: string;
  expiresAt: string;
};

export type Session = {
  id: string;
  userId: Id;
  token: string;
  expiresAt: string;
};
