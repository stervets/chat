import {Injectable} from '@nestjs/common';
import type {SocketState} from '../protocol.js';
import {ChatAuthService} from './chat-auth.service.js';
import {ChatContext} from './chat-context.js';
import {ChatDialogsService} from './chat-dialogs.service.js';
import {ChatInvitesService} from './chat-invites.service.js';
import {ChatMessagesService} from './chat-messages.service.js';
import {ChatReactionsService} from './chat-reactions.service.js';
import {ChatUsersService} from './chat-users.service.js';

@Injectable()
export class ChatService {
  private readonly ctx = new ChatContext();
  private readonly authService = new ChatAuthService(this.ctx);
  private readonly usersService = new ChatUsersService(this.ctx);
  private readonly invitesService = new ChatInvitesService(this.ctx);
  private readonly dialogsService = new ChatDialogsService(this.ctx);
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

  dialogsGeneral(state: SocketState) {
    return this.dialogsService.dialogsGeneral(state);
  }

  dialogsPrivate(state: SocketState, userIdRaw: unknown) {
    return this.dialogsService.dialogsPrivate(state, userIdRaw);
  }

  dialogsDirects(state: SocketState) {
    return this.dialogsService.dialogsDirects(state);
  }

  dialogsMessages(state: SocketState, dialogIdRaw: unknown, limitRaw?: unknown, beforeMessageIdRaw?: unknown) {
    return this.dialogsService.dialogsMessages(state, dialogIdRaw, limitRaw, beforeMessageIdRaw);
  }

  chatJoin(state: SocketState, dialogIdRaw: unknown) {
    return this.dialogsService.chatJoin(state, dialogIdRaw);
  }

  dialogsDelete(state: SocketState, dialogIdRaw: unknown) {
    return this.dialogsService.dialogsDelete(state, dialogIdRaw);
  }

  chatSend(state: SocketState, dialogIdRaw: unknown, bodyRaw: unknown) {
    return this.messagesService.chatSend(state, dialogIdRaw, bodyRaw);
  }

  chatEdit(state: SocketState, messageIdRaw: unknown, bodyRaw: unknown) {
    return this.messagesService.chatEdit(state, messageIdRaw, bodyRaw);
  }

  chatDelete(state: SocketState, messageIdRaw: unknown) {
    return this.messagesService.chatDelete(state, messageIdRaw);
  }

  chatReact(state: SocketState, messageIdRaw: unknown, reactionRaw: unknown) {
    return this.reactionsService.chatReact(state, messageIdRaw, reactionRaw);
  }
}
