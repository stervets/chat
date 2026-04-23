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
import {getRoomById, userCanAccessRoom, type RoomRow} from '../common/rooms.js';
import {WebPushService} from '../common/web-push.js';
import {ChatService} from './chat.service.js';
import {scriptableEvents} from '../scriptable/events.js';
import {
  SYSTEM_NICKNAME,
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
  ) {
    scriptableEvents.on('runtime:data:updated', (payload) => {
      void this.handleScriptStateEvent(payload);
    });

    scriptableEvents.on('runtime:message:created', (message) => {
      void this.handleScriptSystemMessage(message);
    });
  }

  private async handleScriptStateEvent(payload: {
    roomId: number;
    nodeType: 'message' | 'room';
    nodeId: number;
    clientScript: string | null;
    serverScript: string | null;
    data: any;
  }) {
    const room = await getRoomById(payload.roomId);
    if (room) {
      this.broadcastToRoomMembers(room, 'runtime:data:updated', payload);
      return;
    }
    this.broadcast(payload.roomId, 'runtime:data:updated', payload);
  }

  private async handleScriptSystemMessage(message: any) {
    const roomId = Number(message?.roomId || 0);
    if (!Number.isFinite(roomId) || roomId <= 0) return;

    const room = await getRoomById(roomId);
    if (room) {
      this.broadcastToRoomMembers(room, 'message:created', message);
    } else {
      this.broadcast(roomId, 'message:created', message);
    }

    await this.chatService.scriptableNotifyRoomEvent({
      roomId,
      eventType: 'message_created',
      eventPayload: {
        id: Number(message?.id || 0),
        kind: String(message?.kind || 'text'),
        authorId: Number(message?.authorId || 0),
        authorNickname: String(message?.authorNickname || ''),
      },
    });
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

  private parsePacket(raw: string): Packet | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 4) return null;

      const com = typeof parsed[0] === 'string' ? parsed[0] : '';
      if (!com) return null;
      const args = parsed[1] && typeof parsed[1] === 'object' && !Array.isArray(parsed[1]) ? parsed[1] : {};
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

  private sendResult(client: ClientSocket, recipientId: string, requestId: string, value: any) {
    this.sendPacket(client, [
      RESULT_COMMAND,
      [value],
      BACKEND_PEER_ID,
      recipientId || FRONTEND_PEER_ID,
      requestId,
    ]);
  }

  private sendEvent(client: ClientSocket, com: string, payload: Record<string, any> | any = {}) {
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

  private broadcast(roomId: number, com: string, payload: Record<string, any> | any = {}) {
    const set = this.subscriptions.get(roomId);
    if (!set) return;
    for (const client of set) {
      this.sendEvent(client, com, payload);
    }
  }

  private broadcastToRoomMembers(room: RoomRow, com: string, payload: Record<string, any> | any = {}) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (!userCanAccessRoom(client.state.user.id, room)) continue;
      this.sendEvent(client, com, payload);
    }
  }

  private sendToUser(userId: number, com: string, payload: Record<string, any> | any = {}) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (client.state.user.id !== userId) continue;
      this.sendEvent(client, com, payload);
    }
  }

  private broadcastToAuthorized(com: string, payload: Record<string, any> | any = {}) {
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

  private async dispatch(client: ClientSocket, com: string, args: Record<string, any>) {
    if (com === 'auth:login') return this.chatService.authLogin(client.state, args);
    if (com === 'auth:session') return this.chatService.authSession(client.state, args.token);
    if (com === 'auth:me') return this.chatService.authMe(client.state);
    if (com === 'auth:logout') {
      const result = await this.chatService.authLogout(client.state);
      this.unsubscribe(client);
      return result;
    }
    if (com === 'auth:updateProfile') return this.chatService.authUpdateProfile(client.state, args);
    if (com === 'auth:changePassword') return this.chatService.authChangePassword(client.state, args);

    if (com === 'user:list') return this.chatService.usersList(client.state);

    if (com === 'invites:list') return this.chatService.invitesList(client.state);
    if (com === 'invites:create') return this.chatService.invitesCreate(client.state);
    if (com === 'invites:check') return this.chatService.invitesCheck(client.state, args);
    if (com === 'invites:redeem') return this.chatService.invitesRedeem(client.state, args);
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
              await this.chatService.scriptableNotifyRoomEvent({
                roomId,
                eventType: 'message_created',
                eventPayload: {
                  id: Number(message?.id || 0),
                  kind: String(message?.kind || 'text'),
                  authorId: Number(message?.authorId || 0),
                  authorNickname: String(message?.authorNickname || ''),
                },
              });
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
            await this.chatService.scriptableNotifyRoomEvent({
              roomId,
              eventType: 'message_created',
              eventPayload: {
                id: Number(message?.id || 0),
                kind: String(message?.kind || 'text'),
                authorId: Number(message?.authorId || 0),
                authorNickname: String(message?.authorNickname || ''),
              },
            });
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

    if (com === 'room:group:get-default') return this.chatService.dialogsGeneral(client.state);
    if (com === 'room:direct:get-or-create') return this.chatService.dialogsPrivate(client.state, args.userId);
    if (com === 'room:list') {
      const kind = String(args.kind || '').trim().toLowerCase();
      if (kind === 'direct') return this.chatService.dialogsDirects(client.state);
      if (kind === 'group') {
        const result = await this.chatService.dialogsGeneral(client.state);
        if ((result as any)?.ok === false) return result;
        return [result];
      }
      return {ok: false, error: 'invalid_room_kind'};
    }
    if (com === 'message:list') return this.chatService.dialogsMessages(client.state, args.roomId, args.limit, args.beforeMessageId);
    if (com === 'room:delete') {
      const roomId = Number.parseInt(String(args.roomId ?? ''), 10);
      const roomBeforeDelete = Number.isFinite(roomId) && roomId > 0
        ? await getRoomById(roomId)
        : null;
      const result = await this.chatService.dialogsDelete(client.state, args.roomId, args);
      if ((result as any)?.ok && (result as any)?.changed) {
        if (roomBeforeDelete) {
          this.broadcastToRoomMembers(roomBeforeDelete, 'room:deleted', {
            roomId: (result as any).roomId,
            dialogId: (result as any).roomId,
            kind: (result as any).kind,
          });
        }
        this.closeRoomSubscriptions((result as any).roomId);
      }
      return result;
    }

    if (com === 'room:get') {
      const result = await this.chatService.chatJoin(client.state, args.roomId);
      if ((result as any)?.ok) {
        this.subscribe(client, (result as any).roomId);
      }
      return result;
    }

    if (com === 'room:create') {
      return this.chatService.roomsCreate(client.state, args);
    }

    if (com === 'room:surface:set') {
      const result = await this.chatService.roomsSurfaceConfigure(client.state, args.roomId, args);
      if ((result as any)?.ok) {
        const room = await getRoomById((result as any).roomId);
        const roomPayload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          kind: (result as any).kind,
          createdById: (result as any).createdById || null,
          roomSurface: (result as any).roomSurface || null,
          roomRuntime: (result as any).roomRuntime || null,
          pinnedNodeId: (result as any).pinnedNodeId || null,
        };
        const pinPayload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          pinnedNodeId: (result as any).pinnedNodeId || null,
          pinnedMessage: (result as any).pinnedMessage || null,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'room:updated', roomPayload);
          this.broadcastToRoomMembers(room, 'room:pin:updated', pinPayload);
        } else {
          this.broadcast((result as any).roomId, 'room:updated', roomPayload);
          this.broadcast((result as any).roomId, 'room:pin:updated', pinPayload);
        }
      }
      return result;
    }

    if (com === 'message:comment-room:get') {
      return this.chatService.messagesDiscussionGet(client.state, args.messageId);
    }

    if (com === 'message:comment-room:create') {
      const result = await this.chatService.messagesDiscussionCreate(client.state, args.messageId);
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

    if (com === 'message:create') {
      const kind = String(args.kind || 'text').trim().toLowerCase();
      const result = kind === 'scriptable'
        ? await this.chatService.scriptsCreateMessage(client.state, args.roomId, args)
        : await this.chatService.chatSend(client.state, args.roomId, args.text ?? args.body, args);
      if ((result as any)?.ok && (result as any)?.message) {
        const room = await getRoomById((result as any).message.roomId);
        const silentRequested = Boolean(args.silent);
        const skipPush = silentRequested && client.state?.user?.nickname === SYSTEM_NICKNAME;
        if (room) {
          this.broadcastToRoomMembers(room, 'message:created', (result as any).message);
          if (!skipPush) {
            void this.webPushService.sendChatMessagePush({
              room,
              message: (result as any).message,
              senderId: Number(client.state?.user?.id || 0),
              excludeUserIds: this.getOnlineUserIds(),
            });
          }
        } else {
          this.broadcast((result as any).message.roomId, 'message:created', (result as any).message);
        }

        await this.chatService.scriptableNotifyRoomEvent({
          roomId: Number((result as any).message.roomId || 0),
          eventType: 'message_created',
          eventPayload: {
            id: Number((result as any).message.id || 0),
            kind: String((result as any).message.kind || 'text'),
            authorId: Number((result as any).message.authorId || 0),
            authorNickname: String((result as any).message.authorNickname || ''),
          },
        });
      }
      return result;
    }

    if (com === 'runtime:action') {
      const result = await this.chatService.scriptsAction(client.state, args);
      if ((result as any)?.ok) {
        await this.chatService.scriptableNotifyRoomEvent({
          roomId: Number((result as any).roomId || 0),
          eventType: 'script_action',
          eventPayload: {
            nodeType: String((result as any).nodeType || ''),
            nodeId: Number((result as any).nodeId || 0),
            actionType: String(args.actionType || ''),
            actorId: Number(client.state?.user?.id || 0),
            actorNickname: String(client.state?.user?.nickname || ''),
          },
        });
      }
      return result;
    }

    if (com === 'room:runtime:get') {
      return this.chatService.scriptsRoomGet(client.state, args.roomId);
    }

    if (com === 'message:update') {
      const result = await this.chatService.chatEdit(client.state, args.messageId, args.text ?? args.body);
      if ((result as any)?.ok && (result as any)?.changed && (result as any)?.message) {
        const room = await getRoomById((result as any).message.roomId);
        if (room) {
          this.broadcastToRoomMembers(room, 'message:updated', (result as any).message);
        } else {
          this.broadcast((result as any).message.roomId, 'message:updated', (result as any).message);
        }
      }
      return result;
    }

    if (com === 'message:delete') {
      const result = await this.chatService.chatDelete(client.state, args.messageId);
      if ((result as any)?.ok && (result as any)?.changed) {
        const room = await getRoomById((result as any).roomId);
        const payload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          messageId: (result as any).messageId,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'message:deleted', payload);
          if ((result as any).pinnedCleared) {
            this.broadcastToRoomMembers(room, 'room:pin:updated', {
              roomId: (result as any).roomId,
              dialogId: (result as any).roomId,
              pinnedNodeId: null,
              pinnedMessage: null,
            });
          }
        } else {
          this.broadcast((result as any).roomId, 'message:deleted', payload);
          if ((result as any).pinnedCleared) {
            this.broadcast((result as any).roomId, 'room:pin:updated', {
              roomId: (result as any).roomId,
              dialogId: (result as any).roomId,
              pinnedNodeId: null,
              pinnedMessage: null,
            });
          }
        }
      }
      return result;
    }

    if (com === 'room:pin:set') {
      const result = await this.chatService.chatPin(client.state, args.roomId, args.nodeId);
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
      const result = await this.chatService.chatUnpin(client.state, args.roomId);
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

    if (com === 'message:reaction:set') {
      const result = await this.chatService.chatReact(client.state, args.messageId, args.emoji ?? null);
      if ((result as any)?.ok && (result as any)?.changed) {
        const room = await getRoomById((result as any).roomId);
        const payload = {
          roomId: (result as any).roomId,
          dialogId: (result as any).roomId,
          messageId: (result as any).messageId,
          reactions: (result as any).reactions,
        };

        if (room) {
          this.broadcastToRoomMembers(room, 'message:reactions:updated', payload);
        } else {
          this.broadcast((result as any).roomId, 'message:reactions:updated', payload);
        }

        if ((result as any).notify) {
          this.sendToUser((result as any).notify.userId, 'message:reaction:notify', (result as any).notify);
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
        this.sendResult(client, senderId, requestId, {ok: false, error: 'server_error'});
      }
    }
  }
}
