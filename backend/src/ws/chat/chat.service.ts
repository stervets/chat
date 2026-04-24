import {Injectable} from '@nestjs/common';
import type {SocketState} from '../protocol.js';
import {ChatAuthService} from './chat-auth.service.js';
import {ChatContext} from './chat-context.js';
import {ChatDialogsService} from './chat-dialogs.service.js';
import {ChatInvitesService} from './chat-invites.service.js';
import {ChatGamesService} from './chat-games.service.js';
import {ChatMessagesService} from './chat-messages.service.js';
import {ChatReactionsService} from './chat-reactions.service.js';
import {ChatUsersService} from './chat-users.service.js';

@Injectable()
export class ChatService {
  private readonly ctx = new ChatContext();
  private readonly authService = new ChatAuthService(this.ctx);
  private readonly usersService = new ChatUsersService(this.ctx);
  private readonly invitesService = new ChatInvitesService(this.ctx);
  private readonly gamesService = new ChatGamesService(this.ctx);
  private readonly roomsService = new ChatDialogsService(this.ctx);
  private readonly messagesService = new ChatMessagesService(this.ctx);
  private readonly reactionsService = new ChatReactionsService(this.ctx);

  authLogin(state: SocketState, payload: any) {
    return this.authService.authLogin(state, payload);
  }

  authSession(state: SocketState, tokenRaw: unknown) {
    return this.authService.authSession(state, tokenRaw);
  }

  authMe(state: SocketState) {
    return this.authService.authMe(state);
  }

  authLogout(state: SocketState) {
    return this.authService.authLogout(state);
  }

  authUpdateProfile(state: SocketState, payload: any) {
    return this.authService.authUpdateProfile(state, payload);
  }

  authChangePassword(state: SocketState, payload: any) {
    return this.authService.authChangePassword(state, payload);
  }

  usersList(state: SocketState) {
    return this.usersService.usersList(state);
  }

  userGet(state: SocketState, payload: {userId?: unknown; nickname?: unknown}) {
    return this.usersService.userGet(state, payload);
  }

  contactsList(state: SocketState) {
    return this.usersService.contactsList(state);
  }

  contactsAdd(state: SocketState, payload: {userId?: unknown}) {
    return this.usersService.contactsAdd(state, payload);
  }

  contactsRemove(state: SocketState, payload: {userId?: unknown}) {
    return this.usersService.contactsRemove(state, payload);
  }

  invitesList(state: SocketState) {
    return this.invitesService.invitesList(state);
  }

  invitesCreate(state: SocketState, payload: {roomIds?: unknown}) {
    return this.invitesService.invitesCreate(state, payload);
  }

  invitesCheck(state: SocketState, payload: any) {
    return this.invitesService.invitesCheck(state, payload);
  }

  invitesRedeem(state: SocketState, payload: any) {
    return this.invitesService.invitesRedeem(state, payload);
  }

  invitesAvailableRooms(state: SocketState) {
    return this.invitesService.invitesAvailableRooms(state);
  }

  invitesDelete(state: SocketState, payload: {inviteId?: unknown}) {
    return this.invitesService.invitesDelete(state, payload);
  }

  publicVpnInfo(state: SocketState) {
    return this.invitesService.publicVpnInfo(state);
  }

  publicVpnProvision(state: SocketState) {
    return this.invitesService.publicVpnProvision(state);
  }

  publicVpnDonation(state: SocketState, payload: any) {
    return this.invitesService.publicVpnDonation(state, payload);
  }

  gamesSoloCreate(state: SocketState, payload: any) {
    return this.gamesService.gamesSoloCreate(state, payload);
  }

  gamesSessionGet(state: SocketState, sessionIdRaw: unknown) {
    return this.gamesService.gamesSessionGet(state, sessionIdRaw);
  }

  gamesAction(state: SocketState, payload: any) {
    return this.gamesService.gamesAction(state, payload);
  }

  roomGetDefaultGroup(state: SocketState) {
    return this.roomsService.roomGetDefaultGroup(state);
  }

