import type {WebSocket} from 'ws';
import {config} from '../config.js';
import type {RoomRow} from '../common/rooms.js';
import {getRoomById} from '../common/rooms.js';
import type {WebPushService} from '../common/web-push.js';
import type {SocketState} from './protocol.js';
import {boolValue, positiveInt, positiveIntList, stringChoice, textValue} from './chat.input.js';
import type {ChatDomain} from './chat.domain.js';
import type {ChatCallsService, CallPublicPayload} from './chat-calls.service.js';
import {
  SYSTEM_NICKNAME,
  type ChatContextMessagePayload,
} from './chat/chat-context.js';

export type ClientSocket = WebSocket & {
  state: SocketState;
};

export type WsArgs = Record<string, unknown>;
export type WsErrorObject = {message: string; code?: string | number};
export type WsError = string | WsErrorObject;
export type WsSuccess<T> = {ok: true; data: T};
export type WsFailure = {ok: false; error: WsError};
export type WsResponse<T> = WsSuccess<T> | WsFailure;

export type ChatCommandContext = {
  client: ClientSocket;
  args: WsArgs;
  vars: Record<string, unknown>;
};

export type ChatCommand = {
  run(ctx: ChatCommandContext): Promise<unknown> | unknown;
  after?(ctx: ChatCommandContext, result: unknown): Promise<void> | void;
};

export type ChatCommandMap = Record<string, ChatCommand>;

export type ChatCommandHost = {
  chat: ChatDomain;
  webPushService: WebPushService | null;
  calls: ChatCallsService;
  notifyCallEnded(call: CallPublicPayload): void;
  flushExpiredCalls(): void;
  fail(errorRaw: unknown): WsFailure;
  subscribe(client: ClientSocket, roomId: number): void;
  unsubscribe(client: ClientSocket): void;
  broadcast(roomId: number, com: string, payload?: Record<string, unknown> | unknown): void;
  broadcastToRoomMembers(room: RoomRow, com: string, payload?: Record<string, unknown> | unknown): void;
  sendToUser(userId: number, com: string, payload?: Record<string, unknown> | unknown): void;
  broadcastToAuthorized(com: string, payload?: Record<string, unknown> | unknown): void;
  getOnlineUserIds(): number[];
  closeRoomSubscriptions(roomId: number): void;
  removeUserFromRoomSubscriptions(roomId: number, userIdRaw: unknown): void;
};

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

type CallStartPayload = {roomId?: number};
type CallIdPayload = {callId?: string};
type CallHangupPayload = {callId?: string; reason?: string};
type CallSignalWsPayload = {callId?: string; type?: string; payload?: unknown; toUserId?: number};

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
function command(run: ChatCommand['run'], after?: ChatCommand['after']): ChatCommand {
  return {run, after};
}

