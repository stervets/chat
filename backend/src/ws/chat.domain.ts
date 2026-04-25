import {ChatAuthService} from './chat/chat-auth.service.js';
import {ChatContext} from './chat/chat-context.js';
import {ChatDialogsService} from './chat/chat-dialogs.service.js';
import {ChatGamesService} from './chat/chat-games.service.js';
import {ChatInvitesService} from './chat/chat-invites.service.js';
import {ChatMessagesService} from './chat/chat-messages.service.js';
import {ChatReactionsService} from './chat/chat-reactions.service.js';
import {ChatUsersService} from './chat/chat-users.service.js';
import type {SocketState} from './protocol.js';

function createDisabledScriptableService() {
  return {
    messageCreateScriptable(_state: SocketState, _roomIdRaw: unknown, _payloadRaw: any) {
      return {ok: false, error: 'scriptable_disabled'};
    },

    runtimeAction(_state: SocketState, _payloadRaw: any) {
      return {ok: false, error: 'scriptable_disabled'};
    },

    roomRuntimeGet(_state: SocketState, _roomIdRaw: unknown) {
      return {ok: true, roomRuntime: null};
    },

    roomSurfaceSet(_state: SocketState, _roomIdRaw: unknown, _payloadRaw: any) {
      return {ok: false, error: 'scriptable_disabled'};
    },

    scriptableNotifyRoomEvent(_input: {roomId: number; eventType: string; eventPayload: any}) {
      return {ok: true};
    },
  };
}

export function createChatDomain() {
  const context = new ChatContext();

  return {
    context,
    auth: new ChatAuthService(context),
    users: new ChatUsersService(context),
    invites: new ChatInvitesService(context),
    games: new ChatGamesService(context),
    rooms: new ChatDialogsService(context),
    messages: new ChatMessagesService(context),
    reactions: new ChatReactionsService(context),
    scriptable: createDisabledScriptableService(),
  };
}

export type ChatDomain = ReturnType<typeof createChatDomain>;
