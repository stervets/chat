export const BACKEND_PEER_ID = 'backend';
export const FRONTEND_PEER_ID = 'frontend';
export const RESULT_COMMAND = '[res]';

export type Packet = [
  com: string,
  args: any[],
  senderId: string,
  recipientId: string,
  requestId?: string,
];

export type SocketUser = {
  id: number;
  nickname: string;
  name: string;
  nicknameColor: string | null;
  donationBadgeUntil: string | null;
};

export type SocketState = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  token: string | null;
  user: SocketUser | null;
  dialogId: number | null;
};
