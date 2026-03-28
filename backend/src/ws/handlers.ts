import {WebSocket} from 'ws';
import type {WsEnvelope} from './types.js';
import {db} from '../db.js';
import {getDialogById, userCanAccessDialog} from '../common/dialogs.js';

type WsUser = {
  id: number;
  nickname: string;
};

type WsSocket = WebSocket & {
  user?: WsUser;
  dialogId?: number;
};

const MAX_MESSAGE_LENGTH = 4000;

export function registerWsHandlers() {
  const handlers: Record<string, (payload: any, socket: WsSocket) => Promise<void> | void> = {};
  const subscriptions = new Map<number, Set<WsSocket>>();

  const send = (socket: WsSocket, type: string, payload?: any) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({type, payload}));
  };

  const subscribe = (socket: WsSocket, dialogId: number) => {
    if (socket.dialogId) {
      const oldSet = subscriptions.get(socket.dialogId);
      if (oldSet) {
        oldSet.delete(socket);
        if (oldSet.size === 0) {
          subscriptions.delete(socket.dialogId);
        }
      }
    }

    let set = subscriptions.get(dialogId);
    if (!set) {
      set = new Set();
      subscriptions.set(dialogId, set);
    }
    set.add(socket);
    socket.dialogId = dialogId;
  };

  const broadcast = (dialogId: number, payload: any) => {
    const set = subscriptions.get(dialogId);
    if (!set) return;
    for (const client of set) {
      send(client, 'chat:message', payload);
    }
  };

  handlers['chat:join'] = async (payload, socket) => {
    const dialogId = Number.parseInt(payload?.dialogId, 10);
    if (!Number.isFinite(dialogId)) {
      send(socket, 'chat:error', {message: 'invalid_dialog'});
      return;
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog) {
      send(socket, 'chat:error', {message: 'dialog_not_found'});
      return;
    }

    if (!socket.user || !userCanAccessDialog(socket.user.id, dialog)) {
      send(socket, 'chat:error', {message: 'forbidden'});
      return;
    }

    subscribe(socket, dialogId);
  };

  handlers['chat:send'] = async (payload, socket) => {
    if (!socket.user) {
      send(socket, 'chat:error', {message: 'unauthorized'});
      return;
    }

    const dialogId = Number.parseInt(payload?.dialogId, 10);
    if (!Number.isFinite(dialogId)) {
      send(socket, 'chat:error', {message: 'invalid_dialog'});
      return;
    }

    const dialog = await getDialogById(dialogId);
    if (!dialog || !userCanAccessDialog(socket.user.id, dialog)) {
      send(socket, 'chat:error', {message: 'forbidden'});
      return;
    }

    const rawBody = (payload?.body || '').toString();
    const trimmed = rawBody.trim();
    if (!trimmed) return;

    const body = trimmed.length > MAX_MESSAGE_LENGTH
      ? trimmed.slice(0, MAX_MESSAGE_LENGTH)
      : trimmed;

    const createdAt = new Date().toISOString();
    const result = db.prepare(
      'insert into messages (dialog_id, sender_id, body, created_at) values (?, ?, ?, ?)'
    ).run(dialogId, socket.user.id, body, createdAt);

    const message = {
      id: Number(result.lastInsertRowid),
      dialogId,
      authorId: socket.user.id,
      authorNickname: socket.user.nickname,
      body,
      createdAt,
    };

    broadcast(dialogId, message);
  };

  const handleMessage = async (socket: WsSocket, data: string) => {
    let event: WsEnvelope | null = null;
    try {
      event = JSON.parse(data);
    } catch (e) {
      return;
    }

    const handler = event && handlers[event.type];
    if (!handler) return;

    try {
      await handler(event.payload, socket);
    } catch (err) {
      console.error(err);
      send(socket, 'chat:error', {message: 'server_error'});
    }
  };

  const onClose = (socket: WsSocket) => {
    if (socket.dialogId) {
      const set = subscriptions.get(socket.dialogId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          subscriptions.delete(socket.dialogId);
        }
      }
    }
  };

  return {
    handlers,
    handleMessage,
    onClose
  };
}
