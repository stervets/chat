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
import {getDialogById, userCanAccessDialog, type DialogRow} from '../common/dialogs.js';
import {WebPushService} from '../common/web-push.js';
import {ChatService} from './chat.service.js';
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
      dialogId: null,
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
      const args = Array.isArray(parsed[1]) ? parsed[1] : [];
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

  private sendEvent(client: ClientSocket, com: string, ...args: any[]) {
    this.sendPacket(client, [
      com,
      args,
      BACKEND_PEER_ID,
      client.state?.id || FRONTEND_PEER_ID,
    ]);
  }

  private subscribe(client: ClientSocket, dialogId: number) {
    this.unsubscribe(client);

    let set = this.subscriptions.get(dialogId);
    if (!set) {
      set = new Set();
      this.subscriptions.set(dialogId, set);
    }
    set.add(client);
  }

  private unsubscribe(client: ClientSocket) {
    const dialogId = client.state?.dialogId;
    if (!dialogId) return;
    const set = this.subscriptions.get(dialogId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      this.subscriptions.delete(dialogId);
    }
  }

  private broadcast(dialogId: number, com: string, ...args: any[]) {
    const set = this.subscriptions.get(dialogId);
    if (!set) return;
    for (const client of set) {
      this.sendEvent(client, com, ...args);
    }
  }

  private broadcastToDialogMembers(dialog: DialogRow, com: string, ...args: any[]) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (!userCanAccessDialog(client.state.user.id, dialog)) continue;
      this.sendEvent(client, com, ...args);
    }
  }

  private sendToUser(userId: number, com: string, ...args: any[]) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      if (client.state.user.id !== userId) continue;
      this.sendEvent(client, com, ...args);
    }
  }

  private broadcastToAuthorized(com: string, ...args: any[]) {
    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (!client.state?.user) continue;
      this.sendEvent(client, com, ...args);
    }
  }

  private closeDialogSubscriptions(dialogId: number) {
    const set = this.subscriptions.get(dialogId);
    if (set) {
      for (const client of set) {
        if (client.state?.dialogId === dialogId) {
          client.state.dialogId = null;
        }
      }
      this.subscriptions.delete(dialogId);
    }

    for (const rawClient of this.server.clients) {
      const client = rawClient as ClientSocket;
      if (client.state?.dialogId === dialogId) {
        client.state.dialogId = null;
      }
    }
  }

  private async dispatch(client: ClientSocket, com: string, args: any[]) {
    if (com === 'auth:login') return this.chatService.authLogin(client.state, args[0]);
    if (com === 'auth:session') return this.chatService.authSession(client.state, args[0]);
    if (com === 'auth:me') return this.chatService.authMe(client.state);
    if (com === 'auth:logout') {
      const result = await this.chatService.authLogout(client.state);
      this.unsubscribe(client);
      return result;
    }
    if (com === 'auth:updateProfile') return this.chatService.authUpdateProfile(client.state, args[0]);
    if (com === 'auth:changePassword') return this.chatService.authChangePassword(client.state, args[0]);

    if (com === 'users:list') return this.chatService.usersList(client.state);

    if (com === 'invites:list') return this.chatService.invitesList(client.state);
    if (com === 'invites:create') return this.chatService.invitesCreate(client.state);
    if (com === 'invites:check') return this.chatService.invitesCheck(client.state, args[0]);
    if (com === 'invites:redeem') return this.chatService.invitesRedeem(client.state, args[0]);
    if (com === 'public:vpnInfo') return this.chatService.publicVpnInfo(client.state);
    if (com === 'public:vpnProvision') return this.chatService.publicVpnProvision(client.state);
    if (com === 'public:vpnDonation') {
      const result = await this.chatService.publicVpnDonation(client.state, args[0]);
      if ((result as any)?.ok && (result as any)?.user) {
        this.broadcastToAuthorized('users:updated', (result as any).user);
      }
      return result;
    }

    if (com === 'dialogs:general') return this.chatService.dialogsGeneral(client.state);
    if (com === 'dialogs:private') return this.chatService.dialogsPrivate(client.state, args[0]);
    if (com === 'dialogs:directs') return this.chatService.dialogsDirects(client.state);
    if (com === 'dialogs:messages') return this.chatService.dialogsMessages(client.state, args[0], args[1], args[2]);
    if (com === 'dialogs:delete') {
      const dialogBeforeDelete = await getDialogById(Number.parseInt(String(args[0] ?? ''), 10));
      const result = await this.chatService.dialogsDelete(client.state, args[0]);
      if ((result as any)?.ok && (result as any)?.changed) {
        if (dialogBeforeDelete) {
          this.broadcastToDialogMembers(dialogBeforeDelete, 'dialogs:deleted', {
            dialogId: (result as any).dialogId,
            kind: (result as any).kind,
          });
        }
        this.closeDialogSubscriptions((result as any).dialogId);
      }
      return result;
    }

    if (com === 'chat:join') {
      const result = await this.chatService.chatJoin(client.state, args[0]);
      if ((result as any)?.ok) {
        this.subscribe(client, (result as any).dialogId);
      }
      return result;
    }

    if (com === 'chat:send') {
      const result = await this.chatService.chatSend(client.state, args[0], args[1]);
      if ((result as any)?.ok && (result as any)?.message) {
        const dialog = await getDialogById((result as any).message.dialogId);
        if (dialog) {
          this.broadcastToDialogMembers(dialog, 'chat:message', (result as any).message);
          void this.webPushService.sendChatMessagePush({
            dialog,
            message: (result as any).message,
            senderId: Number((result as any).message.authorId || 0),
          });
        } else {
          this.broadcast((result as any).message.dialogId, 'chat:message', (result as any).message);
        }
      }
      return result;
    }

    if (com === 'chat:edit') {
      const result = await this.chatService.chatEdit(client.state, args[0], args[1]);
      if ((result as any)?.ok && (result as any)?.changed && (result as any)?.message) {
        const dialog = await getDialogById((result as any).message.dialogId);
        if (dialog) {
          this.broadcastToDialogMembers(dialog, 'chat:message-updated', (result as any).message);
        } else {
          this.broadcast((result as any).message.dialogId, 'chat:message-updated', (result as any).message);
        }
      }
      return result;
    }

    if (com === 'chat:delete') {
      const result = await this.chatService.chatDelete(client.state, args[0]);
      if ((result as any)?.ok && (result as any)?.changed) {
        const dialog = await getDialogById((result as any).dialogId);
        const payload = {
          dialogId: (result as any).dialogId,
          messageId: (result as any).messageId,
        };

        if (dialog) {
          this.broadcastToDialogMembers(dialog, 'chat:message-deleted', payload);
        } else {
          this.broadcast((result as any).dialogId, 'chat:message-deleted', payload);
        }
      }
      return result;
    }

    if (com === 'chat:react') {
      const result = await this.chatService.chatReact(client.state, args[0], args[1]);
      if ((result as any)?.ok && (result as any)?.changed) {
        const dialog = await getDialogById((result as any).dialogId);
        const payload = {
          dialogId: (result as any).dialogId,
          messageId: (result as any).messageId,
          reactions: (result as any).reactions,
        };

        if (dialog) {
          this.broadcastToDialogMembers(dialog, 'chat:reactions', payload);
        } else {
          this.broadcast((result as any).dialogId, 'chat:reactions', payload);
        }

        if ((result as any).notify) {
          this.sendToUser((result as any).notify.userId, 'chat:reaction-notify', (result as any).notify);
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
