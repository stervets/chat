import {
  WebSocketGateway,
  WebSocketServer as WsServerDecorator,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {Inject, Logger} from '@nestjs/common';
import {randomBytes} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {WebSocket, WebSocketServer as WsServer} from 'ws';
import {config} from '../config.js';
import {getRoomById, type RoomRow} from '../common/rooms.js';
import {WebPushService} from '../common/web-push.js';
import {ChatService} from './chat.service.js';
import {
  SYSTEM_NICKNAME,
  type ChatContextMessagePayload,
} from './chat/chat-context.js';
import {
  BACKEND_PEER_ID,
  FRONTEND_PEER_ID,
  RESULT_COMMAND,
  type Packet,
  type SocketState,
} from './protocol.js';

type ClientSocket = WebSocket & {
  state: SocketState;
};

type WsArgs = Record<string, unknown>;
type WsErrorObject = {message: string; code?: string | number};
type WsError = string | WsErrorObject;
type WsSuccess<T> = {ok: true; data: T};
type WsFailure = {ok: false; error: WsError};
type WsResponse<T> = WsSuccess<T> | WsFailure;

type AuthSessionPayload = {token?: string};
type AuthLoginPayload = {nickname?: string; password?: string};
type AuthUpdateProfilePayload = {
  name?: string;
  info?: string | null;
  avatarPath?: string | null;
  nicknameColor?: string | null;
  pushDisableAllMentions?: boolean;
};
type AuthChangePasswordPayload = {newPassword?: string};

type RoomGetPayload = {roomId?: number; subscribe?: boolean};
type RoomListPayload = {kind?: string; scope?: 'joined' | 'public' | 'all' | string};
type RoomCreatePayload = {
  title?: string;
  visibility?: 'public' | 'private' | string;
  commentsEnabled?: boolean;
  avatarPath?: string | null;
  postOnlyByAdmin?: boolean;
};
type RoomDeletePayload = {roomId?: number; confirm?: boolean};
type RoomJoinPayload = {roomId?: number};
type RoomLeavePayload = {roomId?: number};
type UserGetPayload = {userId?: number; nickname?: string};
type ContactPayload = {userId?: number};
type RoomMembersListPayload = {roomId?: number};
type RoomMembersAddPayload = {roomId?: number; userIds?: number[]};
type RoomMembersRemovePayload = {roomId?: number; userIds?: number[]};
type RoomSettingsUpdatePayload = {
  roomId?: number;
  title?: string;
  visibility?: 'public' | 'private' | string;
  commentsEnabled?: boolean;
  avatarPath?: string | null;
  postOnlyByAdmin?: boolean;
};

type MessageListPayload = {roomId?: number; limit?: number; beforeMessageId?: number};
type MessageCreatePayload = {
  roomId?: number;
  text?: string;
  body?: string;
  kind?: string;
  silent?: boolean;
  [key: string]: unknown;
};
type MessageUpdatePayload = {messageId?: number; text?: string; body?: string};
type MessageDeletePayload = {messageId?: number};

type ReactionSetPayload = {messageId?: number; emoji?: string | null};

type RuntimeActionPayload = {
  nodeType?: 'message' | 'room' | string;
  nodeId?: number;
  actionType?: string;
  payload?: unknown;
};

type RoomGetData = {roomId: number; [key: string]: unknown};
type RoomDeleteData = {
  changed: boolean;
  roomId: number;
  dialogId: number;
  kind: 'group' | 'direct' | 'game' | 'comment';
};
type MessageCreateData = {
  message: ChatContextMessagePayload;
  notifyComment?: {
    userId: number;
    roomId: number;
    roomKind: 'comment';
    messageId: number;
    sourceMessageId: number;
    sourceRoomId: number | null;
    sourceMessagePreview: string;
    actor: {
      id: number;
      nickname: string;
      name: string;
      avatarUrl: string | null;
      nicknameColor: string | null;
      donationBadgeUntil: string | null;
    };
    messageBody: string;
    createdAt: string;
  } | null;
};
type MessageUpdateData = {
  changed: boolean;
  message: {
    roomId: number;
    [key: string]: unknown;
  };
};
type MessageDeleteData = {
  changed: boolean;
  roomId: number;
  dialogId: number;
  messageId: number;
  pinnedCleared: boolean;
};
type ReactionSetData = {
  changed: boolean;
  roomId: number;
  dialogId: number;
  messageId: number;
  reactions: unknown[];
  notify: ({userId: number; [key: string]: unknown} | null);
};
type RuntimeActionData = {
  roomId: number;
  nodeType: string;
  nodeId: number;
  data: unknown;
};

const STRICT_WS_COMMANDS = new Set<string>([
  'auth:login',
  'auth:session',
  'auth:me',
  'auth:logout',
  'auth:updateProfile',
  'auth:changePassword',
  'room:get',
  'room:list',
  'room:create',
  'room:delete',
  'message:create',
  'message:update',
  'message:delete',
  'message:list',
  'message:reaction:set',
  'runtime:action',
]);

@WebSocketGateway({
  path: config.wsPath,
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WsServerDecorator() server!: WsServer;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly subscriptions = new Map<number, Set<ClientSocket>>();

  constructor(
    @Inject(ChatService)
    private readonly chatService: ChatService,
    @Inject(WebPushService)
    private readonly webPushService: WebPushService,
  ) {}

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

  private isStrictWsCommand(com: string) {
    return STRICT_WS_COMMANDS.has(com);
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

  private async dispatchStrictCommand(
    client: ClientSocket,
    com: string,
    args: WsArgs,
  ): Promise<WsResponse<unknown> | null> {
    if (!this.isStrictWsCommand(com)) return null;

    try {
      if (com === 'auth:login') {
        return this.normalizeResult(await this.chatService.authLogin(client.state, args as AuthLoginPayload));
      }

      if (com === 'auth:session') {
        const payload = args as AuthSessionPayload;
        return this.normalizeResult(await this.chatService.authSession(client.state, payload.token));
      }

      if (com === 'auth:me') {
        return this.normalizeResult(await this.chatService.authMe(client.state));
      }

      if (com === 'auth:logout') {
        const result = this.normalizeResult(await this.chatService.authLogout(client.state));
        if (result.ok) {
          this.unsubscribe(client);
        }
        return result;
      }

      if (com === 'auth:updateProfile') {
        const result = this.normalizeResult(await this.chatService.authUpdateProfile(client.state, args as AuthUpdateProfilePayload));
        if (result.ok && (result.data as any)?.user) {
          this.broadcastToAuthorized('user:updated', (result.data as any).user);
        }
        return result;
      }

      if (com === 'auth:changePassword') {
        return this.normalizeResult(await this.chatService.authChangePassword(client.state, args as AuthChangePasswordPayload));
      }

      if (com === 'room:get') {
        const payload = args as RoomGetPayload;
        const result = this.normalizeResult<RoomGetData>(await this.chatService.roomGet(client.state, payload.roomId));
        if (result.ok) {
          const roomId = Number(result.data.roomId || 0);
          if (payload.subscribe !== false && Number.isFinite(roomId) && roomId > 0) {
            this.subscribe(client, roomId);
          }
        }
        return result;
      }

      if (com === 'room:list') {
        const payload = args as RoomListPayload;
        const kind = String(payload.kind || '').trim().toLowerCase();
        if (kind === 'direct') {
          return this.normalizeResult(await this.chatService.roomListDirect(client.state));
        }
        if (kind === 'group') {
          return this.normalizeResult(await this.chatService.roomListJoined(client.state, payload.scope));
        }
        return this.fail('invalid_room_kind');
      }

      if (com === 'room:create') {
        return this.normalizeResult(await this.chatService.roomCreate(client.state, args as RoomCreatePayload));
      }

      if (com === 'room:delete') {
        const payload = args as RoomDeletePayload;
        const parsedRoomId = Number.parseInt(String(payload.roomId ?? ''), 10);
        const roomBeforeDelete = Number.isFinite(parsedRoomId) && parsedRoomId > 0
          ? await getRoomById(parsedRoomId)
          : null;
        const result = this.normalizeResult<RoomDeleteData>(await this.chatService.roomDelete(client.state, payload.roomId, payload));
        if (result.ok && result.data.changed) {
          const isDirectClear = result.data.kind === 'direct';
          if (roomBeforeDelete && isDirectClear) {
            this.broadcastToRoomMembers(roomBeforeDelete, 'room:messages:cleared', {
              roomId: result.data.roomId,
              dialogId: result.data.dialogId,
              kind: result.data.kind,
            });
          }
          if (roomBeforeDelete && !isDirectClear) {
            this.broadcastToRoomMembers(roomBeforeDelete, 'room:deleted', {
              roomId: result.data.roomId,
              dialogId: result.data.dialogId,
              kind: result.data.kind,
            });
          }
          if (!isDirectClear) {
            this.closeRoomSubscriptions(result.data.roomId);
          }
        }
        return result;
      }

      if (com === 'message:create') {
        const payload = args as MessageCreatePayload;
        const kind = String(payload.kind || 'text').trim().toLowerCase();
        const rawResult = kind === 'scriptable'
          ? await this.chatService.messageCreateScriptable(client.state, payload.roomId, payload)
          : await this.chatService.messageCreate(client.state, payload.roomId, payload.text ?? payload.body, payload);

        const result = this.normalizeResult<MessageCreateData>(rawResult);
        if (result.ok && result.data.message) {
          const room = await getRoomById(result.data.message.roomId);
          const silentRequested = Boolean(payload.silent);
          const skipPush = silentRequested && client.state?.user?.nickname === SYSTEM_NICKNAME;
          if (room) {
            this.broadcastToRoomMembers(room, 'message:created', result.data.message);
            if (result.data.notifyComment?.userId) {
              this.sendToUser(result.data.notifyComment.userId, 'message:comment:notify', result.data.notifyComment);
            }
            if (!skipPush) {
              void this.webPushService.sendChatMessagePush({
                room,
                message: result.data.message,
                senderId: Number(client.state?.user?.id || 0),
                excludeUserIds: this.getOnlineUserIds(),
              });
            }
          } else {
            this.broadcast(result.data.message.roomId, 'message:created', result.data.message);
          }

        }
        return result;
      }

      if (com === 'message:update') {
        const payload = args as MessageUpdatePayload;
        const result = this.normalizeResult<MessageUpdateData>(
          await this.chatService.messageUpdate(client.state, payload.messageId, payload.text ?? payload.body),
        );
        if (result.ok && result.data.changed && result.data.message) {
          const room = await getRoomById(result.data.message.roomId);
          if (room) {
            this.broadcastToRoomMembers(room, 'message:updated', result.data.message);
          } else {
            this.broadcast(result.data.message.roomId, 'message:updated', result.data.message);
          }
        }
        return result;
      }

      if (com === 'message:delete') {
        const payload = args as MessageDeletePayload;
        const result = this.normalizeResult<MessageDeleteData>(await this.chatService.messageDelete(client.state, payload.messageId));
        if (result.ok && result.data.changed) {
          const room = await getRoomById(result.data.roomId);
          const payloadForEvent = {
            roomId: result.data.roomId,
            dialogId: result.data.dialogId,
            messageId: result.data.messageId,
          };

          if (room) {
            this.broadcastToRoomMembers(room, 'message:deleted', payloadForEvent);
            if (result.data.pinnedCleared) {
              this.broadcastToRoomMembers(room, 'room:pin:updated', {
                roomId: result.data.roomId,
                dialogId: result.data.dialogId,
                pinnedNodeId: null,
                pinnedMessage: null,
              });
            }
          } else {
            this.broadcast(result.data.roomId, 'message:deleted', payloadForEvent);
            if (result.data.pinnedCleared) {
              this.broadcast(result.data.roomId, 'room:pin:updated', {
                roomId: result.data.roomId,
                dialogId: result.data.dialogId,
                pinnedNodeId: null,
                pinnedMessage: null,
              });
            }
          }
        }
        return result;
      }

      if (com === 'message:list') {
        const payload = args as MessageListPayload;
        return this.normalizeResult(await this.chatService.messageList(
          client.state,
          payload.roomId,
          payload.limit,
          payload.beforeMessageId,
        ));
      }

      if (com === 'message:reaction:set') {
        const payload = args as ReactionSetPayload;
        const result = this.normalizeResult<ReactionSetData>(
          await this.chatService.messageReactionSet(client.state, payload.messageId, payload.emoji ?? null),
        );
        if (result.ok && result.data.changed) {
          const room = await getRoomById(result.data.roomId);
          const payloadForEvent = {
            roomId: result.data.roomId,
            dialogId: result.data.dialogId,
            messageId: result.data.messageId,
            reactions: result.data.reactions,
          };

          if (room) {
            this.broadcastToRoomMembers(room, 'message:reactions:updated', payloadForEvent);
          } else {
            this.broadcast(result.data.roomId, 'message:reactions:updated', payloadForEvent);
          }

          if (result.data.notify) {
            this.sendToUser(result.data.notify.userId, 'message:reaction:notify', result.data.notify);
          }
        }
        return result;
      }

      if (com === 'runtime:action') {
        const payload = args as RuntimeActionPayload;
        return this.normalizeResult<RuntimeActionData>(await this.chatService.runtimeAction(client.state, payload));
      }

      return this.fail(`handler_not_found:${com}`);
    } catch (error) {
      this.logger.error((error as {message?: string})?.message || String(error));
      return this.fail(error);
    }
  }

  private async dispatch(client: ClientSocket, com: string, args: Record<string, any>) {
    const strictResult = await this.dispatchStrictCommand(client, com, args as WsArgs);
    if (strictResult) return strictResult;

    if (com === 'user:list') return this.chatService.usersList(client.state);
    if (com === 'user:get') return this.chatService.userGet(client.state, args as UserGetPayload);
    if (com === 'contacts:list') return this.chatService.contactsList(client.state);
    if (com === 'contacts:add') return this.chatService.contactsAdd(client.state, args as ContactPayload);
    if (com === 'contacts:remove') return this.chatService.contactsRemove(client.state, args as ContactPayload);

    if (com === 'invites:list') return this.chatService.invitesList(client.state);
    if (com === 'invites:create') return this.chatService.invitesCreate(client.state, args);
    if (com === 'invites:check') return this.chatService.invitesCheck(client.state, args);
    if (com === 'invites:redeem') return this.chatService.invitesRedeem(client.state, args);
    if (com === 'invites:available-rooms') return this.chatService.invitesAvailableRooms(client.state);
    if (com === 'invites:delete') return this.chatService.invitesDelete(client.state, args);
    if (com === 'public:vpnInfo') return this.chatService.publicVpnInfo(client.state);
    if (com === 'public:vpnProvision') return this.chatService.publicVpnProvision(client.state);
    if (com === 'public:vpnDonation') {
      const result = await this.chatService.publicVpnDonation(client.state, args);
      if ((result as any)?.ok && (result as any)?.user) {
        this.broadcastToAuthorized('user:updated', (result as any).user);
      }
      return result;
    }

    if (com === 'game:session:create-solo') {
      const result = await this.chatService.gamesSoloCreate(client.state, args);
      if ((result as any)?.ok) {
        const roomId = Number((result as any).roomId || 0);
        if (Number.isFinite(roomId) && roomId > 0) {
          this.subscribe(client, roomId);
          const room = await getRoomById(roomId);
          if (room) {
            const messages = Array.isArray((result as any).messages) ? (result as any).messages : [];
            for (const message of messages) {
              this.broadcast(roomId, 'message:created', message);
            }
            this.broadcast(roomId, 'game:session:updated', (result as any).session);
            const events = Array.isArray((result as any).events) ? (result as any).events : [];
            for (const event of events) {
              this.broadcast(roomId, 'game:event', {
                sessionId: (result as any).sessionId,
                event,
              });
            }
          }
        }
      }
      return result;
    }

    if (com === 'game:session:get') {
      const result = await this.chatService.gamesSessionGet(client.state, args.sessionId);
      if ((result as any)?.ok) {
        const roomId = Number((result as any).roomId || 0);
        if (Number.isFinite(roomId) && roomId > 0) {
          this.subscribe(client, roomId);
        }
      }
      return result;
    }

    if (com === 'game:session:action') {
      const result = await this.chatService.gamesAction(client.state, args);
      if ((result as any)?.ok) {
        const roomId = Number((result as any).roomId || 0);
        const room = Number.isFinite(roomId) && roomId > 0
          ? await getRoomById(roomId)
          : null;

        if (room) {
          const messages = Array.isArray((result as any).messages) ? (result as any).messages : [];
          for (const message of messages) {
            this.broadcast(roomId, 'message:created', message);
          }

          const events = Array.isArray((result as any).events) ? (result as any).events : [];
          for (const event of events) {
            this.broadcast(roomId, 'game:event', {
              sessionId: (result as any).sessionId,
              event,
            });
          }

          this.broadcast(roomId, 'game:state:updated', {
            sessionId: (result as any).sessionId,
            state: (result as any)?.session?.state,
            actions: (result as any)?.session?.actions || [],
            status: (result as any)?.session?.status || null,
          });
        }
      }
      return result;
    }

    if (com === 'room:group:get-default') return this.chatService.roomGetDefaultGroup(client.state);
    if (com === 'room:direct:get-or-create') return this.chatService.roomDirectGetOrCreate(client.state, args.userId);
    if (com === 'room:join') return this.chatService.roomJoin(client.state, (args as RoomJoinPayload).roomId);
    if (com === 'room:leave') {
      const result = await this.chatService.roomLeave(client.state, (args as RoomLeavePayload).roomId);
      if ((result as any)?.ok && (result as any)?.left) {
        const roomId = Number((result as any).roomId || 0);
        if (Number.isFinite(roomId) && roomId > 0) {
          this.removeUserFromRoomSubscriptions(roomId, client.state?.user?.id);
          this.sendToUser(Number(client.state?.user?.id || 0), 'room:deleted', {
            roomId: (result as any).roomId,
            dialogId: (result as any).dialogId,
            kind: (result as any).kind,
          });
        }
      }
      return result;
    }
    if (com === 'room:members:list') {
      const result = await this.chatService.roomMembersList(client.state, (args as RoomMembersListPayload).roomId);
      if (Array.isArray(result)) {
        const onlineUserIds = new Set(this.getOnlineUserIds());
        return result.map((user) => ({
          ...user,
          isOnline: onlineUserIds.has(Number((user as any)?.id || 0)),
        }));
      }
      return result;
    }
    if (com === 'room:members:add') return this.chatService.roomMembersAdd(client.state, args as RoomMembersAddPayload);
    if (com === 'room:members:remove') {
      const payload = args as RoomMembersRemovePayload;
      const result = await this.chatService.roomMembersRemove(client.state, payload);
      if ((result as any)?.ok) {
        const removedUserIds = Array.isArray((result as any).removedUserIds)
          ? (result as any).removedUserIds
          : [];
        const roomId = Number(payload?.roomId || 0);
        const roomBefore = Number.isFinite(roomId) && roomId > 0
          ? await getRoomById(roomId)
          : null;
        const kind = roomBefore?.kind === 'game' ? 'game' : 'group';
        for (const removedUserIdRaw of removedUserIds) {
          const removedUserId = Number(removedUserIdRaw || 0);
          if (!Number.isFinite(removedUserId) || removedUserId <= 0) continue;
          this.removeUserFromRoomSubscriptions(roomId, removedUserId);
          this.sendToUser(removedUserId, 'room:deleted', {
            roomId,
            dialogId: roomId,
            kind,
          });
        }
      }
      return result;
    }
    if (com === 'room:settings:update') {
      const result = await this.chatService.roomSettingsUpdate(client.state, args as RoomSettingsUpdatePayload);
      if ((result as any)?.ok) {
        const room = await getRoomById((result as any).roomId);
        const roomPayload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).dialogId,
          kind: (result as any).kind,
          title: (result as any).title,
          visibility: (result as any).visibility,
          commentsEnabled: !!(result as any).commentsEnabled,
          avatarUrl: (result as any).avatarUrl || null,
          postOnlyByAdmin: !!(result as any).postOnlyByAdmin,
          createdById: (result as any).createdById || null,
          pinnedNodeId: (result as any).pinnedNodeId || null,
          roomSurface: (result as any).roomSurface || null,
          discussion: (result as any).discussion || null,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'room:updated', roomPayload);
        } else {
          this.broadcast((result as any).roomId, 'room:updated', roomPayload);
        }
      }
      return result;
    }

    if (com === 'room:surface:set') return this.chatService.roomSurfaceSet(client.state, args.roomId, args);

    if (com === 'message:comment-room:get') {
      return this.chatService.messageCommentRoomGet(client.state, args.messageId);
    }

    if (com === 'message:comment-room:create') {
      const result = await this.chatService.messageCommentRoomCreate(client.state, args.messageId);
      if ((result as any)?.ok && (result as any)?.message) {
        const sourceRoomId = Number((result as any).sourceRoomId || 0);
        const room = Number.isFinite(sourceRoomId) && sourceRoomId > 0
          ? await getRoomById(sourceRoomId)
          : null;
        if (room) {
          this.broadcastToRoomMembers(room, 'message:updated', (result as any).message);
        } else if (Number.isFinite(sourceRoomId) && sourceRoomId > 0) {
          this.broadcast(sourceRoomId, 'message:updated', (result as any).message);
        }
      }
      return result;
    }

    if (com === 'room:runtime:get') {
      return this.chatService.roomRuntimeGet(client.state, args.roomId);
    }

    if (com === 'room:pin:set') {
      const result = await this.chatService.roomPinSet(client.state, args.roomId, args.nodeId);
      if ((result as any)?.ok && (result as any)?.changed) {
        const room = await getRoomById((result as any).roomId);
        const payload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          pinnedNodeId: (result as any).pinnedNodeId || null,
          pinnedMessage: (result as any).pinnedMessage || null,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'room:pin:updated', payload);
        } else {
          this.broadcast((result as any).roomId, 'room:pin:updated', payload);
        }
      }
      return result;
    }

    if (com === 'room:pin:clear') {
      const result = await this.chatService.roomPinClear(client.state, args.roomId);
      if ((result as any)?.ok && (result as any)?.changed) {
        const room = await getRoomById((result as any).roomId);
        const payload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          pinnedNodeId: null,
          pinnedMessage: null,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'room:pin:updated', payload);
        } else {
          this.broadcast((result as any).roomId, 'room:pin:updated', payload);
        }
      }
      return result;
    }

    return {ok: false, error: `handler_not_found:${com}`};
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
        const errorPayload = this.isStrictWsCommand(com)
          ? this.fail(err)
          : {ok: false, error: 'server_error'};
        this.sendResult(client, senderId, requestId, errorPayload);
      }
    }
  }
}