function okResult<T>(result: unknown): result is WsSuccess<T> {
  return !!result && typeof result === 'object' && (result as WsResponse<T>).ok === true;
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function getRoomListHandler(host: ChatCommandHost, kindRaw: unknown) {
  const kind = String(kindRaw || '').trim().toLowerCase();
  const handlers: Record<string, (ctx: ChatCommandContext) => Promise<unknown> | unknown> = {
    direct: ({client}) => host.chat.rooms.roomListDirect(client.state),
    group: ({client, args}) => host.chat.rooms.roomListJoined(client.state, (args as RoomListPayload).scope),
  };

  return handlers[kind] || null;
}

function roomUpdatedPayload(result: Record<string, unknown>) {
  return {
    roomId: result.roomId,
    dialogId: result.dialogId,
    kind: result.kind,
    title: result.title,
    visibility: result.visibility,
    commentsEnabled: !!result.commentsEnabled,
    avatarUrl: result.avatarUrl || null,
    postOnlyByAdmin: !!result.postOnlyByAdmin,
    createdById: result.createdById || null,
    pinnedNodeId: result.pinnedNodeId || null,
    roomSurface: result.roomSurface || null,
    discussion: result.discussion || null,
  };
}

function pinUpdatedPayload(result: Record<string, unknown>, pinnedCleared = false) {
  return {
    roomId: result.roomId,
    dialogId: result.dialogId || result.roomId,
    pinnedNodeId: pinnedCleared ? null : result.pinnedNodeId || null,
    pinnedMessage: pinnedCleared ? null : result.pinnedMessage || null,
  };
}

function normalizeUserGetArgs(args: WsArgs): UserGetPayload {
  return {
    userId: positiveInt(args.userId),
    nickname: textValue(args.nickname),
  };
}

function normalizeContactArgs(args: WsArgs): ContactPayload {
  return {
    userId: positiveInt(args.userId),
  };
}

function normalizeRoomCreateArgs(args: WsArgs): RoomCreatePayload {
  return {
    title: textValue(args.title),
    visibility: stringChoice(args.visibility, ['public', 'private'] as const, 'private'),
    commentsEnabled: boolValue(args.commentsEnabled, true),
    avatarPath: args.avatarPath === undefined ? undefined : textValue(args.avatarPath),
    postOnlyByAdmin: boolValue(args.postOnlyByAdmin, false),
  };
}

function normalizeRoomSettingsArgs(args: WsArgs): RoomSettingsUpdatePayload {
  return {
    roomId: positiveInt(args.roomId),
    title: args.title === undefined ? undefined : textValue(args.title),
    visibility: args.visibility === undefined ? undefined : stringChoice(args.visibility, ['public', 'private'] as const, 'private'),
    commentsEnabled: args.commentsEnabled === undefined ? undefined : boolValue(args.commentsEnabled),
    avatarPath: args.avatarPath === undefined ? undefined : textValue(args.avatarPath),
    postOnlyByAdmin: args.postOnlyByAdmin === undefined ? undefined : boolValue(args.postOnlyByAdmin),
  };
}

function normalizeMessageCreateArgs(args: WsArgs): MessageCreatePayload {
  return {
    ...args,
    roomId: positiveInt(args.roomId),
    text: args.text === undefined ? textValue(args.body) : textValue(args.text),
    body: args.body === undefined ? undefined : textValue(args.body),
    kind: textValue(args.kind, 'text'),
    silent: boolValue(args.silent),
  };
}

function normalizeRuntimeActionArgs(args: WsArgs): RuntimeActionPayload {
  return {
    ...args,
    nodeType: textValue(args.nodeType),
    nodeId: positiveInt(args.nodeId),
    actionType: textValue(args.actionType),
    payload: args.payload,
  };
}

function createAuthCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    'auth:login': command(({client, args}) => {
      return host.chat.auth.authLogin(client.state, args as AuthLoginPayload);
    }),

    'auth:session': command(({client, args}) => {
      return host.chat.auth.authSession(client.state, (args as AuthSessionPayload).token);
    }),

    'auth:me': command(({client}) => {
      return host.chat.auth.authMe(client.state);
    }),

    'auth:logout': command(({client}) => {
      return host.chat.auth.authLogout(client.state);
    }, ({client}, result) => {
      if (okResult(result)) {
        host.unsubscribe(client);
      }
    }),

    'auth:updateProfile': command(({client, args}) => {
      return host.chat.auth.authUpdateProfile(client.state, args as AuthUpdateProfilePayload);
    }, (_ctx, result) => {
      if (okResult<Record<string, unknown>>(result) && (result.data as any)?.user) {
        host.broadcastToAuthorized('user:updated', (result.data as any).user);
      }
    }),

    'auth:changePassword': command(({client, args}) => {
      return host.chat.auth.authChangePassword(client.state, args as AuthChangePasswordPayload);
    }),
  };
}

function createUserCommands(host: ChatCommandHost): ChatCommandMap {
  const withOnlineUser = (userRaw: unknown, onlineUserIds: Set<number>) => {
    if (!userRaw || typeof userRaw !== 'object') return userRaw;
    const user = userRaw as Record<string, unknown>;
    const userId = positiveNumber(user.id);
    return {
      ...user,
      isOnline: onlineUserIds.has(userId),
    };
  };
  const isFailure = (resultRaw: unknown) => {
    return !!resultRaw && typeof resultRaw === 'object' && (resultRaw as any).ok === false;
  };

  return {
    'user:list': command(async ({client}) => {
      const result = await host.chat.users.usersList(client.state);
      if (!Array.isArray(result)) return result;
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return result.map((user) => withOnlineUser(user, onlineUserIds));
    }),
    'user:get': command(async ({client, args}) => {
      const result = await host.chat.users.userGet(client.state, normalizeUserGetArgs(args));
      if (isFailure(result)) return result;
      const payload = result && typeof result === 'object'
        ? {...(result as Record<string, unknown>)}
        : {};
      if ((payload as any).ok === true) {
        delete (payload as any).ok;
      }
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return {
        ...payload,
        user: withOnlineUser((payload as any).user, onlineUserIds),
      };
    }),
    'contacts:list': command(async ({client}) => {
      const result = await host.chat.users.contactsList(client.state);
      if (!Array.isArray(result)) return result;
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return result.map((user) => withOnlineUser(user, onlineUserIds));
    }),
    'contacts:add': command(({client, args}) => host.chat.users.contactsAdd(client.state, normalizeContactArgs(args))),
    'contacts:remove': command(({client, args}) => host.chat.users.contactsRemove(client.state, normalizeContactArgs(args))),
  };
}

function createInviteCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    'invites:list': command(({client}) => host.chat.invites.invitesList(client.state)),
    'invites:create': command(({client, args}) => host.chat.invites.invitesCreate(client.state, args)),
    'invites:check': command(({client, args}) => host.chat.invites.invitesCheck(client.state, args)),
    'invites:redeem': command(({client, args}) => host.chat.invites.invitesRedeem(client.state, args)),
    'invites:available-rooms': command(({client}) => host.chat.invites.invitesAvailableRooms(client.state)),
    'invites:delete': command(({client, args}) => host.chat.invites.invitesDelete(client.state, args)),
  };
}

function createPublicCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    'public:vpnInfo': command(({client}) => host.chat.invites.publicVpnInfo(client.state)),
    'public:vpnProvision': command(({client}) => host.chat.invites.publicVpnProvision(client.state)),
    'public:vpnDonation': command(({client, args}) => {
      return host.chat.invites.publicVpnDonation(client.state, args);
    }, (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;
      if (result.data.user) {
        host.broadcastToAuthorized('user:updated', result.data.user);
      }
    }),
  };
}

function createGameCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    'game:session:create-solo': command(({client, args}) => {
      return host.chat.games.gamesSoloCreate(client.state, args);
    }, async ({client}, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;
      const data = result.data;

      const roomId = positiveNumber(data.roomId);
      if (!roomId) return;

      host.subscribe(client, roomId);
      const room = await getRoomById(roomId);
      if (!room) return;

      const messages = Array.isArray(data.messages) ? data.messages : [];
      for (const message of messages) {
        host.broadcast(roomId, 'message:created', message);
      }

      host.broadcast(roomId, 'game:session:updated', data.session);

      const events = Array.isArray(data.events) ? data.events : [];
      for (const event of events) {
        host.broadcast(roomId, 'game:event', {
          sessionId: data.sessionId,
          event,
        });
      }
    }),

    'game:session:get': command(({client, args}) => {
      return host.chat.games.gamesSessionGet(client.state, positiveInt(args.sessionId));
    }, ({client}, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;
      const roomId = positiveNumber(result.data.roomId);
      if (roomId) {
        host.subscribe(client, roomId);
      }
    }),

    'game:session:action': command(({client, args}) => {
      return host.chat.games.gamesAction(client.state, args);
    }, async (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;
      const data = result.data;

      const roomId = positiveNumber(data.roomId);
      const room = roomId ? await getRoomById(roomId) : null;
      if (!room) return;

      const messages = Array.isArray(data.messages) ? data.messages : [];
      for (const message of messages) {
        host.broadcast(roomId, 'message:created', message);
      }

      const events = Array.isArray(data.events) ? data.events : [];
      for (const event of events) {
        host.broadcast(roomId, 'game:event', {
          sessionId: data.sessionId,
          event,
        });
      }

      host.broadcast(roomId, 'game:state:updated', {
        sessionId: data.sessionId,
        state: (data as any)?.session?.state,
        actions: (data as any)?.session?.actions || [],
        status: (data as any)?.session?.status || null,
      });
    }),
  };
}


function callIdValue(value: unknown) {
  return String(value || '').trim();
}

function sendCallToParticipants(host: ChatCommandHost, call: CallPublicPayload, com: string) {
  host.sendToUser(call.callerUserId, com, call);
  host.sendToUser(call.calleeUserId, com, call);
}

