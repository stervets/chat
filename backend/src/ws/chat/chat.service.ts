import {Injectable, type OnApplicationShutdown} from '@nestjs/common';
import type {SocketState} from '../protocol.js';
import {ChatAuthService} from './chat-auth.service.js';
import {ChatContext} from './chat-context.js';
import {ChatDialogsService} from './chat-dialogs.service.js';
import {ChatInvitesService} from './chat-invites.service.js';
import {ChatGamesService} from './chat-games.service.js';
import {ChatMessagesService} from './chat-messages.service.js';
import {ChatReactionsService} from './chat-reactions.service.js';
import {ChatUsersService} from './chat-users.service.js';
import {ScriptableService} from '../../scriptable/service.js';

@Injectable()
export class ChatService implements OnApplicationShutdown {
  private readonly ctx = new ChatContext();
  private readonly authService = new ChatAuthService(this.ctx);
  private readonly usersService = new ChatUsersService(this.ctx);
  private readonly invitesService = new ChatInvitesService(this.ctx);
  private readonly gamesService = new ChatGamesService(this.ctx);
  private readonly dialogsService = new ChatDialogsService(this.ctx);
  private readonly messagesService = new ChatMessagesService(this.ctx);
  private readonly reactionsService = new ChatReactionsService(this.ctx);
  private readonly scriptableService = new ScriptableService(this.ctx);

  constructor() {
    this.scriptableService.startRunnerClient();
  }

  onApplicationShutdown() {
    this.scriptableService.stopRunnerClient();
  }

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

  invitesList(state: SocketState) {
    return this.invitesService.invitesList(state);
  }

  invitesCreate(state: SocketState) {
    return this.invitesService.invitesCreate(state);
  }

  invitesCheck(state: SocketState, payload: any) {
    return this.invitesService.invitesCheck(state, payload);
  }

  invitesRedeem(state: SocketState, payload: any) {
    return this.invitesService.invitesRedeem(state, payload);
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

  dialogsGeneral(state: SocketState) {
    return this.dialogsService.dialogsGeneral(state);
  }

  dialogsPrivate(state: SocketState, userIdRaw: unknown) {
    return this.dialogsService.dialogsPrivate(state, userIdRaw);
  }

  dialogsDirects(state: SocketState) {
    return this.dialogsService.dialogsDirects(state);
  }

  dialogsMessages(state: SocketState, roomIdRaw: unknown, limitRaw?: unknown, beforeMessageIdRaw?: unknown) {
    return this.dialogsService.dialogsMessages(state, roomIdRaw, limitRaw, beforeMessageIdRaw);
  }

  chatJoin(state: SocketState, roomIdRaw: unknown) {
    return this.dialogsService.chatJoin(state, roomIdRaw);
  }

  roomsCreate(state: SocketState, payloadRaw: any) {
    return this.dialogsService.roomsCreate(state, payloadRaw);
  }

  roomsSurfaceConfigure(state: SocketState, roomIdRaw: unknown, payloadRaw: any) {
    return this.dialogsService.roomsSurfaceConfigure(state, roomIdRaw, payloadRaw);
  }

  dialogsDelete(state: SocketState, roomIdRaw: unknown, optionsRaw?: any) {
    return this.dialogsService.dialogsDelete(state, roomIdRaw, optionsRaw);
  }

  chatSend(state: SocketState, roomIdRaw: unknown, bodyRaw: unknown, optionsRaw?: any) {
    return this.messagesService.chatSend(state, roomIdRaw, bodyRaw, optionsRaw);
  }

  chatEdit(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown) {
    return this.messagesService.chatEdit(state, messageIdRaw, bodyRaw);
  }

  chatDelete(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.chatDelete(state, messageIdRaw);
  }

  chatPin(state: SocketState, roomIdRaw: unknown, messageIdRaw: unknown) {
    return this.messagesService.chatPin(state, roomIdRaw, messageIdRaw);
  }

  chatUnpin(state: SocketState, roomIdRaw: unknown) {
    return this.messagesService.chatUnpin(state, roomIdRaw);
  }

  messagesDiscussionGet(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.messagesDiscussionGet(state, messageIdRaw);
  }

  messagesDiscussionCreate(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.messagesDiscussionCreate(state, messageIdRaw);
  }

  chatReact(state: SocketState, messageIdRaw: unknown, reactionRaw: unknown) {
    return this.reactionsService.chatReact(state, messageIdRaw, reactionRaw);
  }

  scriptsCreateMessage(state: SocketState, roomIdRaw: unknown, payloadRaw: any) {
    return this.scriptableService.createScriptableMessage(state, roomIdRaw, payloadRaw);
  }

  scriptsAction(state: SocketState, payloadRaw: any) {
    return this.scriptableService.applyScriptAction(state, payloadRaw);
  }

  scriptsRoomGet(state: SocketState, roomIdRaw: unknown) {
    return this.scriptableService.getRoomScriptEntity(state, roomIdRaw);
  }

  scriptableNotifyRoomEvent(input: {roomId: number; eventType: string; eventPayload: any}) {
    return this.scriptableService.notifyRoomEvent(input);
  }
}
