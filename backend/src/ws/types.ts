export type WsEnvelope<T = unknown> = {
  type: string;
  payload?: T;
  requestId?: string;
};

export type WsClientHello = {
  nickname?: string;
};

export type WsMessageSend = {
  dialogId: number;
  body: string;
};

export type WsServerAck = {
  ok: boolean;
};
