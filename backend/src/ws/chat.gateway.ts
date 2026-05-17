import {
  WebSocketGateway,
  WebSocketServer as WsServerDecorator,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {Inject, Logger, Optional, type OnModuleDestroy, type OnModuleInit} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {WebSocket, WebSocketServer as WsServer} from 'ws';
import {config} from '../config.js';
import {NativePushService} from '../common/native-push.js';
import type {RoomRow} from '../common/rooms.js';
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
import {ChatCallsService, type CallPublicPayload} from './chat-calls.service.js';
import {MaxReserveBridge} from './max-reserve.bridge.js';
import {
  BACKEND_PEER_ID,
  FRONTEND_PEER_ID,
  RESULT_COMMAND,
  type Packet,
} from './protocol.js';

@WebSocketGateway({
  path: config.wsPath,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WsServerDecorator() server!: WsServer;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly subscriptions = new Map<number, Set<ClientSocket>>();
  private readonly chatDomain = createChatDomain();
  private readonly calls = new ChatCallsService({
    ringTimeoutMs: config.webrtc.callRingTimeoutMs,
  });
  private readonly callCleanupTimer: NodeJS.Timeout;
  private readonly transportHealthTimer: NodeJS.Timeout;
  private readonly commands: ChatCommandMap;
  private readonly nativePushService: NativePushService | null;
  private readonly reserveClients = new Map<string, ClientSocket>();
  private readonly reserveBridge: MaxReserveBridge | null;

  constructor(
    @Optional() @Inject(NativePushService) nativePushService?: NativePushService,
  ) {
    this.nativePushService = nativePushService || null;
    this.commands = createChatCommands(this.createCommandHost());
    this.reserveBridge = config.maxReserve.enabled
      && !!config.maxReserve.privateKey
      && !!config.maxReserve.token
      && !!config.maxReserve.deviceId
      && !!config.maxReserve.wsUrl
      ? new MaxReserveBridge({
        enabled: true,
        wsUrl: config.maxReserve.wsUrl,
        token: config.maxReserve.token,
        chatId: config.maxReserve.chatId,
        chunkTextLimit: config.maxReserve.chunkTextLimit,
        channelRotationEnabled: config.maxReserve.channelRotationEnabled,
        channelRotationMinutes: config.maxReserve.channelRotationMinutes,
        channelSwitchOverlapMs: config.maxReserve.channelSwitchOverlapMs,
        deviceId: config.maxReserve.deviceId,
        privateKeyPem: config.maxReserve.privateKey,
        userAgent: config.maxReserve.userAgent,
      }, {
        onPacket: (envelope) => this.onReservePacket(envelope.clientId, envelope.packet),
      })
      : null;
    this.callCleanupTimer = setInterval(() => this.flushExpiredCalls(), 5000);
    this.callCleanupTimer.unref?.();
    this.transportHealthTimer = setInterval(() => this.logTransportHealth(), 30000);
    this.transportHealthTimer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.callCleanupTimer);
    clearInterval(this.transportHealthTimer);
    this.reserveBridge?.dispose();
  }

  onModuleInit() {
    this.logTransportHealth();
  }

  private createCommandHost(): ChatCommandHost {
    return {
      chat: this.chatDomain,
      calls: this.calls,
      nativePushService: this.nativePushService,
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
      notifyCallEnded: (call) => this.notifyCallEnded(call),
      flushExpiredCalls: () => this.flushExpiredCalls(),
    };
  }

  private isReserveClient(client: ClientSocket) {
    return (client as any).__reserve === true;
  }

  private getOrCreateReserveClient(clientIdRaw: string): ClientSocket {
    const clientId = String(clientIdRaw || '').trim();
    const existing = this.reserveClients.get(clientId);
    if (existing) return existing;

    const client = {
      readyState: WebSocket.OPEN,
      state: {
        id: clientId,
        ip: 'max-reserve',
        userAgent: 'max-reserve',
        token: null,
        user: null,
        roomId: null,
      },
      send: (raw: unknown) => {
        if (!this.reserveBridge) return;
        try {
          const parsed = JSON.parse(String(raw || ''));
          if (!Array.isArray(parsed) || parsed.length < 4) return;
          const com = typeof parsed[0] === 'string' ? parsed[0] : '';
          const args = Array.isArray(parsed[1])
            ? parsed[1]
            : parsed[1] && typeof parsed[1] === 'object'
              ? parsed[1]
              : {};
          const senderId = typeof parsed[2] === 'string' ? parsed[2] : BACKEND_PEER_ID;
          const recipientId = typeof parsed[3] === 'string' ? parsed[3] : client.state.id;
          const requestId = typeof parsed[4] === 'string' ? parsed[4] : undefined;
          if (!com) return;

          void this.reserveBridge.sendPacket([
            com,
            args,
            senderId,
            recipientId,
            requestId,
          ]);
        } catch {
          // ignore malformed packet
        }
      },
    } as unknown as ClientSocket;

    (client as any).__reserve = true;
    this.reserveClients.set(clientId, client);
    return client;
  }

  private async onReservePacket(clientId: string, packet: Packet) {
    const client = this.getOrCreateReserveClient(clientId);
    await this.onParsedPacket(client, [
      packet[0],
      packet[1] && typeof packet[1] === 'object' && !Array.isArray(packet[1]) ? packet[1] as WsArgs : {},
      packet[2],
      packet[3],
      packet[4],
    ]);

    const userId = Number(client.state?.user?.id || 0);
    if (Number.isFinite(userId) && userId > 0) {
      this.reserveBridge?.bindClientToUser(clientId, userId);
      client.state.id = String(userId);
    }
  }

  private forEachWsClient(callback: (client: ClientSocket) => void) {
    for (const rawClient of this.server.clients) {
      callback(rawClient as ClientSocket);
    }
  }

  private forEachAuthorizedWsClient(callback: (client: ClientSocket) => void) {
    this.forEachWsClient((client) => {
      if (!client.state?.user) return;
      callback(client);
    });
  }

  private forEachReserveUserId(callback: (userId: number) => void) {
    const seen = new Set<number>();
    for (const client of this.reserveClients.values()) {
      const userId = Number(client.state?.user?.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) continue;
      if (seen.has(userId)) continue;
      seen.add(userId);
      callback(userId);
    }
  }

  private getDirectWsStats() {
    let open = 0;
    let authorized = 0;
    this.forEachWsClient((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      open += 1;
      if (client.state?.user?.id) {
        authorized += 1;
      }
    });
    return {open, authorized};
  }

  private logTransportHealth() {
    const wsStats = this.getDirectWsStats();
    const reserveUserCount = (() => {
      let count = 0;
      this.forEachReserveUserId(() => {
        count += 1;
      });
      return count;
    })();
    const reserveStatus = this.reserveBridge?.getStatus();

    if (!reserveStatus) {
      this.logger.log(`Transport health wsOpen=${wsStats.open} wsAuthorized=${wsStats.authorized} max=disabled reserveUsers=${reserveUserCount}`);
      return;
    }

    const now = Date.now();
    const lastInMs = reserveStatus.lastInboundAtMs ? now - reserveStatus.lastInboundAtMs : -1;
    const lastOutMs = reserveStatus.lastOutboundAtMs ? now - reserveStatus.lastOutboundAtMs : -1;

    this.logger.log(
      `Transport health wsOpen=${wsStats.open} wsAuthorized=${wsStats.authorized}`
      + ` maxConnected=${reserveStatus.connected ? 1 : 0}`
      + ` maxReconnectAttempt=${reserveStatus.reconnectAttempt}`
      + ` maxChatId=${reserveStatus.currentTransportChatId}`
      + ` maxPrevChats=${reserveStatus.previousTransportChatIds.join(',') || '-'}`
      + ` maxLastInMs=${lastInMs}`
      + ` maxLastOutMs=${lastOutMs}`
      + ` reserveUsers=${reserveUserCount}`,
    );

    if (!reserveStatus.connected && reserveStatus.lastError) {
      this.logger.warn(`MAX health warning lastError=${reserveStatus.lastError}`);
    }
  }

  private sendReservePacket(packet: Packet) {
    if (!this.reserveBridge) return;
    void this.reserveBridge.sendPacket(packet);
  }

  private sendReserveEventToUser(userId: number, com: string, payload: Record<string, unknown> | unknown = {}) {
    if (!this.reserveBridge) return;
    const recipientId = String(userId || '').trim();
    if (!recipientId) return;
    this.sendReservePacket([
      com,
      payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
      BACKEND_PEER_ID,
      recipientId,
    ]);
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
    const userId = Number(client.state?.user?.id || 0);
    this.unsubscribe(client);
    if (Number.isFinite(userId) && userId > 0 && !this.hasOtherOpenSocketForUser(userId, client)) {
      this.notifyCallsEnded(this.calls.endCallsForUser(userId, 'disconnect'));
    }
    this.logger.log(`WS disconnected: ${client.state?.id || 'unknown'}`);
  }

  private hasOtherOpenSocketForUser(userId: number, currentClient: ClientSocket) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (client === currentClient) continue;
      if (client.readyState !== WebSocket.OPEN) continue;
      if (Number(client.state?.user?.id || 0) !== userId) continue;
      return true;
    }

    for (const client of this.reserveClients.values()) {
      if (client === currentClient) continue;
      if (client.readyState !== WebSocket.OPEN) continue;
      if (Number(client.state?.user?.id || 0) !== userId) continue;
      return true;
    }
    return false;
  }

  private notifyCallEnded(call: CallPublicPayload) {
    this.sendCallEvent(call, 'call:ended', call);
  }

  private notifyCallsEnded(calls: CallPublicPayload[]) {
    for (const call of calls) {
      this.notifyCallEnded(call);
    }
  }

  private sendCallEvent(call: CallPublicPayload, com: string, payload: Record<string, unknown> | unknown = {}) {
    const userIds = this.calls.getParticipantUserIds(call);
    for (const userId of userIds) {
      this.sendToUser(userId, com, payload);
    }
  }

  private flushExpiredCalls() {
    this.notifyCallsEnded(this.calls.expireTimedOutCalls());
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

    const reserveUserIds = new Set<number>();
    for (const client of set) {
      if (this.isReserveClient(client)) {
        const userId = Number(client.state?.user?.id || 0);
        if (Number.isFinite(userId) && userId > 0) {
          reserveUserIds.add(userId);
        }
        continue;
      }
      this.sendEvent(client, com, payload);
    }

    for (const userId of reserveUserIds) {
      this.sendReserveEventToUser(userId, com, payload);
    }
  }

  private broadcastToRoomMembers(room: RoomRow, com: string, payload: Record<string, unknown> | unknown = {}) {
    this.forEachAuthorizedWsClient((client) => {
      if (!room.member_user_ids.includes(client.state.user.id)) return;
      this.sendEvent(client, com, payload);
    });

    const reserveUserIds = new Set<number>();
    this.forEachReserveUserId((userId) => {
      if (!room.member_user_ids.includes(userId)) return;
      reserveUserIds.add(userId);
    });
    for (const userId of reserveUserIds) {
      this.sendReserveEventToUser(userId, com, payload);
    }
  }

  private sendToUser(userId: number, com: string, payload: Record<string, unknown> | unknown = {}) {
    this.forEachAuthorizedWsClient((client) => {
      if (client.state.user.id !== userId) return;
      this.sendEvent(client, com, payload);
    });
    this.sendReserveEventToUser(userId, com, payload);
  }

  private broadcastToAuthorized(com: string, payload: Record<string, unknown> | unknown = {}) {
    this.forEachAuthorizedWsClient((client) => {
      this.sendEvent(client, com, payload);
    });

    this.forEachReserveUserId((userId) => {
      this.sendReserveEventToUser(userId, com, payload);
    });
  }

  private getOnlineUserIds() {
    const ids = new Set<number>();
    this.forEachAuthorizedWsClient((client) => {
      const userId = Number(client.state?.user?.id || 0);
      if (!Number.isFinite(userId) || userId <= 0) return;
      ids.add(userId);
    });
    this.forEachReserveUserId((userId) => ids.add(userId));
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

    this.forEachWsClient((client) => {
      if (client.state?.roomId === roomId) {
        client.state.roomId = null;
      }
    });

    for (const client of this.reserveClients.values()) {
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

    this.forEachWsClient((client) => {
      if (Number(client.state?.user?.id || 0) !== userId) return;
      if (client.state?.roomId === roomId) {
        client.state.roomId = null;
      }
    });

    for (const client of this.reserveClients.values()) {
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

  private async onParsedPacket(client: ClientSocket, packet: [string, WsArgs, string, string, string?]) {
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

  private async onPacket(client: ClientSocket, raw: string) {
    const packet = this.parsePacket(raw);
    if (!packet) return;
    await this.onParsedPacket(client, packet);
  }
}