  roomDirectGetOrCreate(state: SocketState, userIdRaw: unknown) {
    return this.roomsService.roomDirectGetOrCreate(state, userIdRaw);
  }

  roomListDirect(state: SocketState) {
    return this.roomsService.roomListDirect(state);
  }

  roomListJoined(state: SocketState, scopeRaw?: unknown) {
    return this.roomsService.roomListJoined(state, scopeRaw);
  }

  messageList(state: SocketState, roomIdRaw: unknown, limitRaw?: unknown, beforeMessageIdRaw?: unknown) {
    return this.roomsService.messageList(state, roomIdRaw, limitRaw, beforeMessageIdRaw);
  }

  roomGet(state: SocketState, roomIdRaw: unknown) {
    return this.roomsService.roomGet(state, roomIdRaw);
  }

  roomCreate(state: SocketState, payloadRaw: any) {
    return this.roomsService.roomCreate(state, payloadRaw);
  }

  roomJoin(state: SocketState, roomIdRaw: unknown) {
    return this.roomsService.roomJoin(state, roomIdRaw);
  }

  roomLeave(state: SocketState, roomIdRaw: unknown) {
    return this.roomsService.roomLeave(state, roomIdRaw);
  }

  roomMembersList(state: SocketState, roomIdRaw: unknown) {
    return this.roomsService.roomMembersList(state, roomIdRaw);
  }

  roomMembersAdd(state: SocketState, payloadRaw: any) {
    return this.roomsService.roomMembersAdd(state, payloadRaw);
  }

  roomMembersRemove(state: SocketState, payloadRaw: any) {
    return this.roomsService.roomMembersRemove(state, payloadRaw);
  }

  roomSettingsUpdate(state: SocketState, payloadRaw: any) {
    return this.roomsService.roomSettingsUpdate(state, payloadRaw);
  }

  roomDelete(state: SocketState, roomIdRaw: unknown, optionsRaw?: any) {
    return this.roomsService.roomDelete(state, roomIdRaw, optionsRaw);
  }

  messageCreate(state: SocketState, roomIdRaw: unknown, bodyRaw: unknown, optionsRaw?: any) {
    return this.messagesService.messageCreate(state, roomIdRaw, bodyRaw, optionsRaw);
  }

  messageUpdate(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown) {
    return this.messagesService.messageUpdate(state, messageIdRaw, bodyRaw);
  }

  messageDelete(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.messageDelete(state, messageIdRaw);
  }

  roomPinSet(state: SocketState, roomIdRaw: unknown, messageIdRaw: unknown) {
    return this.messagesService.roomPinSet(state, roomIdRaw, messageIdRaw);
  }

  roomPinClear(state: SocketState, roomIdRaw: unknown) {
    return this.messagesService.roomPinClear(state, roomIdRaw);
  }

  messageCommentRoomGet(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.messageCommentRoomGet(state, messageIdRaw);
  }

  messageCommentRoomCreate(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.messageCommentRoomCreate(state, messageIdRaw);
  }

  messageReactionSet(state: SocketState, messageIdRaw: unknown, reactionRaw: unknown) {
    return this.reactionsService.messageReactionSet(state, messageIdRaw, reactionRaw);
  }

  messageCreateScriptable(_state: SocketState, _roomIdRaw: unknown, _payloadRaw: any) {
    return {ok: false, error: 'scriptable_disabled'};
  }

  runtimeAction(_state: SocketState, _payloadRaw: any) {
    return {ok: false, error: 'scriptable_disabled'};
  }

  roomRuntimeGet(_state: SocketState, _roomIdRaw: unknown) {
    return {ok: true, roomRuntime: null};
  }

  roomSurfaceSet(_state: SocketState, _roomIdRaw: unknown, _payloadRaw: any) {
    return {ok: false, error: 'scriptable_disabled'};
  }

  scriptableNotifyRoomEvent(_input: {roomId: number; eventType: string; eventPayload: any}) {
    return {ok: true};
  }
}