function createCallCommands(host: ChatCommandHost): ChatCommandMap {
  const sendIncomingCallPush = async (call: CallPublicPayload, room: RoomRow | null) => {
    if (!room || !host.webPushService) return;
    await host.webPushService.sendIncomingCallPush({
      room,
      call,
      caller: call.caller,
    });
  };

  return {
    'call:ice-config': command(({client}) => {
      if (!client.state.user) return host.fail('not_authenticated');
      return {
        ok: true,
        data: {
          iceServers: config.webrtc.iceServers,
          callRingTimeoutMs: config.webrtc.callRingTimeoutMs,
        },
      };
    }),

    'call:start': command(async ({client, args}) => {
      host.flushExpiredCalls();
      const roomId = positiveInt((args as CallStartPayload).roomId);
      const room = roomId ? await getRoomById(roomId) : null;
      const result = host.calls.startDirectCall(room, client.state.user || null);
      if (!okResult<CallPublicPayload>(result)) return result;

      const call = result.data;
      host.sendToUser(call.calleeUserId, 'call:incoming', call);
      await sendIncomingCallPush(call, room);
      return result;
    }),

    'call:get': command(({client, args}) => {
      host.flushExpiredCalls();
      return host.calls.getCallForUser(callIdValue((args as CallIdPayload).callId), client.state.user?.id);
    }),

    'call:accept': command(({client, args}) => {
      host.flushExpiredCalls();
      const result = host.calls.acceptCall(callIdValue((args as CallIdPayload).callId), client.state.user?.id);
      if (okResult<CallPublicPayload>(result)) {
        sendCallToParticipants(host, result.data, 'call:accepted');
      }
      return result;
    }),

    'call:reject': command(({client, args}) => {
      const result = host.calls.rejectCall(callIdValue((args as CallIdPayload).callId), client.state.user?.id);
      if (okResult<CallPublicPayload>(result)) {
        host.notifyCallEnded(result.data);
      }
      return result;
    }),

    'call:hangup': command(({client, args}) => {
      const payload = args as CallHangupPayload;
      const result = host.calls.hangupCall(callIdValue(payload.callId), client.state.user?.id, payload.reason);
      if (okResult<CallPublicPayload>(result)) {
        host.notifyCallEnded(result.data);
      }
      return result;
    }),

    'call:signal': command(({client, args}) => {
      const payload = args as CallSignalWsPayload;
      const result = host.calls.buildSignal(
        callIdValue(payload.callId),
        client.state.user?.id,
        payload.type,
        payload.payload,
        payload.toUserId,
      );
      if (!okResult<{toUserId: number}>(result)) return result;
      host.sendToUser(result.data.toUserId, 'call:signal', result.data);
      return {ok: true, data: {sent: true}};
    }),
  };
}

