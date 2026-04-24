export const BACKEND_PEER_ID = 'backend';
export const FRONTEND_PEER_ID = 'frontend';
export const RESULT_COMMAND = '[res]';

export type PacketArgs = Record<string, any> | any[];

export type Packet = [
  com: string,
  args: PacketArgs,
  senderId: string,
  recipientId: string,
  requestId?: string,
];

export type SocketUser = {
  id: number;
  nickname: string;
  name: string;
  info: string | null;
  avatarUrl: string | null;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
  pushDisableAllMentions: boolean;
};

export type SocketState = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  token: string | null;
  user: SocketUser | null;
  roomId: number | null;
};
