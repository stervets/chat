import {
  WebSocketGateway,
  WebSocketServer as WsServerDecorator,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {Inject, Logger, Optional} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {WebSocket, WebSocketServer as WsServer} from 'ws';
import {config} from '../config.js';
import type {RoomRow} from '../common/rooms.js';
import {WebPushService} from '../common/web-push.js';
import {
  createChatCommands,
  type ChatCommandHost,
  type ChatCommandMap,
  type ClientSocket,
  type WsArgs,
  type WsError,
  type WsFailure,
  type WsResponse,
  type WsSuccess,
} from './chat.commands.js';
import {createChatDomain} from './chat.domain.js';
import {
  BACKEND_PEER_ID,
  FRONTEND_PEER_ID,
  RESULT_COMMAND,
  type Packet,
} from './protocol.js';

@WebSocketGateway({
  path: config.wsPath,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WsServerDecorator() server!: WsServer;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly subscriptions = new Map<number, Set<ClientSocket>>();
  private readonly chatDomain = createChatDomain();
  private readonly commands: ChatCommandMap;
  private readonly webPushService: WebPushService | null;

  constructor(
    @Optional() @Inject(WebPushService) webPushService?: WebPushService,
  ) {
    this.webPushService = webPushService || null;
    this.commands = createChatCommands(this.createCommandHost());
  }

  private createCommandHost(): ChatCommandHost {
    return {
      chat: this.chatDomain,
      webPushService: this.webPushService,
      fail: (errorRaw) => this.fail(errorRaw),
      subscribe: (client, roomId) => this.subscribe(client, roomId),
      unsubscribe: (client) => this.unsubscribe(client),
      broadcast: (roomId, com, payload) => this.broadcast(roomId, com, payload),
      broadcastToRoomMembers: (room, com, payload) => this.broadcastToRoomMembers(room, com, payload),
      sendToUser: (userId, com, payload) => this.sendToUser(userId, com, payload),
      broadcastToAuthorized: (com, payload) => this.broadcastToAuthorized(com, payload),
      getOnlineUserIds: () => this.getOnlineUserIds(),
      closeRoomSubscriptions: (roomId) => this.closeRoomSubscriptions(roomId),
      removeUserFromRoomSubscriptions: (roomId, userIdRaw) => this.removeUserFromRoomSubscriptions(roomId, userIdRaw),
    };
  }

  handleConnection(client: ClientSocket, ...args: any[]) {
    const request = args[0] as IncomingMessage | undefined;
    const remoteAddress = request?.socket?.remoteAddress || null;
    const userAgent = request?.headers['user-agent'] || null;

    client.state = {
      id: randomBytes(8).toString('hex'),
      ip: remoteAddress,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
      token: null,
      user: null,
      roomId: null,
    };

    client.on('message', (raw) => {
      void this.onPacket(client, raw.toString());
    });

    this.logger.log(`WS connected: ${client.state.id}`);
  }

  handleDisconnect(client: ClientSocket) {
    this.unsubscribe(client);
    this.logger.log(`WS disconnected: ${client.state?.id || 'unknown'}`);
  }

  private parsePacket(raw: string): [string, WsArgs, string, string, string?] | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 4) return null;

      const com = typeof parsed[0] === 'string' ? parsed[0] : '';
      if (!com) return null;
      const args = parsed[1] && typeof parsed[1] === 'object' && !Array.isArray(parsed[1])
        ? parsed[1] as WsArgs
        : {};
      const senderId = typeof parsed[2] === 'string' ? parsed[2] : FRONTEND_PEER_ID;
      const recipientId = typeof parsed[3] === 'string' ? parsed[3] : BACKEND_PEER_ID;
      const requestId = typeof parsed[4] === 'string' ? parsed[4] : undefined;

      return [com, args, senderId, recipientId, requestId];
    } catch {
      return null;
    }
  }

  private sendPacket(client: ClientSocket, packet: Packet) {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(packet));
  }

  private sendResult(client: ClientSocket, recipientId: string, requestId: string, value: unknown) {
    this.sendPacket(client, [
      RESULT_COMMAND,
      [value],
      BACKEND_PEER_ID,
      recipientId || FRONTEND_PEER_ID,
      requestId,
    ]);
  }

  private sendEvent(client: ClientSocket, com: string, payload: Record<string, unknown> | unknown = {}) {
    this.sendPacket(client, [
      com,
      payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
      BACKEND_PEER_ID,
      client.state?.id || FRONTEND_PEER_ID,
    ]);
  }

  private subscribe(client: ClientSocket, roomId: number) {
    this.unsubscribe(client);

    let set = this.subscriptions.get(roomId);
    if (!set) {
      set = new Set();
      this.subscriptions.set(roomId, set);
    }
    set.add(client);
  }

  private unsubscribe(client: ClientSocket) {
    const roomId = client.state?.roomId;
    if (!roomId) return;
    const set = this.subscriptions.get(roomId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      this.subscriptions.delete(roomId);
    }
  }

  private broadcast(roomId: number, com: string, payload: Record<string, unknown> | unknown = {}) {
    const set = this.subscriptions.get(roomId);
    if (!set) return;
    for (const client of set) {
      this.sendEvent(client, com, payload);
    }
  }

  private broadcastToRoomMembers(room: RoomRow, com: string, payload: Record<string, unknown> | unknown = {}) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (!room.member_user_ids.includes(client.state.user.id)) continue;
      this.sendEvent(client, com, payload);
    }
  }

  private sendToUser(userId: number, com: string, payload: Record<string, unknown> | unknown = {}) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (client.state.user.id !== userId) continue;
      this.sendEvent(client, com, payload);
    }
  }

  private broadcastToAuthorized(com: string, payload: Record<string, unknown> | unknown = {}) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      this.sendEvent(client, com, payload);
    }
  }

  private getOnlineUserIds() {
    const ids = new Set<number>();
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      const userId = Number(client.state?.user?.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) continue;
      ids.add(userId);
    }
    return Array.from(ids);
  }

  private closeRoomSubscriptions(roomId: number) {
    const set = this.subscriptions.get(roomId);
    if (set) {
      for (const client of set) {
        if (client.state?.roomId === roomId) {
          client.state.roomId = null;
        }
      }
      this.subscriptions.delete(roomId);
    }

    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (client.state?.roomId === roomId) {
        client.state.roomId = null;
      }
    }
  }

  private removeUserFromRoomSubscriptions(roomId: number, userIdRaw: unknown) {
    const userId = Number(userIdRaw || 0);
    if (!Number.isFinite(userId) || userId <= 0) return;

    const set = this.subscriptions.get(roomId);
    if (set) {
      for (const client of Array.from(set)) {
        if (Number(client.state?.user?.id || 0) !== userId) continue;
        if (client.state?.roomId === roomId) {
          client.state.roomId = null;
        }
        set.delete(client);
      }
      if (set.size === 0) {
        this.subscriptions.delete(roomId);
      }
    }

    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (Number(client.state?.user?.id || 0) !== userId) continue;
      if (client.state?.roomId === roomId) {
        client.state.roomId = null;
      }
    }
  }

  private ok<T>(data: T): WsSuccess<T> {
    return {ok: true, data};
  }

  private normalizeWsError(errorRaw: unknown): WsError {
    if (typeof errorRaw === 'string') return errorRaw;

    if (errorRaw && typeof errorRaw === 'object') {
      const maybeMessage = (errorRaw as {message?: unknown}).message;
      const maybeCode = (errorRaw as {code?: unknown}).code;
      const message = String(maybeMessage || '').trim();

      if (message) {
        if (typeof maybeCode === 'string' || typeof maybeCode === 'number') {
          return {
            message,
            code: maybeCode,
          };
        }
        return {message};
      }
    }

    return 'server_error';
  }

  private fail(errorRaw: unknown): WsFailure {
    return {
      ok: false,
      error: this.normalizeWsError(errorRaw),
    };
  }

  private normalizeResult<T>(resultRaw: unknown): WsResponse<T> {
    if (resultRaw && typeof resultRaw === 'object') {
      const result = resultRaw as Record<string, unknown>;
      if (result.ok === false) {
        return this.fail(result.error);
      }

      if (result.ok === true) {
        const keys = Object.keys(result);
        if (keys.length === 2 && Object.prototype.hasOwnProperty.call(result, 'data')) {
          return this.ok(result.data as T);
        }

        const rest: Record<string, unknown> = {...result};
        delete rest.ok;
        return this.ok(rest as T);
      }
    }

    return this.ok(resultRaw as T);
  }

  private async dispatch(client: ClientSocket, com: string, args: WsArgs) {
    const command = this.commands[com];

    if (!command) {
      return {ok: false, error: `handler_not_found:${com}`};
    }

    const context = {
      client,
      args,
      vars: {},
    };

    try {
      const result = this.normalizeResult(await command.run(context));
      await command.after?.(context, result);
      return result;
    } catch (error) {
      this.logger.error((error as {message?: string})?.message || String(error));
      return this.fail(error);
    }
  }

  private async onPacket(client: ClientSocket, raw: string) {
    const packet = this.parsePacket(raw);
    if (!packet) return;

    const [com, args, senderId, _recipientId, requestId] = packet;
    if (com === RESULT_COMMAND) return;

    try {
      const result = await this.dispatch(client, com, args);
      if (requestId) {
        this.sendResult(client, senderId, requestId, result);
      }
    } catch (err: any) {
      this.logger.error(err?.message || String(err));
      if (requestId) {
        this.sendResult(client, senderId, requestId, this.fail(err));
      }
    }
  }
}