function createRoomCommands(host: ChatCommandHost): ChatCommandMap {
  const withOnlineUser = (userRaw: unknown, onlineUserIds: Set<number>) => {
    if (!userRaw || typeof userRaw !== 'object') return userRaw;
    const user = userRaw as Record<string, unknown>;
    const userId = positiveNumber(user.id);
    return {
      ...user,
      isOnline: onlineUserIds.has(userId),
    };
  };
  const isFailure = (resultRaw: unknown) => {
    return !!resultRaw && typeof resultRaw === 'object' && (resultRaw as any).ok === false;
  };

  return {
    'room:get': command(async ({client, args}) => {
      const result = await host.chat.rooms.roomGet(client.state, positiveInt((args as RoomGetPayload).roomId));
      if (isFailure(result)) return result;
      const payload = result && typeof result === 'object'
        ? {...(result as Record<string, unknown>)}
        : {};
      if ((payload as any).ok === true) {
        delete (payload as any).ok;
      }
      if (String((payload as any)?.kind || '') !== 'direct') return payload;
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return {
        ...payload,
        targetUser: withOnlineUser((payload as any).targetUser, onlineUserIds),
      };
    }, ({client, args}, result) => {
      if (!okResult<RoomGetData>(result)) return;
      const roomId = positiveNumber(result.data.roomId);
      if ((args as RoomGetPayload).subscribe !== false && roomId) {
        host.subscribe(client, roomId);
      }
    }),

    'room:list': command(async (ctx) => {
      const handler = getRoomListHandler(host, (ctx.args as RoomListPayload).kind);
      const result = handler ? await handler(ctx) : host.fail('invalid_room_kind');
      const kind = String((ctx.args as RoomListPayload).kind || '').trim().toLowerCase();
      if (kind !== 'direct' || !Array.isArray(result)) return result;
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return result.map((row) => {
        if (!row || typeof row !== 'object') return row;
        const current = row as Record<string, unknown>;
        return {
          ...current,
          targetUser: withOnlineUser(current.targetUser, onlineUserIds),
        };
      });
    }),

    'room:create': command(({client, args}) => {
      return host.chat.rooms.roomCreate(client.state, normalizeRoomCreateArgs(args));
    }),

    'room:delete': command(async ({client, args, vars}) => {
      const payload = args as RoomDeletePayload;
      const roomId = positiveInt(payload.roomId);
      vars.roomBeforeDelete = roomId ? await getRoomById(roomId) : null;

      return host.chat.rooms.roomDelete(client.state, roomId, {...payload, roomId, confirm: boolValue(payload.confirm)});
    }, ({vars}, result) => {
      if (!okResult<RoomDeleteData>(result) || !result.data.changed) return;

      const roomBeforeDelete = vars.roomBeforeDelete as RoomRow | null;
      const isDirectClear = result.data.kind === 'direct';

      if (roomBeforeDelete && isDirectClear) {
        host.broadcastToRoomMembers(roomBeforeDelete, 'room:messages:cleared', {
          roomId: result.data.roomId,
          dialogId: result.data.dialogId,
          kind: result.data.kind,
        });
      }

      if (roomBeforeDelete && !isDirectClear) {
        host.broadcastToRoomMembers(roomBeforeDelete, 'room:deleted', {
          roomId: result.data.roomId,
          dialogId: result.data.dialogId,
          kind: result.data.kind,
        });
      }

      if (!isDirectClear) {
        host.closeRoomSubscriptions(result.data.roomId);
      }
    }),

    'room:group:get-default': command(({client}) => host.chat.rooms.roomGetDefaultGroup(client.state)),
    'room:direct:get-or-create': command(async ({client, args}) => {
      const result = await host.chat.rooms.roomDirectGetOrCreate(client.state, positiveInt(args.userId));
      if (isFailure(result)) return result;
      const payload = result && typeof result === 'object'
        ? {...(result as Record<string, unknown>)}
        : {};
      if ((payload as any).ok === true) {
        delete (payload as any).ok;
      }
      const onlineUserIds = new Set(host.getOnlineUserIds());
      return {
        ...payload,
        targetUser: withOnlineUser((payload as any).targetUser, onlineUserIds),
      };
    }),
    'room:join': command(({client, args}) => host.chat.rooms.roomJoin(client.state, positiveInt((args as RoomJoinPayload).roomId))),

    'room:leave': command(({client, args}) => {
      return host.chat.rooms.roomLeave(client.state, positiveInt((args as RoomLeavePayload).roomId));
    }, ({client}, result) => {
      if (!okResult<Record<string, unknown>>(result) || !result.data.left) return;
      const data = result.data;

      const roomId = positiveNumber(data.roomId);
      if (!roomId) return;

      host.removeUserFromRoomSubscriptions(roomId, client.state?.user?.id);
      host.sendToUser(positiveNumber(client.state?.user?.id), 'room:deleted', {
        roomId: data.roomId,
        dialogId: data.dialogId,
        kind: data.kind,
      });
    }),

    'room:members:list': command(async ({client, args}) => {
      const result = await host.chat.rooms.roomMembersList(client.state, positiveInt((args as RoomMembersListPayload).roomId));
      if (!Array.isArray(result)) return result;

      const onlineUserIds = new Set(host.getOnlineUserIds());
      return result.map((user) => ({
        ...user,
        isOnline: onlineUserIds.has(positiveNumber((user as any)?.id)),
      }));
    }),

    'room:members:add': command(({client, args}) => host.chat.rooms.roomMembersAdd(client.state, {roomId: positiveInt((args as RoomMembersAddPayload).roomId), userIds: positiveIntList((args as RoomMembersAddPayload).userIds)})),

    'room:members:remove': command(({client, args}) => {
      return host.chat.rooms.roomMembersRemove(client.state, {roomId: positiveInt((args as RoomMembersRemovePayload).roomId), userIds: positiveIntList((args as RoomMembersRemovePayload).userIds)});
    }, async ({args}, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;

      const removedUserIds = Array.isArray(result.data.removedUserIds) ? result.data.removedUserIds : [];
      const roomId = positiveNumber((args as RoomMembersRemovePayload).roomId);
      const roomBefore = roomId ? await getRoomById(roomId) : null;
      const kind = roomBefore?.kind === 'game' ? 'game' : 'group';

      for (const removedUserIdRaw of removedUserIds) {
        const removedUserId = positiveNumber(removedUserIdRaw);
        if (!removedUserId) continue;

        host.removeUserFromRoomSubscriptions(roomId, removedUserId);
        host.sendToUser(removedUserId, 'room:deleted', {
          roomId,
          dialogId: roomId,
          kind,
        });
      }
    }),

    'room:settings:update': command(({client, args}) => {
      return host.chat.rooms.roomSettingsUpdate(client.state, normalizeRoomSettingsArgs(args));
    }, async (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result)) return;
      const data = result.data;

      const room = await getRoomById(positiveNumber(data.roomId));
      const payload = roomUpdatedPayload(data);

      if (room) {
        host.broadcastToRoomMembers(room, 'room:updated', payload);
      } else {
        host.broadcast(positiveNumber(data.roomId), 'room:updated', payload);
      }
    }),

    'room:surface:set': command(({client, args}) => host.chat.scriptable.roomSurfaceSet(client.state, positiveInt(args.roomId), args)),
    'room:runtime:get': command(({client, args}) => host.chat.scriptable.roomRuntimeGet(client.state, positiveInt(args.roomId))),

    'room:pin:set': command(({client, args}) => {
      return host.chat.messages.roomPinSet(client.state, positiveInt(args.roomId), positiveInt(args.nodeId));
    }, async (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result) || !result.data.changed) return;
      const data = result.data;

      const room = await getRoomById(positiveNumber(data.roomId));
      const payload = pinUpdatedPayload(data);

      if (room) {
        host.broadcastToRoomMembers(room, 'room:pin:updated', payload);
      } else {
        host.broadcast(positiveNumber(data.roomId), 'room:pin:updated', payload);
      }
    }),

    'room:pin:clear': command(({client, args}) => {
      return host.chat.messages.roomPinClear(client.state, positiveInt(args.roomId));
    }, async (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result) || !result.data.changed) return;
      const data = result.data;

      const room = await getRoomById(positiveNumber(data.roomId));
      const payload = pinUpdatedPayload(data, true);

      if (room) {
        host.broadcastToRoomMembers(room, 'room:pin:updated', payload);
      } else {
        host.broadcast(positiveNumber(data.roomId), 'room:pin:updated', payload);
      }
    }),
  };
}

function createMessageCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    'message:create': command(({client, args}) => {
      const payload = normalizeMessageCreateArgs(args);
      const kind = String(payload.kind || 'text').trim().toLowerCase();

      return kind === 'scriptable'
        ? host.chat.scriptable.messageCreateScriptable(client.state, payload.roomId, payload)
        : host.chat.messages.messageCreate(client.state, payload.roomId, payload.text ?? payload.body, payload);
    }, async ({client, args}, result) => {
      if (!okResult<MessageCreateData>(result) || !result.data.message) return;

      const payload = args as MessageCreatePayload;
      const room = await getRoomById(result.data.message.roomId);
      const silentRequested = Boolean(payload.silent);
      const skipPush = silentRequested && client.state?.user?.nickname === SYSTEM_NICKNAME;

      if (room) {
        host.broadcastToRoomMembers(room, 'message:created', result.data.message);

        if (result.data.notifyComment?.userId) {
          host.sendToUser(result.data.notifyComment.userId, 'message:comment:notify', result.data.notifyComment);
        }

        if (!skipPush && host.webPushService && typeof host.webPushService.sendChatMessagePush === 'function') {
          void host.webPushService.sendChatMessagePush({
            room,
            message: result.data.message,
            senderId: positiveNumber(client.state?.user?.id),
            excludeUserIds: host.getOnlineUserIds(),
          });
        }
      } else {
        host.broadcast(result.data.message.roomId, 'message:created', result.data.message);
      }
    }),

    'message:update': command(({client, args}) => {
      const payload = args as MessageUpdatePayload;
      return host.chat.messages.messageUpdate(client.state, positiveInt(payload.messageId), payload.text ?? payload.body);
    }, async (_ctx, result) => {
      if (!okResult<MessageUpdateData>(result) || !result.data.changed || !result.data.message) return;

      const room = await getRoomById(result.data.message.roomId);
      if (room) {
        host.broadcastToRoomMembers(room, 'message:updated', result.data.message);
      } else {
        host.broadcast(result.data.message.roomId, 'message:updated', result.data.message);
      }
    }),

    'message:delete': command(({client, args}) => {
      return host.chat.messages.messageDelete(client.state, positiveInt((args as MessageDeletePayload).messageId));
    }, async (_ctx, result) => {
      if (!okResult<MessageDeleteData>(result) || !result.data.changed) return;

      const room = await getRoomById(result.data.roomId);
      const payload = {
        roomId: result.data.roomId,
        dialogId: result.data.dialogId,
        messageId: result.data.messageId,
      };
      const pinPayload = {
        roomId: result.data.roomId,
        dialogId: result.data.dialogId,
        pinnedNodeId: null,
        pinnedMessage: null,
      };

      if (room) {
        host.broadcastToRoomMembers(room, 'message:deleted', payload);
        if (result.data.pinnedCleared) {
          host.broadcastToRoomMembers(room, 'room:pin:updated', pinPayload);
        }
      } else {
        host.broadcast(result.data.roomId, 'message:deleted', payload);
        if (result.data.pinnedCleared) {
          host.broadcast(result.data.roomId, 'room:pin:updated', pinPayload);
        }
      }
    }),

    'message:list': command(({client, args}) => {
      const payload = args as MessageListPayload;
      return host.chat.rooms.messageList(
        client.state,
        positiveInt(payload.roomId),
        positiveInt(payload.limit),
        positiveInt(payload.beforeMessageId),
      );
    }),

    'message:reaction:set': command(({client, args}) => {
      const payload = args as ReactionSetPayload;
      return host.chat.reactions.messageReactionSet(client.state, positiveInt(payload.messageId), payload.emoji ?? null);
    }, async (_ctx, result) => {
      if (!okResult<ReactionSetData>(result) || !result.data.changed) return;

      const room = await getRoomById(result.data.roomId);
      const payload = {
        roomId: result.data.roomId,
        dialogId: result.data.dialogId,
        messageId: result.data.messageId,
        reactions: result.data.reactions,
      };

      if (room) {
        host.broadcastToRoomMembers(room, 'message:reactions:updated', payload);
      } else {
        host.broadcast(result.data.roomId, 'message:reactions:updated', payload);
      }

      if (result.data.notify) {
        host.sendToUser(result.data.notify.userId, 'message:reaction:notify', result.data.notify);
      }
    }),

    'message:comment-room:get': command(({client, args}) => {
      return host.chat.messages.messageCommentRoomGet(client.state, positiveInt(args.messageId));
    }),

    'message:comment-room:create': command(({client, args}) => {
      return host.chat.messages.messageCommentRoomCreate(client.state, positiveInt(args.messageId));
    }, async (_ctx, result) => {
      if (!okResult<Record<string, unknown>>(result) || !result.data.message) return;
      const data = result.data;

      const sourceRoomId = positiveNumber(data.sourceRoomId);
      const room = sourceRoomId ? await getRoomById(sourceRoomId) : null;
      if (room) {
        host.broadcastToRoomMembers(room, 'message:updated', data.message);
      } else if (sourceRoomId) {
        host.broadcast(sourceRoomId, 'message:updated', data.message);
      }
    }),

    'runtime:action': command(({client, args}) => {
      return host.chat.scriptable.runtimeAction(client.state, normalizeRuntimeActionArgs(args));
    }),
  };
}

export function createChatCommands(host: ChatCommandHost): ChatCommandMap {
  return {
    ...createAuthCommands(host),
    ...createUserCommands(host),
    ...createInviteCommands(host),
    ...createPublicCommands(host),
    ...createGameCommands(host),
    ...createCallCommands(host),
    ...createRoomCommands(host),
    ...createMessageCommands(host),
  };
}
